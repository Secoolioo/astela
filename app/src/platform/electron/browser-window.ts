import {
  BaseWindow,
  screen,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Rectangle,
  type WebContents,
} from 'electron';
import { sameZoom, zoomFactors } from '../../shared/zoom.ts';
import { DisposableStore, toDisposable, type Disposable } from '../../shared/disposable.ts';
import type { Capability } from '../../shared/ipc/contract.ts';
import { type TabStripPosition, type ToolbarItem, toolbarItems } from '../../shared/layout.ts';
import {
  type BarItem,
  type FindState,
  ShellCommand,
  ShellStateChanged,
  type ShellState,
} from '../../shared/ipc/shell-contracts.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import { pageUrl, sharedChannels, tabPageOf, type TabPage } from '../../shared/internal-pages.ts';
import {
  TabService,
  type TabId,
  type TabProblem,
  type TabViewPort,
} from '../../domain/tabs/tab-service.ts';
import { ViewHistory, type ViewSnapshot } from '../../domain/tabs/view-history.ts';
import { sessionWindow, type SessionSnapshot } from '../../domain/session/session.ts';
import {
  popupBounds,
  visibleBounds,
  type WindowBounds,
} from '../../domain/windows/window-bounds.ts';
import type { Blocking } from '../../domain/blocker/blocking.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import { privateWindowArgument } from '../../shared/private-window.ts';
import type { IpcGate } from './ipc-gate.ts';
import type { IpcRouter } from './ipc-router.ts';
import { commandForInput, type ShortcutRecorder, type WindowCommand } from './shortcuts.ts';
import { shortcutTable } from '../../shared/shortcuts.ts';

/** Space the shell occupies at the window edges. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A view's request for its context menu, with what the menu needs to know about the view. */
export interface ContextMenuRequest {
  /** The window that shows the view. */
  readonly window: BrowserWindowController;
  /** The tab whose page was clicked; `undefined` for the shell. */
  readonly tabId: TabId | undefined;
  /** The view's web contents. */
  readonly contents: WebContents;
  /** What was clicked, as Chromium reports it. */
  readonly params: ContextMenuParams;
  /** Where the view is in the window, for menus opened with the keyboard. */
  readonly bounds: Rectangle;
}

/** Everything a window needs from its environment. */
export interface BrowserWindowOptions {
  /** URL of the shell page, normally `app://shell/`. */
  readonly shellUrl: string;
  /** Origin the shell page must have. */
  readonly shellOrigin: string;
  /** Path of the shell's preload script. */
  readonly shellPreload: string;
  /** Path of the preload script of internal pages in tabs. */
  readonly pagePreload: string;
  /** Partition of the browser's own views. */
  readonly internalPartition: string;
  /** Partition of web tabs. */
  readonly webPartition: string;
  /** The session of web tabs in private windows, which keeps their data in memory. */
  readonly privateSession: () => Electron.Session;
  /** URL of a new tab. */
  readonly newTabUrl: string;
  /** Window background while the shell loads: for the light or dark mode, or a private window. */
  readonly backgroundColor: (privateWindow: boolean) => string;
  /** Command line argument that gives a view of the browser's own UI its design tokens. */
  readonly appearanceArgument: () => string;
  /** Command line arguments that give the views of the browser's own UI their language. */
  readonly languageArguments: readonly string[];
  /** Whether the toolbar has a home button. */
  readonly homeButton?: () => boolean;
  /** The address of the home page; empty for the new tab page. */
  readonly homePage?: () => string;
  /** The default fonts and text size of web pages, which a new web page gets. */
  readonly webFonts?: () => Pick<Electron.WebPreferences, 'defaultFontFamily' | 'defaultFontSize'>;
  /** Where the shell shows the tab strip. */
  readonly tabStripPosition: () => TabStripPosition;
  /** The buttons of the toolbar next to the address bar, in their order. */
  readonly toolbar?: () => readonly ToolbarItem[];
  /** Whether the content blocker works on a page: `none` for pages it never touches. */
  readonly blocking: (url: string) => Blocking;
  /** Called when a tab shows a web page, and again when its title changes. */
  readonly onVisit?: (url: string, title: string, titleOnly: boolean) => void;
  /** Whether a page has a bookmark, for the star in the address bar. */
  readonly isBookmarked?: (url: string) => boolean;
  /** Adds a bookmark for a page, or removes its bookmarks. */
  readonly toggleBookmark?: (url: string, title: string) => void;
  /** The items of the bookmarks bar, or `null` while the bar is hidden. */
  readonly bookmarksBar?: () => BarItem[] | null;
  /** Shows or hides the bookmarks bar. */
  readonly toggleBookmarksBar?: () => void;
  /** How the downloads button of a regular or a private window looks, or `null` while it is hidden. */
  readonly downloads?: (privateWindow: boolean) => ShellState['downloads'];
  /** Shows the list of downloads of a window, at its button. */
  readonly showDownloads?: (window: BrowserWindowController) => void;
  /** Opens a new window. */
  readonly openWindow?: () => void;
  /** Opens a new private window, if people may. */
  readonly openPrivateWindow?: () => void;
  /** Called after the last private window closed, to forget what private windows kept. */
  readonly onPrivateWindowsClosed?: () => void;
  /** Called when a window gets the focus. */
  readonly onFocus?: () => void;
  readonly gate: IpcGate;
  readonly router: IpcRouter;
  readonly logger: Logger;
  /** Shows the context menu of a view; without it, views have none. */
  readonly onContextMenu?: (request: ContextMenuRequest) => void;
  /** Whether people may continue to a site whose certificate is not trusted. */
  readonly certificateOverride?: () => boolean;
  /** The keyboard shortcuts of the windows; the defaults of the system when left out. */
  readonly shortcuts?: () => ReadonlyMap<string, WindowCommand>;
  /** Takes the key presses of a page while the editor of shortcuts waits for one. */
  readonly shortcutRecorder?: ShortcutRecorder;
  /**
   * The insecure address to offer in place of a page that did not load securely, when
   * HTTPS-First sent the page to the secure address.
   */
  readonly insecureAddressFor?: (
    contents: WebContents,
    failed: string,
    stopped: boolean,
  ) => string | undefined;
  /** Prints, saves or shows the source of a web page, or opens its developer tools. */
  readonly onPageCommand?: (
    window: BrowserWindowController,
    command: PageCommand,
    contents: WebContents,
  ) => void;
  /** The zoom of pages whose site has no zoom of its own. */
  readonly defaultZoom?: () => number;
  /** The zoom factor that a site was left at, to give its pages again. */
  readonly zoomFor?: (url: string) => number | undefined;
  /** Remembers the zoom factor of a site. */
  readonly onZoom?: (url: string, factor: number) => void;
  /** Asks what to do about a web page that stopped responding to input. */
  readonly onUnresponsive?: (
    window: BrowserWindowController,
    tabId: TabId,
    contents: WebContents,
  ) => void;
  /**
   * Gets the browser process ready for an internal page before the page loads, such as by
   * loading the handlers of its channels; `undefined` when it is ready already.
   */
  readonly prepareInternalPage?: (page: TabPage) => Promise<void> | undefined;
}

/** The commands that tools outside the window carry out on a web page. */
export type PageCommand = 'page.print' | 'page.save' | 'page.source' | 'devtools.toggle';

/** What a window needs of its overlay. */
export interface OverlayHandle {
  /** Closes the overlay and gives the focus back to the page or the shell. */
  close(): void;
}

/** Where a window opens, and whether it is a popup that a page opened. */
export interface WindowPlace {
  readonly bounds?: WindowBounds | undefined;
  readonly maximized?: boolean | undefined;
  /** A popup closes with its last tab and is not kept in the session. */
  readonly popup?: boolean;
  /** A private window keeps no history and no session, and its pages' data only in memory. */
  readonly private?: boolean;
}

/** The view that shows a tab, and what belongs to it. */
interface TabEntry {
  view: WebContentsView;
  /** The internal page that the view shows, or `undefined` for web content. */
  page: TabPage | undefined;
  /** Removes an internal view from the IPC gate. */
  registration: Disposable | undefined;
  /** The URL the view was last asked to load, until it reports its own. */
  requested: string;
  /** Views of the tab before and after this one. */
  readonly history: ViewHistory;
}

/** How long a window that just opened takes to set itself up on Linux, in milliseconds. */
const settleTime = 1000;

/**
 * One browser window: a `BaseWindow` with the shell view and one `WebContentsView` per
 * tab. Tab views are created when a tab opens and destroyed when it closes; only the
 * active tab's view is attached to the window. Web pages and internal pages use views of
 * different sessions: when a tab switches between them, its view is replaced and the old
 * view's history is kept for Back and Forward.
 */
export class BrowserWindowController implements Disposable, TabViewPort {
  readonly window: BaseWindow;
  readonly shell: WebContentsView;
  readonly tabs: TabService;
  private readonly entries = new Map<TabId, TabEntry>();
  /** The overlay while it shows something; a change of the visible tab closes it. */
  overlay: OverlayHandle | undefined;
  /** The find bar of the active tab, or `null` while it is closed. */
  private finding: FindState | null = null;
  /** What the find bar looked for last, to look for it again. */
  private lastQuery = '';
  /** The tab whose page shows an element in full screen; while it shows, it covers the shell. */
  private fullScreenTab: TabId | undefined;
  /** Whether the user put the window in full screen, rather than a page. */
  private userFullScreen = false;
  /** Views whose internal page waits for {@link BrowserWindowOptions.prepareInternalPage}. */
  private readonly waiting = new WeakMap<WebContents, string>();
  /** The default zoom that each web view was made with, which Chromium keeps for its pages. */
  private readonly madeZoom = new WeakMap<WebContents, number>();
  /** Tabs without a view yet, with the URL they will load when shown. */
  private readonly lazyTabs = new Map<TabId, string>();
  /** The page that a script opened, which the next new tab shows instead of a new page. */
  private adopting: WebContents | undefined;
  /** Whether the window is a popup that a page opened. */
  readonly popup: boolean;
  /** Whether the window is a private window. */
  readonly isPrivate: boolean;
  private visible: WebContentsView | undefined;
  private insets: Insets = { top: 76, right: 0, bottom: 0, left: 0 };
  private readonly subscriptions = new DisposableStore();
  private publishTimer: NodeJS.Timeout | undefined;
  private hidesUntilClosed = false;
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment of the window. */
  constructor(options: BrowserWindowOptions, place: WindowPlace = {}) {
    this.options = options;
    this.popup = place.popup === true;
    this.isPrivate = place.private === true;
    this.window = new BaseWindow({
      ...(place.bounds ?? { width: 1280, height: 820 }),
      minWidth: 480,
      minHeight: 320,
      // Shown at once in the theme's background color: Chromium lowers the priority of the
      // renderer of a hidden window, so the shell would load later in one.
      backgroundColor: options.backgroundColor(this.isPrivate),
    });
    this.shell = new WebContentsView({
      webPreferences: {
        preload: options.shellPreload,
        partition: options.internalPartition,
        additionalArguments: [
          options.appearanceArgument(),
          ...options.languageArguments,
          ...privateArgument(this.isPrivate),
        ],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        v8CacheOptions: 'bypassHeatCheck',
      },
    });
    this.shell.setBackgroundColor(options.backgroundColor(this.isPrivate));
    this.window.contentView.addChildView(this.shell);
    this.subscriptions.add(
      options.gate.registerView(this.shell.webContents.id, {
        origin: options.shellOrigin,
        capabilities: new Set(['shell', 'appearance']),
      }),
    );
    if (place.maximized === true) this.window.maximize();
    // A popup closes with its last tab, as the page that closes itself expects.
    this.tabs = new TabService(
      this,
      options.newTabUrl,
      this.popup ? () => this.window.close() : undefined,
    );
    this.subscriptions.add(this.tabs.onDidChange(() => this.schedulePublish()));
    this.subscriptions.add(this.tabs);
    this.shell.webContents.on('before-input-event', (event, input) =>
      this.intercept(event, input, this.shell.webContents.id),
    );
    this.forwardContextMenu(this.shell, undefined);
    this.shell.webContents.once('did-finish-load', () => this.layout());
    this.window.on('resize', () => this.layout());
    this.window.on('closed', () => this.dispose());
    // Electron on Linux can crash when a window closes while it still sets itself up after it
    // opened. A window that closes within its first second hides at once and closes when that
    // second is over; the browser quits without closing its windows this way.
    if (process.platform === 'linux') {
      const opened = performance.now();
      this.window.on('close', (event) => {
        if (this.hidesUntilClosed) return;
        const rest = settleTime - (performance.now() - opened);
        if (rest <= 0) return;
        event.preventDefault();
        this.hidesUntilClosed = true;
        this.window.hide();
        setTimeout(() => {
          if (!this.window.isDestroyed()) this.window.close();
        }, rest);
      });
    }
    void this.shell.webContents.loadURL(options.shellUrl);
    this.layout();
  }

  /** Whether the window closes: a window that closes right after it opened hides first. */
  get closing(): boolean {
    return this.hidesUntilClosed;
  }

  /** The shell's `WebContents`. */
  get shellContents(): WebContents {
    return this.shell.webContents;
  }

  /** The `WebContents` of the active tab, if any. */
  get activeTabContents(): WebContents | undefined {
    const active = this.tabs.active;
    return active === undefined ? undefined : this.entries.get(active.id)?.view.webContents;
  }

  /** The current shell state, as sent to the shell. */
  state(): ShellState {
    return {
      tabs: this.tabs.all.map(
        ({ id, title, url, loading, canGoBack, canGoForward, blocked, problem, zoom, ...tab }) => ({
          id,
          title,
          url,
          loading,
          canGoBack,
          canGoForward,
          blocked,
          blocking: this.options.blocking(url),
          bookmarked: this.options.isBookmarked?.(url) ?? false,
          problem,
          zoom,
          favicon: tab.favicon,
          audible: tab.audible,
          muted: tab.muted,
        }),
      ),
      activeTabId: this.tabs.active?.id ?? null,
      tabStrip: this.options.tabStripPosition(),
      bookmarksBar: this.options.bookmarksBar?.() ?? null,
      find: this.finding,
      downloads: this.options.downloads?.(this.isPrivate) ?? null,
      private: this.isPrivate,
      home: this.options.homeButton?.() ?? false,
      defaultZoom: this.options.defaultZoom?.() ?? 1,
      toolbar: [...(this.options.toolbar?.() ?? toolbarItems)],
    };
  }

  /**
   * Opens the home page in a tab: the page of the settings, or the new tab page.
   * @param id - The tab.
   */
  goHome(id: TabId): void {
    const page = this.options.homePage?.() ?? '';
    this.tabs.navigate(id, page === '' ? this.options.newTabUrl : page);
  }

  /** Sends the shell its state again, for example after the layout settings changed. */
  refreshShell(): void {
    this.schedulePublish();
  }

  /**
   * Counts a request that the content blocker blocked, if it belongs to one of this window's
   * tabs.
   * @param contentsId - Id of the web contents that made the request.
   * @returns Whether the request belonged to this window.
   */
  countBlocked(contentsId: number): boolean {
    for (const [id, entry] of this.entries) {
      if (entry.view.webContents.id === contentsId) {
        const tab = this.tabs.all.find((candidate) => candidate.id === id);
        this.tabs.update(id, { blocked: (tab?.blocked ?? 0) + 1 });
        return true;
      }
    }
    return false;
  }

  /**
   * Updates the space the shell occupies.
   * @param insets - New insets in CSS pixels.
   */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.layout();
  }

  /** Tells whether a `WebContents` is one of this window's tab views. */
  ownsTab(contents: WebContents): boolean {
    return this.tabIdOf(contents) !== undefined;
  }

  /**
   * Finds the tab that a `WebContents` shows.
   * @param contents - A tab view's `WebContents`.
   */
  tabIdOf(contents: WebContents): TabId | undefined {
    return [...this.entries].find(([, entry]) => entry.view.webContents === contents)?.[0];
  }

  create(id: TabId, url: string, lazy = false): void {
    const adopted = this.adopting;
    this.adopting = undefined;
    if (lazy && adopted === undefined) {
      this.lazyTabs.set(id, url);
      return;
    }
    const entry: TabEntry = {
      ...this.createView(id, url, adopted),
      requested: url,
      history: new ViewHistory(),
    };
    this.entries.set(id, entry);
    // A page that a script opened loads on its own, with its opener.
    if (adopted === undefined) this.loadInto(entry.view.webContents, url);
  }

  /**
   * Shows the page that a script of another page opened in a new tab, which keeps that page
   * as its opener.
   * @param contents - The new page, which Chromium made for the script.
   * @param url - The address it opens.
   * @param activate - Whether the tab becomes the active one.
   * @returns The tab.
   */
  adopt(contents: WebContents, url: string, activate: boolean): TabId {
    this.adopting = contents;
    try {
      return this.tabs.open(url, { activate });
    } finally {
      this.adopting = undefined;
    }
  }

  show(id: TabId): void {
    this.materialize(id);
    const entry = this.entries.get(id);
    const view = entry?.view;
    if (view === undefined || view === this.visible) {
      return;
    }
    this.overlay?.close();
    const previous = this.tabs.all.find(
      (tab) => this.entries.get(tab.id)?.view === this.visible,
    )?.id;
    if (previous !== undefined) this.stopFind(previous);
    if (this.visible !== undefined) {
      this.window.contentView.removeChildView(this.visible);
    }
    this.visible = view;
    this.window.contentView.addChildView(view);
    view.setVisible(this.problemOf(id) === null);
    // Another window may have zoomed the site meanwhile.
    if (entry?.page === undefined && !view.webContents.isDestroyed()) {
      this.tabs.update(id, { zoom: view.webContents.getZoomFactor() });
    }
    this.layout();
    this.focusContent();
  }

  /**
   * Continues to a page whose certificate was refused, once the certificate is accepted.
   * @param id - The tab.
   * @param accept - Accepts the certificate that the page's web contents were refused.
   */
  proceedUnsafely(id: TabId, accept: (contents: WebContents) => boolean): void {
    const contents = this.entries.get(id)?.view.webContents;
    if (this.problemOf(id)?.kind === 'certificate' && contents !== undefined && accept(contents)) {
      contents.reload();
    }
  }

  /**
   * Loads the insecure address of a site without a secure connection, once it is allowed.
   * @param id - The tab.
   * @param allow - Allows the site's insecure address for the session of the tab's page.
   */
  proceedInsecurely(id: TabId, allow: (contents: WebContents, address: string) => void): void {
    const problem = this.problemOf(id);
    const contents = this.entries.get(id)?.view.webContents;
    if (problem?.kind !== 'insecure' || contents === undefined) return;
    allow(contents, problem.url);
    contents.loadURL(problem.url).catch(() => undefined);
  }

  /** The keyboard shortcuts of the window. */
  shortcuts(): ReadonlyMap<string, WindowCommand> {
    return this.options.shortcuts?.() ?? shortcutTable(process.platform);
  }

  /** Why a tab shows no page, or `null` when it shows one. */
  private problemOf(id: TabId): TabProblem | null {
    return this.tabs.all.find((tab) => tab.id === id)?.problem ?? null;
  }

  /**
   * Records why a tab shows no page, or that it shows one again. While a tab has a problem,
   * its view is hidden and the shell shows the problem in its place.
   */
  private setProblem(id: TabId, problem: TabProblem | null): void {
    if (problem === null && this.problemOf(id) === null) return;
    this.tabs.update(id, { problem });
    const view = this.entries.get(id)?.view;
    if (view !== undefined && view === this.visible && !this.window.isDestroyed()) {
      view.setVisible(problem === null);
      // Focusing a view raises its window: a window in the background stays there.
      if (this.window.isFocused()) this.focusContent();
    }
  }

  /**
   * Focuses the visible tab, or the shell for the new tab page, where typing goes to the
   * address bar.
   */
  focusContent(): void {
    const id = [...this.entries].find(([, candidate]) => candidate.view === this.visible)?.[0];
    const entry = id === undefined ? undefined : this.entries.get(id);
    // The shell shows the new tab page's address bar and the problems of pages.
    if (entry === undefined || entry.page === 'newtab' || this.problemOf(id ?? '') !== null) {
      this.shell.webContents.focus();
    } else {
      entry.view.webContents.focus();
    }
  }

  destroy(id: TabId): void {
    this.lazyTabs.delete(id);
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    this.entries.delete(id);
    this.close(entry.view, entry.registration);
    // A page that closes in full screen ends it, unless the user chose full screen.
    if (this.fullScreenTab === id) {
      this.fullScreenTab = undefined;
      if (!this.userFullScreen && !this.window.isDestroyed()) this.setPageFullScreen(false);
      this.layout();
    }
  }

  load(id: TabId, url: string): void {
    this.materialize(id);
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    if (tabPageOf(url) === entry.page) {
      entry.requested = url;
      this.loadInto(entry.view.webContents, url);
    } else {
      entry.history.leave(this.snapshot(entry));
      this.replaceView(id, entry, url, (contents) => this.loadInto(contents, url));
    }
    entry.view.webContents.focus();
  }

  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    this.materialize(id);
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    const contents = entry.view.webContents;
    const history = contents.navigationHistory;
    switch (action) {
      case 'back':
        if (history.canGoBack()) history.goBack();
        else this.restore(id, entry, entry.history.goBack(this.snapshot(entry)));
        break;
      case 'forward':
        if (history.canGoForward()) history.goForward();
        else this.restore(id, entry, entry.history.goForward(this.snapshot(entry)));
        break;
      case 'reload':
        contents.reload();
        break;
      case 'stop':
        contents.stop();
        break;
    }
  }

  /** Paints the window and the views of internal pages in the current light or dark mode. */
  repaintBackground(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    const color = this.options.backgroundColor(this.isPrivate);
    this.window.setBackgroundColor(color);
    this.shell.setBackgroundColor(color);
    for (const entry of this.entries.values()) {
      if (entry.page !== undefined) entry.view.setBackgroundColor(color);
    }
  }

  /** Closes the window and every tab view. */
  dispose(): void {
    // A message to a shell that is closing can block the exit of the app.
    clearTimeout(this.publishTimer);
    this.subscriptions.dispose();
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
    if (!this.shell.webContents.isDestroyed()) {
      this.shell.webContents.close();
    }
  }

  /**
   * Runs a window command, such as opening a tab.
   * @param command - The command.
   */
  execute(command: WindowCommand): void {
    const active = this.tabs.active;
    const all = this.tabs.all;
    const index = active === undefined ? -1 : all.indexOf(active);
    switch (command) {
      case 'tab.new':
        this.tabs.open();
        // The shell learns of the new tab before its address bar takes the focus, so that the
        // keys typed right away go to the new tab and not to the tab that was active.
        this.publishNow();
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
      case 'tab.close':
        if (active !== undefined) this.tabs.close(active.id);
        break;
      case 'tab.reopen':
        this.tabs.reopenClosed();
        break;
      case 'tab.next':
      case 'tab.previous': {
        const step = command === 'tab.next' ? 1 : -1;
        const next = all[(index + step + all.length) % all.length];
        if (next !== undefined) this.tabs.activate(next.id);
        break;
      }
      case 'page.reload':
      case 'page.back':
      case 'page.forward':
        if (active !== undefined) {
          const action =
            command === 'page.reload' ? 'reload' : command === 'page.back' ? 'back' : 'forward';
          this.tabs.run(active.id, action);
        }
        break;
      case 'page.home':
        if (active !== undefined) this.goHome(active.id);
        break;
      case 'omnibox.focus':
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
      case 'settings.open':
        this.openPage('settings');
        break;
      case 'history.open':
        this.openPage('history');
        break;
      case 'bookmarks.open':
        this.openPage('bookmarks');
        break;
      case 'bookmarks.toggleBar':
        this.options.toggleBookmarksBar?.();
        break;
      case 'downloads.open':
        this.options.showDownloads?.(this);
        break;
      case 'window.new':
        this.options.openWindow?.();
        break;
      case 'window.newPrivate':
        this.options.openPrivateWindow?.();
        break;
      case 'bookmark.toggle':
        // Only web pages get bookmarks; the browser's own pages have their own commands.
        if (active !== undefined && /^https?:/i.test(active.url)) {
          this.options.toggleBookmark?.(active.url, active.title);
        }
        break;
      case 'find.open':
      case 'find.next':
      case 'find.previous':
        if (active === undefined) break;
        if (this.finding === null || command === 'find.open') {
          if (this.finding === null) {
            // The bar opens with the text of the last search and looks for it again.
            this.finding = { query: this.lastQuery, active: 0, matches: 0 };
            if (this.lastQuery !== '') this.find(active.id, this.lastQuery, true, false);
          }
          this.schedulePublish();
          this.shell.webContents.focus();
          this.options.router.publish(ShellCommand, this.shell.webContents, 'find.focus');
        } else {
          this.find(active.id, this.finding.query, command === 'find.next', true);
        }
        break;
      case 'zoom.in':
      case 'zoom.out':
      case 'zoom.reset':
        if (active !== undefined) {
          this.zoom(active.id, command === 'zoom.in' ? 1 : command === 'zoom.out' ? -1 : 0);
        }
        break;
      case 'window.fullscreen':
        this.userFullScreen = !this.window.isFullScreen();
        this.window.setFullScreen(this.userFullScreen);
        break;
      case 'page.reloadHard':
      case 'page.print':
      case 'page.save':
      case 'page.source':
      case 'devtools.toggle': {
        // These work on web pages; the browser's own pages keep them to themselves.
        const contents = active === undefined ? undefined : this.webContentsOf(active.id);
        if (contents === undefined) break;
        if (command === 'page.reloadHard') contents.reloadIgnoringCache();
        else this.options.onPageCommand?.(this, command, contents);
        break;
      }
    }
  }

  /**
   * Looks for text in a tab's page, or for its next or previous match.
   * @param id - The tab.
   * @param query - The text.
   * @param forward - Whether to look forward.
   * @param next - Whether to go on from the current match.
   */
  find(id: TabId, query: string, forward: boolean, next: boolean): void {
    const contents = this.webContentsOf(id);
    // Only an open find bar looks; a late request after Escape does not open it again.
    if (contents === undefined || id !== this.tabs.active?.id || this.finding === null) return;
    this.lastQuery = query;
    // The numbers stay until the page reports those of the new search, so they do not flicker.
    this.finding = { ...this.finding, query };
    // Electron's findNext begins a new search: new text starts one, and the next or previous
    // match goes on with it, so Chromium handles a step only after the search it belongs to.
    if (query === '') contents.stopFindInPage('clearSelection');
    else contents.findInPage(query, { forward, findNext: !next });
    this.schedulePublish();
  }

  /**
   * Closes the find bar and leaves the current match selected.
   * @param id - The tab.
   */
  stopFind(id: TabId): void {
    const contents = this.entries.get(id)?.view.webContents;
    if (contents !== undefined && !contents.isDestroyed()) contents.stopFindInPage('keepSelection');
    if (this.finding === null) return;
    this.finding = null;
    this.schedulePublish();
    this.focusContent();
  }

  /**
   * Zooms a tab's page in or out by one step, or back to the default zoom. The zoom holds
   * for the page's site, in every tab, and is remembered for the next visit.
   * @param id - The tab.
   * @param direction - 1 to zoom in, -1 to zoom out, 0 for the default zoom.
   */
  zoom(id: TabId, direction: 1 | -1 | 0): void {
    const contents = this.webContentsOf(id);
    if (contents === undefined) return;
    const current = contents.getZoomFactor();
    const factor =
      direction === 0
        ? (this.options.defaultZoom?.() ?? 1)
        : direction > 0
          ? (zoomFactors.find((step) => step > current + 0.001) ?? current)
          : (zoomFactors.toReversed().find((step) => step < current - 0.001) ?? current);
    contents.setZoomFactor(factor);
    this.tabs.update(id, { zoom: factor });
    // Chromium zooms the site in every tab that shows it.
    for (const [other, entry] of this.entries) {
      const shown = entry.view.webContents;
      if (other !== id && entry.page === undefined && !shown.isDestroyed()) {
        this.tabs.update(other, { zoom: shown.getZoomFactor() });
      }
    }
    // A private window keeps no zoom for later visits.
    if (!this.isPrivate) this.options.onZoom?.(contents.getURL(), factor);
  }

  /**
   * Gives the pages of sites without a zoom of their own a new default zoom.
   * @param factor - The new default zoom.
   */
  applyDefaultZoom(factor: number): void {
    for (const [id, entry] of this.entries) {
      const contents = entry.view.webContents;
      if (entry.page !== undefined || contents.isDestroyed()) continue;
      if (this.options.zoomFor?.(contents.getURL()) !== undefined) continue;
      contents.setZoomFactor(factor);
      this.tabs.update(id, { zoom: factor });
    }
  }

  /** The web contents of a tab that shows a web page, and no internal page or problem. */
  private webContentsOf(id: TabId): WebContents | undefined {
    const entry = this.entries.get(id);
    return entry === undefined || entry.page !== undefined || entry.view.webContents.isDestroyed()
      ? undefined
      : entry.view.webContents;
  }

  /**
   * Shows an internal page: the tab that already shows it, or else the active tab if it
   * shows the new tab page, or else a new tab.
   * @param page - The page.
   */
  openPage(page: TabPage): void {
    const open = this.tabs.all.find((tab) => tabPageOf(tab.url) === page);
    const active = this.tabs.active;
    if (open !== undefined) {
      this.tabs.activate(open.id);
    } else if (active !== undefined && active.url === this.options.newTabUrl) {
      this.tabs.navigate(active.id, pageUrl(page));
    } else {
      this.tabs.open(pageUrl(page));
    }
  }

  /**
   * Runs the shortcut of a key press in the shell or in a tab before the view sees the key.
   * The mouse's back and forward buttons need nothing here: Chromium navigates the page
   * under the pointer itself, and the shell passes them on to the active tab. The window's
   * `app-command` event reports them as well and stays unused, or one click would go back
   * two pages.
   */
  private intercept(event: { preventDefault(): void }, input: Input, contentsId: number): void {
    if (this.options.shortcutRecorder?.take(contentsId, input, process.platform) === true) {
      event.preventDefault();
      return;
    }
    const command = commandForInput(input, process.platform, this.shortcuts());
    if (command !== undefined) {
      event.preventDefault();
      this.execute(command);
    }
  }

  /** Gives a lazy tab its view and loads its page. */
  private materialize(id: TabId): void {
    const url = this.lazyTabs.get(id);
    if (url !== undefined) {
      this.lazyTabs.delete(id);
      this.create(id, url);
    }
  }

  /** How the view of a tab is made: for a web page, or for one of the browser's own pages. */
  private viewOptions(page: TabPage | undefined): Electron.WebContentsViewConstructorOptions {
    return {
      webPreferences:
        page === undefined
          ? {
              // A private window's pages keep their data in memory.
              ...(this.isPrivate
                ? { session: this.options.privateSession() }
                : { partition: this.options.webPartition }),
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              // Lets the content blocker's frame preload run in iframes; Node stays off.
              nodeIntegrationInSubFrames: true,
              spellcheck: false,
              // The window takes the screen for a page in full screen itself, so the page
              // leaves full screen at once and never waits for the window's animation.
              disableHtmlFullscreenWindowResize: true,
              ...this.options.webFonts?.(),
              zoomFactor: this.options.defaultZoom?.() ?? 1,
            }
          : {
              preload: this.options.pagePreload,
              partition: this.options.internalPartition,
              additionalArguments: [
                `--bridge-scope=${[page, ...sharedChannels[page]].join(',')}`,
                this.options.appearanceArgument(),
                ...this.options.languageArguments,
                ...privateArgument(this.isPrivate),
              ],
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              spellcheck: false,
              v8CacheOptions: 'bypassHeatCheck',
              // Chromium focuses a page when it commits in the active window. The new tab page
              // leaves the focus in the address bar, where typing goes, also when it commits
              // after the address bar took the focus, as at the start or right after a new tab
              // opened.
              ...(page === 'newtab' ? { focusOnNavigation: false } : {}),
            },
    };
  }

  /**
   * Creates the view for a URL: a web view without a preload, or for an internal page a
   * view in the internal session whose preload only offers that page's channels. A page that
   * a script opened comes with its own contents, which the view takes over.
   */
  private createView(
    id: TabId,
    url: string,
    adopted?: WebContents,
  ): Pick<TabEntry, 'view' | 'page' | 'registration'> {
    const page = adopted === undefined ? tabPageOf(url) : undefined;
    const view = new WebContentsView(
      adopted === undefined ? this.viewOptions(page) : { webContents: adopted },
    );
    const contents = view.webContents;
    if (page === undefined) this.madeZoom.set(contents, this.options.defaultZoom?.() ?? 1);
    let registration: Disposable | undefined;
    if (page !== undefined) {
      view.setBackgroundColor(this.options.backgroundColor(this.isPrivate));
      registration = this.options.gate.registerView(contents.id, {
        origin: `app://${page}`,
        capabilities: new Set<Capability>([
          `page:${page}`,
          ...sharedChannels[page].map((other): Capability => `page:${other}`),
          'appearance',
        ]),
      });
    }
    const sync = (): void => this.sync(id, contents);
    if (page === undefined) {
      // Pages that change their address with the History API, as many web apps do, count as
      // visits too; a jump to an anchor on the same page does not. A private window keeps no
      // history.
      const onVisit = this.isPrivate ? undefined : this.options.onVisit;
      let visited = '';
      const visit = (address: string): void => {
        if (!/^https?:/i.test(address) || withoutHash(address) === withoutHash(visited)) return;
        visited = address;
        onVisit?.(address, contents.getTitle(), false);
      };
      contents.on('did-navigate', (_event, address) => {
        visited = '';
        visit(address);
      });
      contents.on('did-navigate-in-page', (_event, address, isMainFrame) => {
        if (isMainFrame) visit(address);
      });
      contents.on('page-title-updated', (_event, title) => {
        const address = contents.getURL();
        if (/^https?:/i.test(address)) onVisit?.(address, title, true);
      });
    }
    if (page === undefined) {
      // A page that could not be loaded, or whose renderer is gone, shows the shell's page
      // for it instead of an empty one.
      contents.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
        if (!isMainFrame) return;
        // A load that a new navigation stopped is no error, unless HTTPS-First stopped it
        // because its secure address gave no answer in time.
        if (code === -3) {
          const slow = this.options.insecureAddressFor?.(contents, failed, true);
          if (slow !== undefined) {
            this.setProblem(id, {
              kind: 'insecure',
              code: 'ERR_TIMED_OUT',
              url: slow,
              proceed: true,
            });
          }
          return;
        }
        const name = /^[A-Z0-9_]{1,64}$/.test(description) ? description : 'ERR_FAILED';
        // A site that HTTPS-First could not load securely offers its insecure address after a
        // warning. Without a name or a network, the insecure address would not load either.
        const insecure =
          code === -105 || code === -106
            ? undefined
            : this.options.insecureAddressFor?.(contents, failed, false);
        if (insecure !== undefined) {
          this.setProblem(id, { kind: 'insecure', code: name, url: insecure, proceed: true });
          return;
        }
        const certificate = code <= -200 && code > -300;
        this.setProblem(id, {
          kind: certificate ? 'certificate' : 'error',
          code: name,
          url: failed,
          proceed: certificate && (this.options.certificateOverride?.() ?? false),
        });
      });
      // A page that a script opened may close itself; its tab goes with it.
      contents.once('destroyed', () => {
        if (!this.window.isDestroyed() && this.entries.get(id)?.view === view) {
          this.tabs.close(id);
        }
      });
      // Electron reports only the process of the page itself, and the tab has nothing to show
      // once it ended, however it ended: with the sandbox of Linux, a renderer that crashed can
      // count as one that exited cleanly.
      contents.on('render-process-gone', (_event, details) => {
        if (this.window.isDestroyed() || contents.isDestroyed()) return;
        const code = details.reason.toUpperCase().replaceAll('-', '_');
        this.setProblem(id, { kind: 'crashed', code, url: contents.getURL(), proceed: false });
      });
      contents.on('did-navigate', (_event, address) => {
        this.setProblem(id, null);
        // A site keeps the zoom it was left at, also after the browser restarts, and other
        // sites get the default zoom. Chromium gives a page the zoom that its site had in this
        // session, or else the default zoom that the tab was made with, which may be old.
        const saved = this.options.zoomFor?.(address);
        const base = this.options.defaultZoom?.() ?? 1;
        const factor = contents.getZoomFactor();
        if (sameZoom(factor, this.madeZoom.get(contents) ?? base) || sameZoom(factor, base)) {
          const wanted = saved ?? base;
          if (!sameZoom(factor, wanted)) contents.setZoomFactor(wanted);
        }
      });
      contents.on('unresponsive', () => this.options.onUnresponsive?.(this, id, contents));
      contents.on('found-in-page', (_event, result) => {
        if (this.finding === null || id !== this.tabs.active?.id) return;
        this.finding = {
          query: this.finding.query,
          active: result.activeMatchOrdinal,
          matches: result.matches,
        };
        this.schedulePublish();
      });
      // Ctrl and the mouse wheel, or a pinch, zoom in steps like the keys.
      contents.on('zoom-changed', (_event, direction) =>
        this.zoom(id, direction === 'in' ? 1 : -1),
      );
      // A video or another element in full screen covers the whole window, which takes the
      // whole screen until the page leaves full screen, unless the user put it in full screen.
      contents.on('enter-html-full-screen', () => {
        this.fullScreenTab = id;
        if (!this.window.isFullScreen()) this.setPageFullScreen(true);
        this.layout();
      });
      contents.on('leave-html-full-screen', () => {
        if (this.fullScreenTab === id) this.fullScreenTab = undefined;
        if (!this.userFullScreen) this.setPageFullScreen(false);
        this.layout();
      });
    }
    // The count of blocked requests and the icon belong to one page.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && this.entries.get(id)?.view === view) {
        this.tabs.update(id, { blocked: 0, favicon: null });
      }
    });
    contents.on('page-favicon-updated', (_event, urls) => void this.loadFavicon(id, view, urls));
    contents.on('audio-state-changed', ({ audible }) => {
      if (this.entries.get(id)?.view === view) this.tabs.update(id, { audible });
    });
    // A tab keeps its sound muted when it changes between web pages and the browser's own.
    contents.setAudioMuted(this.tabs.all.find((tab) => tab.id === id)?.muted ?? false);
    contents.on('did-start-loading', sync);
    contents.on('did-stop-loading', sync);
    contents.on('did-navigate', sync);
    contents.on('did-navigate-in-page', sync);
    contents.on('page-title-updated', sync);
    contents.on('before-input-event', (event, input) => this.intercept(event, input, contents.id));
    this.forwardContextMenu(view, id);
    return { view, page, registration };
  }

  /**
   * Puts the window in full screen for a page, or takes it out again. On macOS, the window
   * covers the screen without the animation into a space of its own: while that animation
   * runs, Electron keeps the page in full screen, also after it left.
   */
  private setPageFullScreen(on: boolean): void {
    if (process.platform === 'darwin') this.window.setSimpleFullScreen(on);
    else this.window.setFullScreen(on);
  }

  /**
   * Mutes the sound of a tab, or turns it on again.
   * @param id - The tab.
   * @param muted - Whether the sound is muted.
   */
  setMuted(id: TabId, muted: boolean): void {
    const contents = this.entries.get(id)?.view.webContents;
    if (contents !== undefined && !contents.isDestroyed()) contents.setAudioMuted(muted);
    this.tabs.update(id, { muted });
  }

  /** Loads the icon of a tab's page, which the tab shows unless its view changed meanwhile. */
  private async loadFavicon(id: TabId, view: WebContentsView, urls: string[]): Promise<void> {
    const url = urls.find((candidate) => /^(?:https?:|data:image\/)/i.test(candidate));
    if (url === undefined) return;
    const { favicons } = await import('./favicons.ts');
    const key = await favicons.load(view.webContents.session, url);
    if (key !== undefined && this.entries.get(id)?.view === view) {
      this.tabs.update(id, { favicon: key });
    }
  }

  /** Reports the state of a tab's view, unless the view was replaced meanwhile. */
  private sync(id: TabId, contents: WebContents): void {
    const entry = this.entries.get(id);
    if (entry?.view.webContents !== contents || contents.isDestroyed()) {
      return;
    }
    const history = contents.navigationHistory;
    this.tabs.update(id, {
      url: contents.getURL() || entry.requested,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: history.canGoBack() || entry.history.canGoBack,
      canGoForward: history.canGoForward() || entry.history.canGoForward,
      zoom: contents.getZoomFactor(),
    });
  }

  /** The history of a tab's current view, for {@link ViewHistory}. */
  private snapshot(entry: TabEntry): ViewSnapshot {
    const history = entry.view.webContents.navigationHistory;
    const entries = history
      .getAllEntries()
      .map(({ url, title, pageState }) =>
        pageState === undefined ? { url, title } : { url, title, pageState },
      );
    return entries.length === 0
      ? { entries: [{ url: entry.requested, title: '' }], index: 0 }
      : { entries, index: history.getActiveIndex() };
  }

  /** Shows a view that the tab had before, with its history. */
  private restore(id: TabId, entry: TabEntry, snapshot: ViewSnapshot | undefined): void {
    const current = snapshot?.entries[snapshot.index];
    if (snapshot === undefined || current === undefined) {
      return;
    }
    this.replaceView(id, entry, current.url, (contents) => {
      contents.navigationHistory
        .restore({ entries: [...snapshot.entries], index: snapshot.index })
        .catch((error: unknown) =>
          this.options.logger.debug('History restore failed', { error: String(error) }),
        );
    });
  }

  /** Replaces a tab's view with a new one for a URL, in place of the old one. */
  private replaceView(
    id: TabId,
    entry: TabEntry,
    url: string,
    start: (contents: WebContents) => void,
  ): void {
    const old = entry.view;
    const oldRegistration = entry.registration;
    const focused = old.webContents.isFocused();
    // The new view shows its own page, not the problem of the old one.
    if (this.problemOf(id) !== null) this.tabs.update(id, { problem: null });
    Object.assign(entry, this.createView(id, url), { requested: url });
    if (this.visible === old && !this.window.isDestroyed()) {
      this.overlay?.close();
      this.window.contentView.removeChildView(old);
      this.window.contentView.addChildView(entry.view);
      this.visible = entry.view;
      this.layout();
    }
    this.close(old, oldRegistration);
    start(entry.view.webContents);
    if (focused) {
      entry.view.webContents.focus();
    }
    this.sync(id, entry.view.webContents);
  }

  /** Closes a tab view that no longer shows a tab. */
  private close(view: WebContentsView, registration: Disposable | undefined): void {
    if (this.visible === view) {
      // A destroyed window no longer has a content view; touching it blocks.
      if (!this.window.isDestroyed()) {
        this.window.contentView.removeChildView(view);
      }
      this.visible = undefined;
    }
    registration?.dispose();
    // A page that closed itself left its view without contents.
    const contents: WebContents | undefined = view.webContents;
    if (contents !== undefined && !contents.isDestroyed()) contents.close();
  }

  private forwardContextMenu(view: WebContentsView, tabId: TabId | undefined): void {
    const contents = view.webContents;
    contents.on('context-menu', (_event, params) => {
      this.options.onContextMenu?.({
        window: this,
        tabId,
        contents,
        params,
        bounds: view.getBounds(),
      });
    });
  }

  private loadInto(contents: WebContents, url: string): void {
    const page = tabPageOf(url);
    const preparing = page === undefined ? undefined : this.options.prepareInternalPage?.(page);
    if (preparing === undefined) {
      this.waiting.delete(contents);
      this.startLoad(contents, url);
      return;
    }
    // A later load of the same view wins over this one while it waits.
    this.waiting.set(contents, url);
    void preparing.then(() => {
      if (this.waiting.get(contents) !== url || contents.isDestroyed()) return;
      this.waiting.delete(contents);
      this.startLoad(contents, url);
    });
  }

  private startLoad(contents: WebContents, url: string): void {
    contents.loadURL(url).catch((error: unknown) => {
      // Aborted loads (a new navigation started) are normal.
      if (!String(error).includes('ERR_ABORTED')) {
        this.options.logger.debug('Page load failed', { error: String(error) });
      }
    });
  }

  private layout(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    const { width, height } = this.window.getContentBounds();
    this.shell.setBounds({ x: 0, y: 0, width, height });
    // Only the tab whose page is in full screen covers the shell.
    const covering =
      this.fullScreenTab !== undefined &&
      this.entries.get(this.fullScreenTab)?.view === this.visible;
    const { top, right, bottom, left } = covering
      ? { top: 0, right: 0, bottom: 0, left: 0 }
      : this.insets;
    this.visible?.setBounds({
      x: left,
      y: top,
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
    });
  }

  private schedulePublish(): void {
    // Coalesce bursts of tab events into one message per frame.
    this.publishTimer ??= setTimeout(() => this.publishNow(), 16);
  }

  /** Sends the shell its state at once, instead of with the next frame. */
  private publishNow(): void {
    clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    this.options.router.publish(ShellStateChanged, this.shell.webContents, this.state());
  }
}

/** Keeps track of open windows and routes shell requests to the right one. */
export class WindowManager implements Disposable {
  private readonly windows = new Set<BrowserWindowController>();
  /** The windows in the order they last had the focus, the most recent last. */
  private readonly focusOrder: BrowserWindowController[] = [];
  private readonly changeEmitter = new Emitter<void>();

  /** Fires after windows opened or closed, or their tabs changed. */
  readonly onDidChange: Event<void> = this.changeEmitter.event;
  private readonly boundsEmitter = new Emitter<void>();
  /** Fires while a window moves or changes its size. */
  readonly onDidMove: Event<void> = this.boundsEmitter.event;
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment for new windows. */
  constructor(options: BrowserWindowOptions) {
    this.options = options;
  }

  /**
   * Opens a window with one tab.
   * @param url - What the tab shows; a new tab page without it.
   * @param place - Where the window opens, and whether it is private.
   */
  open(url?: string, place?: WindowPlace): BrowserWindowController {
    const controller = this.add(place);
    controller.tabs.open(url);
    return controller;
  }

  /**
   * Opens a window whose only tab shows a page that a script of another page opened, which
   * keeps its opener.
   * @param contents - The new page.
   * @param url - The address it opens.
   * @param place - Where the window opens.
   * @returns The window.
   */
  openWith(contents: WebContents, url: string, place: WindowPlace = {}): BrowserWindowController {
    const controller = this.add(place);
    controller.adopt(contents, url, true);
    return controller;
  }

  /**
   * Opens a popup that a script of a page opened, where and as large as the page asked,
   * with the new page, which keeps its opener.
   * @param contents - The new page.
   * @param url - The address it opens.
   * @param features - The features that the script asked for, such as its size.
   * @param opener - The window of the page that opened it.
   * @param privateWindow - Whether the page that opened it is in a private window.
   * @returns The popup.
   */
  openPopup(
    contents: WebContents,
    url: string,
    features: string,
    opener: BrowserWindowController | undefined,
    privateWindow: boolean,
  ): BrowserWindowController {
    const bounds = popupBounds(
      features,
      opener?.window.getBounds() ?? { x: 100, y: 100, width: 1280, height: 820 },
      workAreas(),
    );
    return this.openWith(contents, url, {
      bounds,
      popup: true,
      private: privateWindow,
    });
  }

  /**
   * Opens the windows of a stored session. Only the active tab of each window loads; the
   * others load when they are shown.
   * @param session - The windows and their tabs.
   * @returns The first window.
   */
  restore(session: SessionSnapshot): BrowserWindowController {
    const areas = workAreas();
    const controllers = session.windows.map((stored) => {
      const controller = this.add({
        bounds: stored.bounds === undefined ? undefined : visibleBounds(stored.bounds, areas),
        maximized: stored.maximized,
      });
      const ids = stored.tabs.map((tab, index) =>
        controller.tabs.open(tab.url, {
          activate: false,
          lazy: index !== stored.active,
          title: tab.title,
        }),
      );
      const active = ids[stored.active] ?? ids[0];
      if (active !== undefined) controller.tabs.activate(active);
      return controller;
    });
    return controllers[0] ?? this.open();
  }

  /** The tabs of every open window, as a session keeps them. */
  snapshot(): SessionSnapshot {
    return {
      version: 1,
      // Popups and private windows are not kept; the window that opened a popup is.
      windows: [...this.windows].flatMap((controller) => {
        if (controller.popup || controller.isPrivate) return [];
        const tabs = controller.tabs.all;
        const active = controller.tabs.active;
        const window = sessionWindow(tabs, active === undefined ? -1 : tabs.indexOf(active), {
          bounds: controller.window.getNormalBounds(),
          maximized: controller.window.isMaximized(),
        });
        return window === undefined ? [] : [window];
      }),
    };
  }

  private add(place?: WindowPlace): BrowserWindowController {
    const controller = new BrowserWindowController(this.options, place);
    this.windows.add(controller);
    const listener = controller.tabs.onDidChange(() => this.changeEmitter.fire());
    // The session keeps where each window is.
    const moved = (): void => this.boundsEmitter.fire();
    controller.window.on('move', moved);
    controller.window.on('resize', moved);
    controller.window.on('maximize', moved);
    controller.window.on('unmaximize', moved);
    const forget = (): void => {
      const index = this.focusOrder.indexOf(controller);
      if (index !== -1) this.focusOrder.splice(index, 1);
    };
    controller.window.on('focus', () => {
      // The focus that a window got while it opened can reach it after it closed, on macOS
      // when it closes right away; a closed window never counts as the one used last.
      if (!this.windows.has(controller)) return;
      forget();
      this.focusOrder.push(controller);
      this.options.onFocus?.();
    });
    controller.window.on('closed', () => {
      listener.dispose();
      forget();
      this.windows.delete(controller);
      this.changeEmitter.fire();
      if (controller.isPrivate && ![...this.windows].some((other) => other.isPrivate)) {
        this.options.onPrivateWindowsClosed?.();
      }
    });
    return controller;
  }

  /** The open window that had the focus last, or else the newest open window. */
  get lastUsed(): BrowserWindowController | undefined {
    const open = (window: BrowserWindowController): boolean => !window.closing;
    return this.focusOrder.findLast(open) ?? [...this.windows].findLast(open);
  }

  /**
   * The regular or the private window that had the focus last, or else the newest one;
   * popups are left out, as their pages expect to be alone in them.
   * @param privateWindow - Whether to find a private window.
   */
  lastUsedOf(privateWindow: boolean): BrowserWindowController | undefined {
    const matches = (window: BrowserWindowController): boolean =>
      window.isPrivate === privateWindow && !window.popup && !window.closing;
    return this.focusOrder.findLast(matches) ?? [...this.windows].findLast(matches);
  }

  /**
   * Finds the window whose shell sent a request.
   * @param sender - The sending `WebContents`.
   */
  forShell(sender: WebContents): BrowserWindowController | undefined {
    return [...this.windows].find((w) => w.shellContents === sender);
  }

  /**
   * Finds the window that shows a tab view.
   * @param contents - A tab's `WebContents`.
   */
  forTab(contents: WebContents): BrowserWindowController | undefined {
    return [...this.windows].find((w) => w.ownsTab(contents));
  }

  /** All open windows. */
  get all(): readonly BrowserWindowController[] {
    return [...this.windows];
  }

  /**
   * Counts a request that the content blocker blocked in the tab that made it.
   * @param contentsId - Id of the web contents that made the request.
   */
  countBlocked(contentsId: number): void {
    for (const window of this.windows) {
      if (window.countBlocked(contentsId)) return;
    }
  }

  /** Sends every shell its state again. */
  refreshShells(): void {
    for (const window of this.windows) {
      window.refreshShell();
    }
  }

  /**
   * Gives the pages of sites without a zoom of their own a new default zoom, in every window.
   * @param factor - The new default zoom.
   */
  applyDefaultZoom(factor: number): void {
    for (const window of this.windows) {
      window.applyDefaultZoom(factor);
    }
  }

  /** Paints every window in the current light or dark mode. */
  repaintBackgrounds(): void {
    for (const window of this.windows) {
      window.repaintBackground();
    }
  }

  /** Closes every window. */
  dispose(): void {
    for (const window of this.windows) {
      window.dispose();
    }
    this.windows.clear();
  }

  /** Returns a disposable that closes all windows. */
  toDisposable(): Disposable {
    return toDisposable(() => this.dispose());
  }
}

/** An address without its fragment, which names a place on the page. */
function withoutHash(address: string): string {
  const hash = address.indexOf('#');
  return hash === -1 ? address : address.slice(0, hash);
}

/** The work areas of the screens, where windows may go. */
function workAreas(): WindowBounds[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

/** The argument that gives the browser's own views in a private window their look. */
function privateArgument(privateWindow: boolean): string[] {
  return privateWindow ? [privateWindowArgument] : [];
}
