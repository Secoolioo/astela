import * as v from 'valibot';
import { defineRequest } from './contract.ts';

const ProfileId = v.pipe(v.string(), v.minLength(1), v.maxLength(4096));
const Label = v.pipe(v.string(), v.minLength(1), v.maxLength(200));
const Count = v.pipe(v.number(), v.integer(), v.minValue(0));

/** A profile of another browser that the import can read. */
export const BrowserProfileView = v.strictObject({
  id: ProfileId,
  browser: v.string(),
  profile: v.string(),
  tabs: v.boolean(),
});

/** A profile of another browser that the import can read. */
export type BrowserProfileView = v.InferOutput<typeof BrowserProfileView>;

/**
 * Finds other browsers on this computer. `enabled` is false when a policy turns the import
 * off. The settings page and the setup guide both offer the import.
 */
export const FindBrowsers = defineRequest({
  channel: 'settings.findBrowsers',
  request: v.strictObject({}),
  response: v.strictObject({ enabled: v.boolean(), profiles: v.array(BrowserProfileView) }),
  capability: 'page:settings',
});

/**
 * Imports bookmarks, history and open tabs from a profile that `settings.findBrowsers`
 * found, with the titles of the folders it creates in the language of the page.
 */
export const ImportBrowser = defineRequest({
  channel: 'settings.importBrowser',
  request: v.strictObject({
    id: ProfileId,
    bookmarks: v.boolean(),
    history: v.boolean(),
    tabs: v.boolean(),
    labels: v.strictObject({
      folder: Label,
      toolbar: Label,
      menu: Label,
      other: Label,
      mobile: Label,
    }),
  }),
  response: v.strictObject({
    bookmarks: Count,
    history: Count,
    tabs: Count,
    failed: v.array(v.picklist(['bookmarks', 'history', 'tabs'])),
  }),
  capability: 'page:settings',
  ratePerSecond: 5,
});
