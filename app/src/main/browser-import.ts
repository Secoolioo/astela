import { FindBrowsers, ImportBrowser } from '../shared/ipc/import-contracts.ts';
import type { Bookmarks } from './bookmarks.ts';
import type { DataServiceClient } from '../platform/electron/data-service-client.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Connects the import from other browsers: the data service finds them and reads their
 * bookmarks and history; imported open tabs open in new windows, where only the active tab
 * of each window loads.
 * @param router - IPC router.
 * @param data - The data service.
 * @param bookmarks - Told about imported bookmarks, for the star and bookmarks pages.
 * @param windows - Open windows.
 * @param enabled - Whether a policy allows the import.
 */
export function connectBrowserImport(
  router: IpcRouter,
  data: DataServiceClient,
  bookmarks: Bookmarks,
  windows: WindowManager,
  enabled: () => boolean,
): void {
  router.handle(FindBrowsers, async () =>
    enabled()
      ? { enabled: true, profiles: await data.call('findBrowsers') }
      : { enabled: false, profiles: [] },
  );
  router.handle(ImportBrowser, async ({ id, bookmarks: withBookmarks, history, tabs, labels }) => {
    if (!enabled()) {
      throw new Error('A policy turned the import off');
    }
    const result = await data.call(
      'importBrowser',
      id,
      { bookmarks: withBookmarks, history, tabs },
      labels,
    );
    if (result.windows.length > 0) {
      windows.restore({
        version: 1,
        windows: result.windows.map((window) => ({
          tabs: [...window.tabs],
          active: window.active,
        })),
      });
    }
    if (result.bookmarks > 0) {
      await bookmarks.changed();
    }
    return {
      bookmarks: result.bookmarks,
      history: result.history,
      tabs: result.windows.reduce((sum, window) => sum + window.tabs.length, 0),
      failed: [...result.failed],
    };
  });
}
