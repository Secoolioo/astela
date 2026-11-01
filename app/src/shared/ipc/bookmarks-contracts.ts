import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';

const Id = v.pipe(v.number(), v.integer(), v.minValue(1));
const Title = v.pipe(v.string(), v.maxLength(1024));
const WebUrl = v.pipe(v.string(), v.maxLength(8192), v.regex(/^https?:/i));

/**
 * A bookmark or a folder as the bookmarks page shows it. The two root folders, the
 * bookmarks bar and the other bookmarks, have no parent; folders have no address.
 */
export const BookmarkItem = v.strictObject({
  id: Id,
  parentId: v.nullable(Id),
  title: v.string(),
  url: v.nullable(v.string()),
});

/** A bookmark or a folder as the bookmarks page shows it. */
export type BookmarkItem = v.InferOutput<typeof BookmarkItem>;

/** Lists every bookmark and folder in display order. */
export const ListBookmarks = defineRequest({
  channel: 'bookmarks.list',
  request: v.strictObject({}),
  response: v.strictObject({ items: v.array(BookmarkItem) }),
  capability: 'page:bookmarks',
});

/** Adds a bookmark, or a folder when there is no address, at the end of a folder. */
export const AddBookmark = defineRequest({
  channel: 'bookmarks.add',
  request: v.strictObject({ parentId: Id, title: Title, url: v.optional(WebUrl) }),
  response: v.strictObject({ id: v.number() }),
  capability: 'page:bookmarks',
});

/** Renames a bookmark or folder, changes a bookmark's address, or moves either to a folder. */
export const UpdateBookmark = defineRequest({
  channel: 'bookmarks.update',
  request: v.strictObject({
    id: Id,
    title: Title,
    url: v.optional(WebUrl),
    parentId: v.optional(Id),
  }),
  response: v.null(),
  capability: 'page:bookmarks',
});

/** Removes a bookmark, or a folder with everything in it. */
export const RemoveBookmark = defineRequest({
  channel: 'bookmarks.remove',
  request: v.strictObject({ id: Id }),
  response: v.null(),
  capability: 'page:bookmarks',
});

/** Opens a bookmark in the bookmarks page's tab or in a new tab. */
export const OpenBookmark = defineRequest({
  channel: 'bookmarks.open',
  request: v.strictObject({ url: WebUrl, newTab: v.boolean() }),
  response: v.null(),
  capability: 'page:bookmarks',
});

/** Sent to open bookmarks pages when the bookmarks changed elsewhere, such as by the star. */
export const BookmarksChanged = defineEvent({
  channel: 'bookmarks.changed',
  payload: v.null(),
  capability: 'page:bookmarks',
});
