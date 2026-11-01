import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';
import type { InstallType } from '../updates/update-service.ts';

/**
 * Lets administrators keep users from making the browser their default browser: `false`
 * hides the setting, as in other browsers.
 */
export const DefaultBrowserSettingEnabled = definePolicy({
  name: 'DefaultBrowserSettingEnabled',
  schema: v.boolean(),
});

/**
 * Whether an installation can become the default browser. An AppImage has no installed
 * desktop entry that the system could open links with, and MSI installations are not
 * registered with Windows; organizations set the default browser with their own tools.
 * @param type - How the browser was installed.
 */
export function canBeDefaultBrowser(type: InstallType): boolean {
  return type !== 'appimage' && type !== 'msi';
}

/**
 * Reads the program that Windows opens for http or https links, from the output of
 * `reg query …\UrlAssociations\<scheme>\UserChoice /v ProgId`.
 * @param output - What `reg query` printed.
 * @returns The program id, or `undefined` when there is none.
 */
export function userChoiceProgId(output: string): string | undefined {
  return /^\s*ProgId\s+REG_SZ\s+(\S.*?)\s*$/m.exec(output)?.[1];
}
