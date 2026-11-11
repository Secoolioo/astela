import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';

/** A tile of the new tab page: a web page that it opens. */
const Tile = v.strictObject({
  title: v.pipe(v.string(), v.maxLength(64)),
  url: v.pipe(v.string(), v.maxLength(8192), v.regex(/^https?:\/\/\S+$/i)),
});

/**
 * What the new tab page shows: the name of the search engine, `null` for a custom one,
 * whether it shows the search field and a clock, and its tiles.
 */
const NewTabState = v.strictObject({
  engine: v.nullable(v.string()),
  search: v.boolean(),
  clock: v.boolean(),
  tiles: v.array(Tile),
});

/** What the new tab page shows. */
export type NewTabState = v.InferOutput<typeof NewTabState>;

/** Returns what the new tab page shows. */
export const GetNewTabState = defineRequest({
  channel: 'newtab.getState',
  request: v.strictObject({}),
  response: NewTabState,
  capability: 'page:newtab',
});

/** Sent to new tab pages when what they show changed in the settings. */
export const NewTabChanged = defineEvent({
  channel: 'newtab.changed',
  payload: NewTabState,
  capability: 'page:newtab',
});

/** Searches for, or opens, what the user typed on the new tab page, in the same tab. */
export const NavigateFromNewTab = defineRequest({
  channel: 'newtab.navigate',
  request: v.strictObject({ input: v.pipe(v.string(), v.minLength(1), v.maxLength(8192)) }),
  response: v.null(),
  capability: 'page:newtab',
});
