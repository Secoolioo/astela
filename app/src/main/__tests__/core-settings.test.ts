import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { settingPolicies } from '../../domain/settings/settings-service.ts';
import {
  AltOpensMenuSetting,
  CommandPaletteSetting,
  coreSettings,
  DownloadFolderSetting,
  ShortcutsSetting,
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
