import { webContents, type Session } from 'electron';
import { BookmarksChanged } from '../shared/ipc/bookmarks-contracts.ts';
import { bookmarkRoots } from '../shared/bookmarks.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { DataClient } from '../platform/electron/data-service-client.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';

/** A folder of the bookmarks, with its depth below the bookmarks bar or the other bookmarks. */
export interface BookmarkFolder {
  readonly id: number;
  readonly title: string;
  /** 0 for the bookmarks bar and the other bookmarks themselves. */
  readonly depth: number;
}

/** At most this many folders are offered to move a bookmark to, and this deep. */
const folderLimit = 500;
const folderDepth = 20;

/**
 * The bookmarks in the browser process: which addresses have a bookmark, for the star in
 * the address bar, and the changes that the star's popover and the bookmarks page make. The
 * addresses load with the first web page a tab shows, so the data service does not start
 * for a window that shows only the browser's own pages.
 */
export class Bookmarks {
  private urls = new Set<string>();
  private rows: readonly BookmarkEntry[] = [];
  /** The rows by their id, made with each load. */
  private byId = new Map<number, BookmarkEntry>();
  /** The bookmarks and folders of each folder, in their order, made with each load. */
  private children = new Map<number, readonly BookmarkEntry[]>();
  private loaded: Promise<void> | undefined;
  /** Whether the bookmarks loaded at least once, so the cache tells which pages have one. */
  private ready = false;
  private readonly data: DataClient;
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
    data: DataClient,
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

  /** Every bookmark, without folders; the first call loads the bookmarks. */
  pages(): { title: string; url: string }[] {
    this.loaded ??= this.load();
    return this.rows.flatMap(({ title, url }) => (url === null ? [] : [{ title, url }]));
  }

  /** Every bookmark, without folders, once the bookmarks have loaded. */
  async loadedPages(): Promise<{ title: string; url: string }[]> {
    await (this.loaded ??= this.load());
    return this.pages();
  }

  /**
   * The bookmarks and folders in a folder, in their order.
   * @param folder - The folder's id.
   */
  contents(folder: number): BookmarkEntry[] {
    return (this.children.get(folder) ?? []).map(({ id, parentId, title, url }) => ({
      id,
      parentId,
      title,
      url,
    }));
  }

  /**
   * The first bookmark of a page, in the order of the bookmarks bar and then of the other
   * bookmarks, folder by folder, once the bookmarks have loaded.
   * @param url - The page's address.
   * @returns The bookmark, or `undefined` when the page has none.
   * @throws Error when the bookmarks cannot be loaded, so that nothing is added twice.
   */
  async firstOf(url: string): Promise<BookmarkEntry | undefined> {
    await this.current();
    return this.inOrder().find((row) => row.url === url);
  }

  /**
   * The folders that a bookmark can move to: the bookmarks bar and the other bookmarks with
   * the folders in them, each after the folder it is in, at most 500 and 20 levels deep.
   */
  async folders(): Promise<BookmarkFolder[]> {
    await this.current();
    const folders: BookmarkFolder[] = [];
    const walk = (id: number, depth: number): void => {
      const row = this.byId.get(id);
      if (row === undefined || folders.length >= folderLimit) return;
      folders.push({ id, title: row.title, depth });
      if (depth >= folderDepth) return;
      for (const child of this.children.get(id) ?? []) {
        if (child.url === null) walk(child.id, depth + 1);
      }
    };
    walk(bookmarkRoots.bar, 0);
    walk(bookmarkRoots.other, 0);
    return folders;
  }

  /**
   * Adds a bookmark for a page at the end of a folder.
   * @param url - The page's address.
   * @param title - The page's title; the address names a page without one.
   * @param parent - The folder; the bookmarks bar by default.
   * @returns The new bookmark's id.
   */
  async add(url: string, title: string, parent: number = bookmarkRoots.bar): Promise<number> {
    const id = await this.data.call('addBookmark', parent, nameOf(title, url), url);
    await this.changed();
    return id;
  }

  /**
   * Renames a bookmark and moves it to the end of another folder, or leaves it in its folder.
   * @param id - The bookmark.
   * @param title - Its new name.
   * @param parent - The folder it goes to.
   */
  async update(id: number, title: string, parent: number): Promise<void> {
    const row = this.byId.get(id);
    await this.data.call(
      'updateBookmark',
      id,
      title.slice(0, 1024),
      undefined,
      row?.parentId === parent ? undefined : parent,
    );
    await this.changed();
  }

  /**
   * Removes every bookmark of a page.
   * @param url - The page's address.
   */
  async removeUrl(url: string): Promise<void> {
    await this.data.call('removeBookmarkUrl', url);
    await this.changed();
  }

  /** The bookmarks as they are now: loaded once, and again after a failure. */
  private async current(): Promise<void> {
    await (this.loaded ??= this.load());
    // Without the bookmarks, the star cannot tell whether a page has one: they load again,
    // and a failure then goes to the caller.
    if (!this.ready) await this.refresh();
  }

  /** Every bookmark and folder, each folder's contents after it, the bookmarks bar first. */
  private inOrder(): BookmarkEntry[] {
    const ordered: BookmarkEntry[] = [];
    const seen = new Set<number>();
    const walk = (folder: number): void => {
      for (const row of this.children.get(folder) ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        ordered.push(row);
        if (row.url === null) walk(row.id);
      }
    };
    walk(bookmarkRoots.bar);
    walk(bookmarkRoots.other);
    return ordered;
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
    const rows = await this.data.call('bookmarkList');
    // The folders and the star look rows up by id and by folder; one pass over the rows
    // makes both, so that a large tree costs no more than a pass per load.
    const byId = new Map<number, BookmarkEntry>();
    const children = new Map<number, BookmarkEntry[]>();
    const urls = new Set<string>();
    for (const row of rows) {
      byId.set(row.id, row);
      if (row.url !== null) urls.add(row.url);
      if (row.parentId === null) continue;
      const siblings = children.get(row.parentId);
      if (siblings === undefined) children.set(row.parentId, [row]);
      else siblings.push(row);
    }
    this.rows = rows;
    this.byId = byId;
    this.children = children;
    this.urls = urls;
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
 * The name of a new bookmark: the page's title, or its address when it has none.
 * @param title - The page's title.
 * @param url - The page's address.
 */
function nameOf(title: string, url: string): string {
  return (title.trim() || url).slice(0, 1024);
}
