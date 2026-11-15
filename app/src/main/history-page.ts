import {
  ClearHistory,
  DeleteHistory,
  ListHistory,
  OpenFromHistory,
} from '../shared/ipc/history-contracts.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * Connects the history page to the data service: it lists and searches the history, deletes
 * pages from it, and opens a page in its own tab or a new one. Clearing the history also
 * clears the back and forward history of the tabs and of the session.
 * @param router - IPC router.
 * @param data - The data service.
 * @param windows - Open windows.
 * @param forgetTabHistories - Forgets the back and forward history of the tabs and of the
 *   session files.
 */
export function connectHistoryPage(
  router: IpcRouter,
  data: DataClient,
  windows: WindowManager,
  forgetTabHistories: () => Promise<void>,
): void {
  router.handle(ListHistory, async ({ query, before }) => {
    const entries = await data.call('history', query, 200, before ?? Number.MAX_SAFE_INTEGER);
    return {
      items: entries.map(({ id, url, title, lastVisit }) => ({ id, url, title, lastVisit })),
    };
  });
  router.handle(DeleteHistory, async ({ ids }) => {
    await data.call('deleteHistory', ids);
    return null;
  });
  router.handle(ClearHistory, async () => {
    await data.call('clearHistory');
    await forgetTabHistories();
    return null;
  });
  router.handle(OpenFromHistory, ({ url, newTab }, { sender }) => {
    const window = windows.forTab(sender);
    const tabId = window?.tabIdOf(sender);
    if (window !== undefined && tabId !== undefined) {
      if (newTab) window.tabs.open(url, { activate: false });
      else window.tabs.navigate(tabId, url);
    }
    return null;
  });
}
