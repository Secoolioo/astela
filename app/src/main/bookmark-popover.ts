import type { Logger } from '../kernel/logging/logger.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { bookmarkRoots } from '../shared/bookmarks.ts';
import type { PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import { RemoveBookmark, SaveBookmark } from '../shared/ipc/overlay-contracts.ts';
import type { Bookmarks } from './bookmarks.ts';
import { focusBackOf, overlayBySender, overlayOf, rectOf, track } from './overlays.ts';

/** What the popover of the bookmark star needs from the browser process. */
export interface BookmarkPopoverDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  readonly bookmarks: Bookmarks;
  readonly logger: Logger;
}

/** The bookmark that a popover of the star edits, and the folders that it offers. */
interface Editing {
  readonly id: number;
  readonly url: string;
  readonly folders: ReadonlySet<number>;
}

const editing = new WeakMap<WindowOverlay, Editing>();
/** The bookmarks that the star adds now, by address, so that a second click adds no second one. */
const adding = new Map<string, Promise<number>>();
let connected = false;

/** Adds a bookmark for a page, once for clicks that come while it is being added. */
function addOnce(bookmarks: Bookmarks, url: string, title: string): Promise<number> {
  let added = adding.get(url);
  if (added === undefined) {
    added = bookmarks.add(url, title).finally(() => adding.delete(url));
    adding.set(url, added);
  }
  return added;
}

/**
 * Opens the popover of the bookmark star for the page of a window's active tab, at the star.
 * A page without a bookmark gets one in the bookmarks bar first, as the star always did; the
 * popover then names it, moves it to another folder or removes it. Pages of the browser's own
 * and tabs that changed meanwhile get no popover.
 * @param window - The window.
 * @param anchor - The star, or the menu button without it, and whether the keyboard opened it.
 * @param deps - What the popover needs.
 */
export async function openBookmarkPopover(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  deps: BookmarkPopoverDependencies,
): Promise<void> {
  const tab = window.tabs.active;
  if (tab === undefined || !/^https?:/i.test(tab.url) || tab.url.length > 8192) return;
  const { bookmarks } = deps;
  const found = adding.has(tab.url) ? undefined : await bookmarks.firstOf(tab.url);
  const added = found === undefined;
  const id = found?.id ?? (await addOnce(bookmarks, tab.url, tab.title));
  const folders = await bookmarks.folders();
  const folder = found?.parentId ?? bookmarkRoots.bar;
  // The page or the window may have changed while the bookmarks loaded.
  if (window.window.isDestroyed() || window.tabs.active?.id !== tab.id) return;
  if (window.tabs.active.url !== tab.url) return;
  const overlay = overlayOf(window, deps.overlay, deps.router);
  if (!connected) connect(deps);
  // The folder that the bookmark is in counts as offered, also beyond the folders listed.
  const offered = new Set([folder, ...folders.map((candidate) => candidate.id)]);
  const state: Editing = { id, url: tab.url, folders: offered };
  overlay.open(
    {
      kind: 'bookmark',
      anchor: rectOf(anchor),
      added,
      id,
      title: (found?.title ?? (tab.title.trim() || tab.url)).slice(0, 1024),
      folder,
      folders: folders.map(({ id: folderId, title, depth }) => ({
        id: folderId,
        title: title.slice(0, 1024),
        depth,
      })),
    },
    {
      popover: { kind: 'bookmark', folder: null },
      focusBack: focusBackOf(window, anchor),
      // Escape belongs to the page, which closes without saving; what was typed is kept from
      // the questions of sites.
      keys: { escape: 'page' },
      yieldsToQuestions: false,
      onClose: () => {
        if (editing.get(overlay) === state) editing.delete(overlay);
      },
    },
  );
  editing.set(overlay, state);
  track(window, overlay);
}

function connect(deps: BookmarkPopoverDependencies): void {
  connected = true;
  const { router, bookmarks } = deps;
  const warn = (error: unknown): void =>
    deps.logger.warn('The bookmark was not saved', { error: String(error) });
  router.handle(SaveBookmark, ({ id, title, folder }, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const state = overlay === undefined ? undefined : editing.get(overlay);
    // The page names the bookmark that it shows and one of the folders that it offers.
    if (overlay === undefined || state === undefined || state.id !== id) return null;
    if (!state.folders.has(folder)) return null;
    overlay.close();
    bookmarks.update(id, title.trim() || state.url, folder).catch(warn);
    return null;
  });
  router.handle(RemoveBookmark, (_request, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const state = overlay === undefined ? undefined : editing.get(overlay);
    if (overlay === undefined || state === undefined) return null;
    overlay.close();
    bookmarks.removeUrl(state.url).catch(warn);
    return null;
  });
}
