import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { DownloadFolderSetting } from '../core-settings.ts';

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
