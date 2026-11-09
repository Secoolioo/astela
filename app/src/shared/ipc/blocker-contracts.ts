import * as v from 'valibot';
import { defineRequest } from './contract.ts';

/**
 * Tells the settings page whether the content blocker works: `failed` means its filter data
 * is missing or damaged, so it blocks nothing. Asking loads the filter data.
 */
export const GetBlockerStatus = defineRequest({
  channel: 'settings.getBlockerStatus',
  request: v.strictObject({}),
  response: v.strictObject({ status: v.picklist(['idle', 'loading', 'ready', 'failed']) }),
  capability: 'page:settings',
});
