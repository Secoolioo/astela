import { webContents, type WebContents } from 'electron';
import type { PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  FindInPage,
  OpenBlockerPopover,
  OpenPopupsPopover,
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
  KeyOnTab,
  FocusContent,
  GetFavicon,
  MoveTab,
  OpenTabMenu,
  SuggestAddresses,
  SelectSuggestion,
  AcceptSuggestion,
  CloseSuggestions,
  ResizeSplit,
  StopFinding,
  ToggleGroup,
  OpenGroupEditor,
  EditGroupRequested,
  OpenWorkspaces,
  MoveTabToWorkspace,
  ToggleReader,
  TogglePictureInPicture,
  HoldTopRows,
  OpenSiteInfo,
} from '../shared/ipc/shell-later-contracts.ts';
import type { FolderEntry } from '../domain/menus/browser-menu.ts';
import type { TabId } from '../domain/tabs/tab-service.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import type { Bookmarks } from './bookmarks.ts';
import type { SuggestionDependencies } from './suggestions.ts';
import type { Workspaces } from './workspaces.ts';

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
  /** The code of the workspaces, which loads with its first use. */
  readonly workspaces: () => Promise<Workspaces>;
  /** Where the suggestions of the address bar come from. */
  readonly suggestions: Omit<SuggestionDependencies, 'router' | 'windows'>;
  /** Opens the content blocker's popover of a window at its button. */
  readonly openShieldPopover: (
    window: BrowserWindowController,
    anchor: PopoverAnchor,
  ) => Promise<void>;
  /** Opens site information for the page of a window's active tab at the chip of its connection. */
  readonly openSiteInfo: (window: BrowserWindowController, anchor: PopoverAnchor) => Promise<void>;
  /**
   * Asks the pages of tabs what only they can tell before the tabs go to sleep, such as a video
   * in picture in picture that a page started itself.
   */
  readonly beforeSleep: (window: BrowserWindowController, ids: readonly TabId[]) => Promise<void>;
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
  // The button of the reader view runs its command, as its key does. The button of picture in
  // picture tells whether it showed itself pressed, so that the click does what it showed.
  router.handle(
    ToggleReader,
    (_request, { sender }) => (windowOf(sender).execute('reader.toggle'), null),
  );
  router.handle(
    TogglePictureInPicture,
    ({ pressed }, { sender }) => (windowOf(sender).togglePictureInPicture(pressed), null),
  );
  // What holds the rows that hide open in the shell: the pointer over them, and the focus.
  router.handle(HoldTopRows, (holds, { sender }) => (windowOf(sender).rows?.hold(holds), null));
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
  router.handle(OpenTabMenu, async ({ tabId, x, y, keyboard }, { sender }) => {
    const window = windowOf(sender);
    // Only a window with another workspace to move the tab into loads the code of workspaces.
    const [{ popupTabMenu }, workspaces] = await Promise.all([
      import('./tab-menu.ts'),
      window.commandContext().workspaces > 1 ? dependencies.workspaces() : undefined,
    ]);
    // The shell opens the popover of a new group at its chip, once the chip shows, as opened
    // with the keyboard when the keyboard opened the menu.
    popupTabMenu(
      window,
      tabId,
      { x, y },
      {
        editGroup: (groupId) =>
          router.publish(EditGroupRequested, window.shellContents, { groupId, keyboard }),
        workspaces: workspaces?.targets(window, tabId) ?? [],
        moveToWorkspace: (workspaceId) => workspaces?.moveTab(window, tabId, workspaceId),
        beforeSleep: () => dependencies.beforeSleep(window, [tabId]),
      },
    );
    return null;
  });
  router.handle(OpenWorkspaces, async (anchor, { sender }) => {
    const window = windowOf(sender);
    (await dependencies.workspaces()).open(window, anchor);
    return null;
  });
  router.handle(MoveTabToWorkspace, async ({ tabId, workspaceId }, { sender }) => {
    const window = windowOf(sender);
    (await dependencies.workspaces()).moveTab(window, tabId, workspaceId);
    return null;
  });
  router.handle(MoveTab, async ({ tabId, index, group }, { sender }) => {
    const { tabs } = windowOf(sender);
    if (!tabs.all.some((tab) => tab.id === tabId)) return null;
    // The shell names a group only while the window has groups.
    if (group === undefined) {
      tabs.move(tabId, index);
      return null;
    }
    const { editGroups } = await import('../domain/tabs/tab-groups.ts');
    if (tabs.all.some((tab) => tab.id === tabId)) {
      editGroups(tabs, (strip) => strip.move(tabId, index, group));
    }
    return null;
  });
  router.handle(ToggleGroup, async ({ groupId, keyboard }, { sender }) => {
    const window = windowOf(sender);
    const { tabs } = window;
    const { editGroups } = await import('../domain/tabs/tab-groups.ts');
    const group = tabs.all.find((tab) => tab.group?.id === groupId)?.group;
    if (group === undefined || group === null) return null;
    const toggle = (): void =>
      void editGroups(tabs, (strip) => strip.setCollapsed(groupId, !group.collapsed));
    // Enter or Space on the chip keep the focus there, also when the active tab changes, so
    // that the next key shows the tabs again.
    if (keyboard && window.shellContents.isFocused()) window.keepingFocus(toggle);
    else toggle();
    return null;
  });
  router.handle(OpenGroupEditor, async ({ groupId, ...anchor }, { sender }) => {
    const window = windowOf(sender);
    const { openGroupEditor } = await import('./tab-groups.ts');
    openGroupEditor(window, groupId, anchor, { windows, router, overlay: dependencies.overlay });
    return null;
  });
  router.handle(ResizeSplit, ({ tabId, ratio, done }, { sender }) => {
    windowOf(sender).resizeSplit(tabId, ratio, done);
    return null;
  });
  router.handle(KeyOnTab, ({ tabId, action }, { sender }) => {
    const window = windowOf(sender);
    // Delete closes the tab as the window closes the tabs that people close.
    const run = (): void =>
      action === 'close' ? window.tabAction(tabId, 'close') : window.tabs.activate(tabId);
    // The keys of the tab strip keep the focus there, also when the active tab changes.
    if (window.shellContents.isFocused()) window.keepingFocus(run);
    else run();
    return null;
  });
  router.handle(FocusContent, ({ reverse }, { sender }) => {
    const window = windowOf(sender);
    // Focus that moved on meanwhile, such as with a click, stays where it went.
    if (!window.shellContents.isFocused()) return null;
    window.focusContent(true);
    // The page starts over at its start, or at its end, so that the next Tab or Shift+Tab goes
    // to its first or its last element.
    const page = webContents.getFocusedWebContents();
    if (page !== null && page !== sender) page.send('page.tabIn', reverse);
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
  router.handle(OpenSiteInfo, async (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window !== undefined) await dependencies.openSiteInfo(window, anchor);
    return null;
  });
  // The pop-up blocker is part of the code for web pages, which has loaded before it blocked
  // anything that its popover could list.
  router.handle(OpenPopupsPopover, async (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window === undefined) return null;
    const { openPopupsPopover } = await import('./popup-blocker.ts');
    openPopupsPopover(window, anchor);
    return null;
  });
}
