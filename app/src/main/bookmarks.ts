import { webContents, type Session } from 'electron';
import {
  AddBookmark,
  BookmarksChanged,
  ListBookmarks,
  OpenBookmark,
  RemoveBookmark,
  UpdateBookmark,
} from '../shared/ipc/bookmarks-contracts.ts';
import { bookmarkRoots } from '../shared/bookmarks.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { DataServiceClient } from '../platform/electron/data-service-client.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/**
 * The bookmarks in the browser process: which addresses have a bookmark, for the star in
 * the address bar, and the changes that the star and the bookmarks page make. The
 * addresses load with the first web page a tab shows, so the data service does not start
 * for a window that shows only the browser's own pages.
 */
export class Bookmarks {
  private urls = new Set<string>();
  private rows: readonly BookmarkEntry[] = [];
  private loaded: Promise<void> | undefined;
  /** Whether the bookmarks loaded at least once, so the cache tells which pages have one. */
  private ready = false;
  private readonly data: DataServiceClient;
  private readonly router: IpcRouter;
  private readonly internal: Session;
  private readonly onChange: () => void;
  private readonly logger: Logger;

  /**
   * @param data - The data service.
   * @param router - IPC router, to tell open bookmarks pages about changes.
   * @param internal - Session of the browser's own pages.
   * @param onChange - Called when the bookmarked addresses changed, to update the shells.
   * @param logger - Receives failures.
   */
  constructor(
    data: DataServiceClient,
    router: IpcRouter,
    internal: Session,
    onChange: () => void,
    logger: Logger,
  ) {
    this.data = data;
    this.router = router;
    this.internal = internal;
    this.onChange = onChange;
    this.logger = logger;
  }

  /**
   * Whether a page has a bookmark. The first web page loads the bookmarked addresses; the
   * shells update when they arrive.
   * @param url - The page's address.
   */
  has(url: string): boolean {
    if (!/^https?:/i.test(url)) return false;
    this.loaded ??= this.load();
    return this.urls.has(url);
  }

  /**
   * The items of the bookmarks bar. The first call loads the bookmarks; the shells update
   * when they arrive.
   */
  barItems(): { id: number; title: string; url: string | null }[] {
    this.loaded ??= this.load();
    return this.contents(bookmarkRoots.bar).map(({ id, title, url }) => ({ id, title, url }));
  }

  /**
   * The bookmarks and folders in a folder, in their order.
   * @param folder - The folder's id.
   */
  contents(folder: number): BookmarkEntry[] {
    return this.rows
      .filter((row) => row.parentId === folder)
      .map(({ id, parentId, title, url }) => ({ id, parentId, title, url }));
  }

  /**
   * Adds a bookmark for a page to the bookmarks bar, or removes every bookmark of the page.
   * @param url - The page's address.
   * @param title - The page's title.
   */
  toggle(url: string, title: string): void {
    void (async () => {
      await (this.loaded ??= this.load());
      if (url.length > 8192) return;
      // Without the bookmarks, the star cannot tell adding from removing: it loads them
      // again, and if that fails too, nothing changes.
      if (!this.ready) await this.refresh();
      await (this.urls.has(url)
        ? this.data.call('removeBookmarkUrl', url)
        : this.data.call(
            'addBookmark',
            bookmarkRoots.bar,
            (title.trim() || url).slice(0, 1024),
            url,
          ));
      await this.changed();
    })().catch((error: unknown) =>
      this.logger.warn('The bookmark was not saved', { error: String(error) }),
    );
  }

  /** Loads the bookmarked addresses again and tells the shells and bookmarks pages. */
  async changed(): Promise<void> {
    await this.refresh();
    for (const contents of webContents.getAllWebContents()) {
      if (contents.session === this.internal) this.router.publish(BookmarksChanged, contents, null);
    }
  }

  /** Loads the bookmarks once; after a failure, they load again with a question 30 s later. */
  private load(): Promise<void> {
    return this.refresh().catch((error: unknown) => {
      this.logger.warn('The bookmarks did not load', { error: String(error) });
      setTimeout(() => (this.loaded = undefined), 30_000).unref();
    });
  }

  private async refresh(): Promise<void> {
    this.rows = await this.data.call('bookmarkList');
    this.urls = new Set(this.rows.flatMap((row) => (row.url === null ? [] : [row.url])));
    this.ready = true;
    this.onChange();
  }
}

/** A bookmark or folder; folders have no address. */
export interface BookmarkEntry {
  readonly id: number;
  readonly parentId: number | null;
  readonly title: string;
  readonly url: string | null;
}

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
