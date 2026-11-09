import {
  AddBookmark,
  ListBookmarks,
  OpenBookmark,
  RemoveBookmark,
  UpdateBookmark,
} from '../shared/ipc/bookmarks-contracts.ts';
import type { Bookmarks } from './bookmarks.ts';
import type { DataServiceClient } from '../platform/electron/data-service-client.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Connects the bookmarks page to the data service: it lists the bookmarks, adds, edits,
 * moves and removes them, and opens a bookmark in its own tab or a new one.
 * @param router - IPC router.
 * @param data - The data service.
 * @param bookmarks - The bookmarks of the browser process, told about every change.
 * @param windows - Open windows.
 */
export function connectBookmarksPage(
  router: IpcRouter,
  data: DataServiceClient,
  bookmarks: Bookmarks,
  windows: WindowManager,
): void {
  router.handle(ListBookmarks, async () => ({ items: await data.call('bookmarkList') }));
  router.handle(AddBookmark, async ({ parentId, title, url }) => {
    const id = await data.call('addBookmark', parentId, title, url);
    await bookmarks.changed();
    return { id };
  });
  router.handle(UpdateBookmark, async ({ id, title, url, parentId }) => {
    await data.call('updateBookmark', id, title, url, parentId);
    await bookmarks.changed();
    return null;
  });
  router.handle(RemoveBookmark, async ({ id }) => {
    await data.call('removeBookmark', id);
    await bookmarks.changed();
    return null;
  });
  router.handle(OpenBookmark, ({ url, newTab }, { sender }) => {
    const window = windows.forTab(sender);
    const tabId = window?.tabIdOf(sender);
    if (window !== undefined && tabId !== undefined) {
      if (newTab) window.tabs.open(url, { activate: false });
      else window.tabs.navigate(tabId, url);
    }
    return null;
  });
}
