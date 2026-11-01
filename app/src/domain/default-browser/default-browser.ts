import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';

/**
 * Lets administrators keep users from making the browser their default browser: `false`
 * hides the setting, as in other browsers.
 */
export const DefaultBrowserSettingEnabled = definePolicy({
  name: 'DefaultBrowserSettingEnabled',
  schema: v.boolean(),
});

/**
 * Reads the program that Windows opens for https links, from the output of
 * `reg query …\UrlAssociations\https\UserChoice /v ProgId`.
 * @param output - What `reg query` printed.
 * @returns The program id, or `undefined` when there is none.
 */
export function userChoiceProgId(output: string): string | undefined {
  return /^\s*ProgId\s+REG_SZ\s+(\S.*?)\s*$/m.exec(output)?.[1];
}
