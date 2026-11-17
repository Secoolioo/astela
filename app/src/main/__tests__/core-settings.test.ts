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
  SplitViewSetting,
  StartupSetting,
  TabSleepAfterSetting,
  TabSleepSetting,
  WorkspacesEnabledSetting,
  WorkspacesRemovedSetting,
  WorkspacesSetting,
} from '../core-settings.ts';
import { sleepAfterSeconds } from '../../shared/tab-sleep.ts';

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

describe('SplitViewSetting', () => {
  it('turns split view on by default, and a policy can set or recommend it', () => {
    expect(SplitViewSetting).toMatchObject({
      key: 'splitView.enabled',
      default: true,
      scope: 'global',
      policy: { name: 'SplitViewEnabled', recommended: true },
      ui: { section: 'appearance', control: 'toggle' },
    });
    expect(coreSettings).toContain(SplitViewSetting);
    expect(settingPolicies(coreSettings)).toContainEqual(
      expect.objectContaining({ name: 'SplitViewEnabled', recommended: true }),
    );
    expect(v.safeParse(SplitViewSetting.schema, false).success).toBe(true);
    expect(v.safeParse(SplitViewSetting.schema, 'off').success).toBe(false);
  });
});

describe('the settings of the workspaces', () => {
  it('turns workspaces on by default, and a policy can set or recommend it', () => {
    expect(WorkspacesEnabledSetting).toMatchObject({
      key: 'workspaces.enabled',
      default: true,
      scope: 'global',
      policy: { name: 'WorkspacesEnabled', recommended: true },
      ui: { section: 'appearance', control: 'toggle' },
    });
    expect(coreSettings).toContain(WorkspacesEnabledSetting);
    expect(settingPolicies(coreSettings)).toContainEqual(
      expect.objectContaining({ name: 'WorkspacesEnabled', recommended: true }),
    );
    expect(v.safeParse(WorkspacesEnabledSetting.schema, 'off').success).toBe(false);
  });

  it('keeps the list of the workspaces and the deleted ones, which no policy sets', () => {
    expect(WorkspacesSetting.default).toEqual([
      { id: 'default', name: '', icon: 'home', color: 'blue', isolated: false },
    ]);
    expect(WorkspacesSetting.policy).toBeUndefined();
    expect(WorkspacesRemovedSetting.policy).toBeUndefined();
    expect(coreSettings).toContain(WorkspacesSetting);
    expect(coreSettings).toContain(WorkspacesRemovedSetting);
    expect(v.safeParse(WorkspacesRemovedSetting.schema, ['w1', 'w2']).success).toBe(true);
    // An id that leaves the folder of the partitions is never kept.
    expect(v.safeParse(WorkspacesRemovedSetting.schema, ['../w1']).success).toBe(false);
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

/** The settings of the browser with policies of the system, read as at a start. */
async function settingsWith(
  values: readonly {
    readonly name: string;
    readonly value: unknown;
    readonly level: PolicyLevel;
  }[],
  user: Readonly<Record<string, unknown>> = {},
): Promise<SettingsService> {
  const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
  const result: PolicyReadResult = {
    values: values.map((value) => ({ ...value, scope: 'machine', source: 'test' })),
    errors: [],
  };
  const provider: PolicyProvider = { name: 'test', load: () => Promise.resolve(result) };
  const policies = new PolicyService(settingPolicies(coreSettings), [provider], logger);
  await policies.refresh();
  const store = {
    load: () => Promise.resolve({ user: { ...user }, workspaces: {} }),
    save: () => Promise.resolve(),
  };
  const settings = new SettingsService(coreSettings, policies, store, logger);
  await settings.load();
  return settings;
}

describe('TabSleepSetting and TabSleepAfterSetting', () => {
  it('put tabs to sleep after an hour by default, in the section of performance', () => {
    expect(TabSleepSetting).toMatchObject({
      key: 'tabs.sleep',
      default: true,
      policy: { name: 'SleepingTabsEnabled', recommended: true },
      ui: { section: 'performance', control: 'toggle', order: 1 },
    });
    expect(TabSleepAfterSetting).toMatchObject({
      key: 'tabs.sleepAfter',
      default: 3600,
      policy: { name: 'SleepingTabsTimeout', recommended: true },
      ui: { section: 'performance', control: 'select', order: 2 },
    });
    expect(coreSettings).toEqual(expect.arrayContaining([TabSleepSetting, TabSleepAfterSetting]));
    expect(settingPolicies(coreSettings).map((policy) => policy.name)).toEqual(
      expect.arrayContaining(['SleepingTabsEnabled', 'SleepingTabsTimeout']),
    );
  });

  it("take the times of Edge's policy in seconds, and no other", () => {
    for (const seconds of [30, 300, 900, 1800, 3600, 7200, 10800, 21600, 43200]) {
      expect(v.safeParse(TabSleepAfterSetting.schema, seconds).success).toBe(true);
    }
    expect(sleepAfterSeconds).toHaveLength(9);
    for (const other of [0, 60, 3601, '3600', -300]) {
      expect(v.safeParse(TabSleepAfterSetting.schema, other).success).toBe(false);
    }
    expect(v.safeParse(TabSleepSetting.schema, 'on').success).toBe(false);
  });

  it('follow a mandatory policy, and a recommended one only until people chose', async () => {
    const managed = await settingsWith([
      { name: 'SleepingTabsEnabled', value: false, level: 'mandatory' },
      { name: 'SleepingTabsTimeout', value: 300, level: 'mandatory' },
    ]);
    expect([managed.get(TabSleepSetting), managed.get(TabSleepAfterSetting)]).toEqual([false, 300]);
    expect(managed.inspect(TabSleepSetting).locked).toBe(true);
    expect(managed.inspect(TabSleepAfterSetting).locked).toBe(true);
    const suggested = await settingsWith(
      [{ name: 'SleepingTabsTimeout', value: 30, level: 'recommended' }],
      { 'tabs.sleepAfter': 7200 },
    );
    expect(suggested.get(TabSleepAfterSetting)).toBe(7200);
    expect(suggested.inspect(TabSleepAfterSetting).locked).toBe(false);
    expect(
      (await settingsWith([{ name: 'SleepingTabsTimeout', value: 30, level: 'recommended' }])).get(
        TabSleepAfterSetting,
      ),
    ).toBe(30);
    // A time that the policy does not know leaves the default.
    const unknown = await settingsWith([
      { name: 'SleepingTabsTimeout', value: 60, level: 'mandatory' },
    ]);
    expect(unknown.get(TabSleepAfterSetting)).toBe(3600);
  });
});
