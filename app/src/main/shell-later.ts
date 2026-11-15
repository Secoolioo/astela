import type { WebContents } from 'electron';
import type { PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  FindInPage,
  OpenBlockerPopover,
  OpenBookmarkFolder,
  OpenBookmarkPopover,
  OpenDownloads,
  OpenMenu,
  PrepareOverlay,
  ProceedInsecurely,
  ProceedUnsafely,
  ReopenClosedTab,
  ResetZoom,
  SetTabMuted,
  GetFavicon,
  MoveTab,
  OpenTabMenu,
  SuggestAddresses,
  SelectSuggestion,
  AcceptSuggestion,
  CloseSuggestions,
  StopFinding,
} from '../shared/ipc/shell-later-contracts.ts';
import type { FolderEntry } from '../domain/menus/browser-menu.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import type { Bookmarks } from './bookmarks.ts';
import type { SuggestionDependencies } from './suggestions.ts';

/** What the later requests of the shell need from the composition root. */
export interface LaterShellDependencies {
  readonly router: IpcRouter;
  readonly windows: WindowManager;
  readonly logger: Logger;
  /** What the overlays of all windows share, for the menus and the popover of the star. */
  readonly overlay: OverlayOptions;
  /** Shows the list of downloads of a window at its button. */
  readonly openDownloads: (window: BrowserWindowController, anchor: PopoverAnchor) => void;
  /** Accepts the certificate that a page was refused, for this session. */
  readonly allowCertificate: (contents: WebContents) => boolean;
  /** Allows the insecure address of a site for the session of a page. */
  readonly allowInsecure: (contents: WebContents, address: string) => void;
  /** The bookmarks and folders in a folder of the bookmarks bar. */
  readonly folderContents: (folder: number) => readonly FolderEntry[];
  /** The bookmarks of the browser process, which load with the first of their users. */
  readonly bookmarks: () => Promise<Bookmarks>;
  /** Where the suggestions of the address bar come from. */
  readonly suggestions: Omit<SuggestionDependencies, 'router' | 'windows'>;
  /** Opens the content blocker's popover of a window at its button. */
  readonly openShieldPopover: (
    window: BrowserWindowController,
    anchor: PopoverAnchor,
  ) => Promise<void>;
}

/**
 * Handles the requests of the shell that its first paint does not need, such as find in page
 * and the browser menu. They load with the first of them.
 * @param dependencies - What the handlers need.
 */
export function registerLaterShellHandlers(dependencies: LaterShellDependencies): void {
  const { router, windows } = dependencies;
  const menus = {
    windows,
    router,
    overlay: dependencies.overlay,
    folderContents: dependencies.folderContents,
  };
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
    GetFavicon,
    async ({ key }, { sender }) => (await windowOf(sender).favicon(key)) ?? null,
  );
  const suggestions = {
    ...dependencies.suggestions,
    router,
    windows: (): readonly BrowserWindowController[] => windows.all,
  };
  router.handle(SuggestAddresses, async ({ text, tabId, ...place }, { sender }) => {
    const window = windowOf(sender);
    const { suggest } = await import('./suggestions.ts');
    await suggest(window, text, place, suggestions, tabId);
    return null;
  });
  router.handle(SelectSuggestion, async ({ step }, { sender }) => {
    const window = windowOf(sender);
    const { select } = await import('./suggestions.ts');
    return select(window, step);
  });
  router.handle(AcceptSuggestion, async (_request, { sender }) => {
    const window = windowOf(sender);
    const { accept } = await import('./suggestions.ts');
    return accept(window);
  });
  router.handle(CloseSuggestions, async (_request, { sender }) => {
    const window = windowOf(sender);
    const { dismiss } = await import('./suggestions.ts');
    dismiss(window);
    return null;
  });
  router.handle(OpenTabMenu, async ({ tabId, x, y }, { sender }) => {
    const window = windowOf(sender);
    const { popupTabMenu } = await import('./tab-menu.ts');
    popupTabMenu(window, tabId, { x, y });
    return null;
  });
  router.handle(MoveTab, ({ tabId, index }, { sender }) => {
    const { tabs } = windowOf(sender);
    if (tabs.all.some((tab) => tab.id === tabId)) tabs.move(tabId, index);
    return null;
  });
  router.handle(
    SetTabMuted,
    ({ tabId, muted }, { sender }) => (windowOf(sender).setMuted(tabId, muted), null),
  );
  router.handle(OpenBookmarkPopover, async (anchor, { sender }) => {
    const window = windowOf(sender);
    const [{ openBookmarkPopover }, bookmarks] = await Promise.all([
      import('./bookmark-popover.ts'),
      dependencies.bookmarks(),
    ]);
    await openBookmarkPopover(window, anchor, {
      windows,
      router,
      overlay: dependencies.overlay,
      bookmarks,
      logger: dependencies.logger,
    });
    return null;
  });
  router.handle(OpenMenu, async (anchor, { sender }) => {
    const window = windowOf(sender);
    const { openBrowserMenu } = await import('./menu-popover.ts');
    openBrowserMenu(window, anchor, menus);
    return null;
  });
  router.handle(PrepareOverlay, async (_request, { sender }) => {
    const window = windowOf(sender);
    const { overlayOf } = await import('./overlays.ts');
    overlayOf(window, dependencies.overlay, router).prepare();
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
  router.handle(ProceedInsecurely, ({ tabId }, { sender }) => {
    windows.forShell(sender)?.proceedInsecurely(tabId, dependencies.allowInsecure);
    return null;
  });
  router.handle(OpenBookmarkFolder, async ({ id, from, ...anchor }, { sender }) => {
    const window = windows.forShell(sender);
    if (window === undefined) return null;
    const { openFolderMenu } = await import('./menu-popover.ts');
    openFolderMenu(window, anchor, { id, from }, menus);
    return null;
  });
  router.handle(OpenBlockerPopover, async (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window !== undefined) await dependencies.openShieldPopover(window, anchor);
    return null;
  });
}
