import { describe, expect, it, vi } from 'vitest';
import { coreSettings, DownloadFolderSetting } from '../core-settings.ts';
import { settingUi } from '../setting-ui.ts';

describe('settingUi', () => {
  it('names only settings that exist', () => {
    const keys = new Set(coreSettings.map((definition) => definition.key));
    expect([...settingUi.keys()].filter((key) => !keys.has(key))).toEqual([]);
  });

  it.each(['win32', 'linux', 'darwin'])(
    'gives every setting a row on the settings page on %s but those that people do not set there',
    async (platform) => {
      const real = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        vi.resetModules();
        const { settingsWithoutRow } = await import('../setting-ui.ts');
        expect(settingsWithoutRow(coreSettings)).toEqual([
          'zoom.sites',
          'privacy.httpAllowlist',
          ...(platform === 'darwin' ? ['keys.altOpensMenu'] : []),
          'setup.shown',
          'workspaces.list',
          'workspaces.removed',
        ]);
      } finally {
        if (real !== undefined) Object.defineProperty(process, 'platform', real);
      }
    },
  );

  it('leaves only the folder of downloads to the dialog of the system', () => {
    expect([...settingUi].flatMap(([key, ui]) => (ui.control === 'folder' ? [key] : []))).toEqual([
      DownloadFolderSetting.key,
    ]);
  });
});
