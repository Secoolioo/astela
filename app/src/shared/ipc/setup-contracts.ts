import * as v from 'valibot';
import { defineRequest } from './contract.ts';

/** Ends the setup guide: its tab shows the new tab page. */
export const FinishSetup = defineRequest({
  channel: 'setup.finish',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'page:setup',
});

/** Opens the setup guide again, from the settings page. */
export const OpenSetup = defineRequest({
  channel: 'settings.openSetup',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'page:settings',
});
