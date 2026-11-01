import * as v from 'valibot';
import { defineRequest } from './contract.ts';

/** What the new tab page shows: the name of the search engine, `null` for a custom one. */
export const GetNewTabState = defineRequest({
  channel: 'newtab.getState',
  request: v.strictObject({}),
  response: v.strictObject({ engine: v.nullable(v.string()) }),
  capability: 'page:newtab',
});

/** Searches for, or opens, what the user typed on the new tab page, in the same tab. */
export const NavigateFromNewTab = defineRequest({
  channel: 'newtab.navigate',
  request: v.strictObject({ input: v.pipe(v.string(), v.minLength(1), v.maxLength(8192)) }),
  response: v.null(),
  capability: 'page:newtab',
});
