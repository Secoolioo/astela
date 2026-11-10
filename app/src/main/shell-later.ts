import type { WebContents } from 'electron';
import type { OverlayAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  FindInPage,
  OpenBlockerPopover,
  OpenBookmarkFolder,
  OpenDownloads,
  OpenMenu,
  ProceedUnsafely,
  ReopenClosedTab,
  ResetZoom,
  StopFinding,
  ToggleBookmark,
} from '../shared/ipc/shell-later-contracts.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { FolderEntry } from './browser-menu.ts';

/** What the later requests of the shell need from the composition root. */
export interface LaterShellDependencies {
  readonly router: IpcRouter;
  readonly windows: WindowManager;
  /** Whether people may open private windows. */
  readonly privateWindows: () => boolean;
  /** Shows the list of downloads of a window at its button. */
  readonly openDownloads: (window: BrowserWindowController, anchor: OverlayAnchor) => void;
  /** Accepts the certificate that a page was refused, for this session. */
  readonly allowCertificate: (contents: WebContents) => boolean;
  /** The bookmarks and folders in a folder of the bookmarks bar. */
  readonly folderContents: (folder: number) => readonly FolderEntry[];
  /** Opens the content blocker's popover of a window at its button. */
  readonly openShieldPopover: (
    window: BrowserWindowController,
    anchor: OverlayAnchor,
  ) => Promise<void>;
}

/**
 * Handles the requests of the shell that its first paint does not need, such as find in page
 * and the browser menu. They load with the first of them.
 * @param dependencies - What the handlers need.
 */
export function registerLaterShellHandlers(dependencies: LaterShellDependencies): void {
  const { router, windows } = dependencies;
  const windowOf = (sender: WebContents): BrowserWindowController => {
    const window = windows.forShell(sender);
    if (window === undefined) throw new Error('No window for this shell');
    return window;
  };
  router.handle(
    ReopenClosedTab,
    (_request, { sender }) => (windowOf(sender).tabs.reopenClosed(), null),
  );
  router.handle(FindInPage, ({ tabId, query, forward, next }, { sender }) => {
    windowOf(sender).find(tabId, query, forward, next);
    return null;
  });
  router.handle(StopFinding, ({ tabId }, { sender }) => (windowOf(sender).stopFind(tabId), null));
  router.handle(ResetZoom, ({ tabId }, { sender }) => (windowOf(sender).zoom(tabId, 0), null));
  router.handle(
    ToggleBookmark,
    (_request, { sender }) => (windowOf(sender).execute('bookmark.toggle'), null),
  );
  router.handle(OpenMenu, async (position, { sender }) => {
    const window = windowOf(sender);
    const { popupBrowserMenu } = await import('./browser-menu.ts');
    popupBrowserMenu(window, position, { privateWindows: dependencies.privateWindows() });
    return null;
  });
  router.handle(OpenDownloads, (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window !== undefined) dependencies.openDownloads(window, anchor);
    return null;
  });
  router.handle(ProceedUnsafely, ({ tabId }, { sender }) => {
    windows.forShell(sender)?.proceedUnsafely(tabId, dependencies.allowCertificate);
    return null;
  });
  router.handle(OpenBookmarkFolder, async ({ id, from, x, y }, { sender }) => {
    const window = windows.forShell(sender);
    if (window === undefined) return null;
    const { popupBookmarkFolder } = await import('./browser-menu.ts');
    popupBookmarkFolder(
      window,
      { x, y },
      { id, from },
      dependencies.folderContents,
      (url, newTab) => {
        const active = window.tabs.active;
        if (newTab || active === undefined) window.tabs.open(url);
        else window.tabs.navigate(active.id, url);
      },
    );
    return null;
  });
  router.handle(OpenBlockerPopover, async (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window !== undefined) await dependencies.openShieldPopover(window, anchor);
    return null;
  });
}
