import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';

/** A tile of the new tab page: a web page that it opens. */
const Tile = v.strictObject({
  title: v.pipe(v.string(), v.maxLength(64)),
  url: v.pipe(v.string(), v.maxLength(8192), v.regex(/^https?:\/\/\S+$/i)),
});

/** A color that people chose, as `#rrggbb`. */
const Hex = v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i));

/**
 * The background of the new tab page: none, one color, a gradient of two, or an image that
 * the browser copied into the profile, by its file name there.
 */
export const NewTabBackground = v.variant('kind', [
  v.strictObject({ kind: v.literal('none') }),
  v.strictObject({ kind: v.literal('color'), color: Hex }),
  v.strictObject({ kind: v.literal('gradient'), from: Hex, to: Hex }),
  v.strictObject({
    kind: v.literal('image'),
    file: v.pipe(v.string(), v.regex(/^background-[0-9a-f]{16}\.(?:png|jpg|webp|gif|avif)$/)),
  }),
]);

/** The background of the new tab page. */
export type NewTabBackground = v.InferOutput<typeof NewTabBackground>;

/**
 * What the new tab page shows: the name of the search engine, `null` for a custom one,
 * whether it shows the search field and a clock, its tiles, the sites opened most often,
 * and its background.
 */
const NewTabState = v.strictObject({
  engine: v.nullable(v.string()),
  search: v.boolean(),
  clock: v.boolean(),
  tiles: v.array(Tile),
  mostVisited: v.array(Tile),
  background: NewTabBackground,
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
