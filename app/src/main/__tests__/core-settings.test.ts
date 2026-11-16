import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import type { PolicyLevel, PolicyProvider, PolicyReadResult } from '../../domain/policy/policy.ts';
import { PolicyService } from '../../domain/policy/policy-service.ts';
import { sessionStart } from '../../domain/session/session.ts';
import { SettingsService, settingPolicies } from '../../domain/settings/settings-service.ts';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import {
  AltOpensMenuSetting,
  CommandPaletteSetting,
  coreSettings,
  DownloadFolderSetting,
  ShortcutsSetting,
  StartupSetting,
} from '../core-settings.ts';

/** Whether the setting takes a folder. */
const valid = (folder: string): boolean =>
  v.safeParse(DownloadFolderSetting.schema, folder).success;

describe('DownloadFolderSetting', () => {
  it('takes an absolute folder or none, and refuses a relative path', () => {
    expect(valid('')).toBe(true);
    expect(valid(process.platform === 'win32' ? 'D:\\Downloads' : '/srv/downloads')).toBe(true);
    // Chromium's variables are not replaced, so they would make a relative path.
    expect(valid('${user_home}/Downloads')).toBe(false);
    expect(valid('Downloads')).toBe(false);
  });
});

/** Whether the setting takes shortcuts of people's own. */
const takes = (overrides: unknown): boolean =>
  v.safeParse(ShortcutsSetting.schema, overrides).success;

describe('ShortcutsSetting', () => {
  const mac = process.platform === 'darwin';

  it('takes shortcuts of their own for the commands of the menus', () => {
    const own = mac ? 'Shift+Cmd+Y' : 'Ctrl+Shift+Y';
    for (const command of [
      'tab.duplicate',
      'tab.closeOthers',
      'tab.closeRight',
      'tab.mute',
      'app.about',
      'app.quit',
    ]) {
      expect({ command, valid: takes({ [command]: [own] }) }).toEqual({ command, valid: true });
    }
  });

  it('takes shortcuts of their own for the command palette and tab search', () => {
    expect(takes({ 'palette.open': [mac ? 'Shift+Cmd+P' : 'Ctrl+Shift+P'] })).toBe(true);
    expect(takes({ 'tabs.search': [] })).toBe(true);
  });

  it('refuses the keys of the system and unknown commands', () => {
    expect(takes({ 'app.quit': [mac ? 'Cmd+Q' : 'Alt+F4'] })).toBe(false);
    expect(takes({ 'app.restart': ['F9'] })).toBe(false);
  });
});

describe('AltOpensMenuSetting', () => {
  it('opens the menu with Alt by default, as a keyboard preference without a policy', () => {
    expect(AltOpensMenuSetting).toMatchObject({ key: 'keys.altOpensMenu', default: true });
    expect(AltOpensMenuSetting.policy).toBeUndefined();
    expect(v.safeParse(AltOpensMenuSetting.schema, false).success).toBe(true);
    expect(v.safeParse(AltOpensMenuSetting.schema, 'no').success).toBe(false);
  });

  it.each(['win32', 'linux', 'darwin'])(
    'has a place on the settings page on %s only off macOS',
    async (platform) => {
      const real = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        vi.resetModules();
        const { AltOpensMenuSetting: setting } = await import('../core-settings.ts');
        expect(setting.ui).toEqual(
          platform === 'darwin' ? undefined : { section: 'shortcuts', control: 'toggle', order: 2 },
        );
      } finally {
        if (real !== undefined) Object.defineProperty(process, 'platform', real);
      }
    },
  );
});

describe('CommandPaletteSetting', () => {
  it('turns the palette on by default, and a policy can set or recommend it', () => {
    expect(CommandPaletteSetting).toMatchObject({
      key: 'commandPalette.enabled',
      default: true,
      policy: { name: 'CommandPaletteEnabled', recommended: true },
      ui: { section: 'shortcuts', control: 'toggle', order: 0 },
    });
    expect(coreSettings).toContain(CommandPaletteSetting);
    expect(settingPolicies(coreSettings).map((policy) => policy.name)).toContain(
      'CommandPaletteEnabled',
    );
    expect(v.safeParse(CommandPaletteSetting.schema, false).success).toBe(true);
    expect(v.safeParse(CommandPaletteSetting.schema, 'off').success).toBe(false);
  });
});

/**
 * Whether a start brings the last session back, with the startup setting of people, of a
 * policy or none.
 */
async function restores(
  start: { readonly user?: string; readonly policy?: [number, PolicyLevel] },
  run: { readonly restart?: boolean; readonly unclean: boolean; readonly setup?: boolean },
): Promise<string | undefined> {
  const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
  const result: PolicyReadResult = {
    values:
      start.policy === undefined
        ? []
        : [
            {
              name: 'RestoreOnStartup',
              value: start.policy[0],
              level: start.policy[1],
              scope: 'machine',
              source: 'test',
            },
          ],
    errors: [],
  };
  const provider: PolicyProvider = { name: 'test', load: () => Promise.resolve(result) };
  const policies = new PolicyService(settingPolicies(coreSettings), [provider], logger);
  await policies.refresh();
  const store = {
    load: () =>
      Promise.resolve({
        user: start.user === undefined ? {} : { 'startup.page': start.user },
        workspaces: {},
      }),
    save: () => Promise.resolve(),
  };
  const settings = new SettingsService(coreSettings, policies, store, logger);
  await settings.load();
  return sessionStart(settings.inspect(StartupSetting), {
    restart: run.restart === true,
    unclean: run.unclean,
    setup: run.setup === true,
  });
}

describe('the start after a crash', () => {
  it('brings the last session back after a crash, also when people start with a new tab page', async () => {
    expect(await restores({}, { unclean: false })).toBe('asked');
    expect(await restores({ user: 'newtab' }, { unclean: false })).toBeUndefined();
    expect(await restores({ user: 'newtab' }, { unclean: true })).toBe('crash');
    expect(await restores({ user: 'pages' }, { unclean: true })).toBe('crash');
    // A restart from the settings page asks for the session.
    expect(await restores({ user: 'newtab' }, { restart: true, unclean: false })).toBe('asked');
    // The setup guide of a new profile opens instead.
    expect(await restores({}, { unclean: true, setup: true })).toBeUndefined();
  });

  it('keeps to a mandatory RestoreOnStartup after a crash, but not to a recommended one', async () => {
    // A new tab page or pages of its own, as on shared computers and kiosks: the next person
    // gets no tabs of the person before.
    expect(await restores({ policy: [5, 'mandatory'] }, { unclean: true })).toBeUndefined();
    expect(await restores({ policy: [4, 'mandatory'] }, { unclean: true })).toBeUndefined();
    expect(
      await restores({ user: 'restore', policy: [5, 'mandatory'] }, { unclean: true }),
    ).toBeUndefined();
    // A mandatory policy that restores still restores, and so does a restart.
    expect(await restores({ policy: [1, 'mandatory'] }, { unclean: true })).toBe('asked');
    expect(await restores({ policy: [5, 'mandatory'] }, { restart: true, unclean: true })).toBe(
      'asked',
    );
    // A recommended value is a default that people may change: the session comes back.
    expect(await restores({ policy: [5, 'recommended'] }, { unclean: false })).toBeUndefined();
    expect(await restores({ policy: [5, 'recommended'] }, { unclean: true })).toBe('crash');
  });
});
