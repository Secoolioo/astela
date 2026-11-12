import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { DownloadFolderSetting, ShortcutsSetting } from '../core-settings.ts';

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

  it('refuses the keys of the system and unknown commands', () => {
    expect(takes({ 'app.quit': [mac ? 'Cmd+Q' : 'Alt+F4'] })).toBe(false);
    expect(takes({ 'app.restart': ['F9'] })).toBe(false);
  });
});
