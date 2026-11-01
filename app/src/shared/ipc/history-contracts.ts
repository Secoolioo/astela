import * as v from 'valibot';
import { defineRequest } from './contract.ts';

/** A page of the history as the history page shows it. */
export const HistoryItem = v.strictObject({
  id: v.number(),
  url: v.string(),
  title: v.string(),
  lastVisit: v.number(),
});

/** A page of the history as the history page shows it. */
export type HistoryItem = v.InferOutput<typeof HistoryItem>;

/** Lists the history, newest first, optionally matching search words. */
export const ListHistory = defineRequest({
  channel: 'history.list',
  request: v.strictObject({
    query: v.pipe(v.string(), v.maxLength(256)),
    before: v.optional(v.number()),
  }),
  response: v.strictObject({ items: v.array(HistoryItem) }),
  capability: 'page:history',
});

/** Removes pages from the history. */
export const DeleteHistory = defineRequest({
  channel: 'history.delete',
  request: v.strictObject({ ids: v.pipe(v.array(v.number()), v.maxLength(1000)) }),
  response: v.null(),
  capability: 'page:history',
});

/** Removes the whole history. */
export const ClearHistory = defineRequest({
  channel: 'history.clear',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'page:history',
});

/** Opens a page of the history in the history page's tab or in a new tab. */
export const OpenFromHistory = defineRequest({
  channel: 'history.open',
  request: v.strictObject({
    url: v.pipe(v.string(), v.maxLength(8192), v.regex(/^https?:/i)),
    newTab: v.boolean(),
  }),
  response: v.null(),
  capability: 'page:history',
});
