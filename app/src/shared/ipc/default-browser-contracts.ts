import * as v from 'valibot';
import { defineRequest } from './contract.ts';

/**
 * Tells whether the browser is the default browser, whether a policy lets the user make it
 * the default, and whether this installation can become the default at all. The settings
 * page and the setup guide both show it.
 */
export const GetDefaultBrowser = defineRequest({
  channel: 'settings.getDefaultBrowser',
  request: v.strictObject({}),
  response: v.strictObject({
    isDefault: v.boolean(),
    allowed: v.boolean(),
    supported: v.boolean(),
  }),
  capability: 'page:settings',
});

/**
 * Makes the browser the default browser: `done`, or `settings` when the system settings
 * opened for the user to choose it, as on Windows.
 */
export const MakeDefaultBrowser = defineRequest({
  channel: 'settings.makeDefaultBrowser',
  request: v.strictObject({}),
  response: v.strictObject({ outcome: v.picklist(['done', 'settings', 'failed']) }),
  capability: 'page:settings',
  ratePerSecond: 2,
});
