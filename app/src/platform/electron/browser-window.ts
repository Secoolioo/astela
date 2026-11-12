import {
  BaseWindow,
  screen,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Rectangle,
  type WebContents,
} from 'electron';
import { is } from 'valibot';
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
import {
  sessionWindow,
  type RestoredWindow,
  type SessionSnapshot,
} from '../../domain/session/session.ts';
import {
  controlsOverlay,
  startInsets,
  titleBarArea,
  type ControlsOverlay,
  type Density,
  type TitleBarArea,
} from '../../domain/windows/title-bar.ts';
import {
  popupBounds,
  visibleBounds,
  type WindowBounds,
} from '../../domain/windows/window-bounds.ts';
import type { Blocking } from '../../domain/blocker/blocking.ts';
import type { CommandContext } from '../../domain/commands/availability.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import { privateWindowArgument } from '../../shared/private-window.ts';
import { noAppRegionCss } from '../../shared/app-region.ts';
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
  /**
   * The color of the toolbar, which the window controls take when the toolbar is the top row;
   * the window background without it.
   */
  readonly toolbarColor?: (privateWindow: boolean) => string;
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
  /** Whether people may open private windows; they may when left out. */
  readonly privateWindows?: () => boolean;
  /** Whether people may open the developer tools of web pages; they may when left out. */
  readonly developerTools?: () => boolean;
  /** Tells the version of the browser, or quits it, for the commands of the browser itself. */
  readonly onAppCommand?: (window: BrowserWindowController, command: AppCommand) => void;
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
  /**
   * Whether a page may have come with a certificate that the user accepted after the warning,
   * so the address bar does not show its connection as secure.
   */
  readonly certificateException?: (contents: WebContents, url: string) => boolean;
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
  /** Whether new windows draw their title bar with the tabs, and the density of the interface. */
  readonly titleBar?: () => { readonly integrated: boolean; readonly density: Density };
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

/** The commands of the browser itself rather than of a window. */
export type AppCommand = 'app.about' | 'app.quit';

/** What a window needs of its overlay. */
export interface OverlayHandle {
  /** Whether the overlay covers the whole window, rather than a list below the address bar. */
  readonly coversWindow: boolean;
  /** Closes the overlay and gives the focus back to the page or the shell. */
  close(): void;
  /** Puts the overlay above the other views of the window again, after one of them was added. */
  raise(): void;
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
  /** Stops the load of the icon of the tab's page while one runs. */
  iconLoad?: AbortController | undefined;
}

/** How long a window that just opened takes to set itself up on Linux, in milliseconds. */
const settleTime = 1000;

/**
 * One browser window: a `BaseWindow` with the shell view and one `WebContentsView` per
 * tab. Tab views are created when a tab opens and destroyed when it closes; only the views
 * of the tabs that the content area shows, which is the active tab, are attached to the
 * window, always below the overlay. Web pages and internal pages use views of different
 * sessions: when a tab switches between them, its view is replaced and the old view's
 * history is kept for Back and Forward.
 */
export class BrowserWindowController implements Disposable, TabViewPort {
  readonly window: BaseWindow;
  readonly shell: WebContentsView;
  readonly tabs: TabService;
  private readonly entries = new Map<TabId, TabEntry>();
  /** The overlay while it shows something. */
  private shownOverlay: OverlayHandle | undefined;
  /** Whether the overlay covers the whole window, as the shell last learned. */
  private covered = false;
  /**
   * The tab that the shell asked for last. The shell's address bar is that tab's from the
   * click on New tab on, also while the shell does not know the tab yet.
   */
  openedByShell: TabId | undefined;
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
  /** Tabs without a view yet, with the URL they load once they wake. */
  private readonly lazyTabs = new Map<TabId, string>();
  /** The page that a script opened, which the next new tab shows instead of a new page. */
  private adopting: WebContents | undefined;
  /** Whether the window is a popup that a page opened. */
  readonly popup: boolean;
  /** Whether the window is a private window. */
  readonly isPrivate: boolean;
  /** The views of the pages that the content area shows, attached to the window in this order. */
  private readonly shown: WebContentsView[] = [];
  /** Where the content area is, as the shell reports it; until then, where it starts. */
  private insets: Insets;
  /** Whether the window draws its own title bar, which it keeps until it closes. */
  private readonly integrated: boolean;
  /** The area of the window controls that the window has now, or `null`. */
  private titleBarShown: TitleBarArea | null;
  /** The window controls of Windows and Linux as they were last set. */
  private overlayKey = '';
  private readonly subscriptions = new DisposableStore();
  private publishTimer: NodeJS.Timeout | undefined;
  private hidesUntilClosed = false;
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment of the window. */
  constructor(options: BrowserWindowOptions, place: WindowPlace = {}) {
    this.options = options;
    this.popup = place.popup === true;
    this.isPrivate = place.private === true;
    const titleBar = options.titleBar?.();
    this.integrated = titleBar?.integrated === true;
    const area = this.titleBarArea(titleBar?.density ?? 'normal');
    const overlay = area === null ? undefined : this.controlsOverlay(area);
    if (overlay !== undefined) this.overlayKey = JSON.stringify(overlay);
    this.window = new BaseWindow({
      ...(place.bounds ?? { width: 1280, height: 820 }),
      minWidth: 480,
      minHeight: 320,
      // Shown at once in the theme's background color: Chromium lowers the priority of the
      // renderer of a hidden window, so the shell would load later in one.
      backgroundColor: options.backgroundColor(this.isPrivate),
      // The title bar of the browser: the shell's top row holds the window controls.
      ...(area === null || overlay === undefined ? {} : titleBarOptions(area, overlay)),
    });
    this.titleBarShown = area;
    this.insets = startInsets(titleBar?.density ?? 'normal', options.tabStripPosition());
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
    if (this.integrated) {
      // The system hides the window controls in full screen, where the top row needs no room.
      this.window.on('enter-full-screen', () => this.schedulePublish());
      this.window.on('leave-full-screen', () => this.schedulePublish());
    }
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

  /** The overlay while it shows something; a change of the visible tab closes it. */
  get overlay(): OverlayHandle | undefined {
    return this.shownOverlay;
  }

  /**
   * Takes note of what the overlay shows. While it covers the window, the top row of the shell
   * does not move the window: the window would take a click next to a popover for itself.
   */
  set overlay(overlay: OverlayHandle | undefined) {
    this.shownOverlay = overlay;
    const covered = overlay?.coversWindow === true;
    if (covered === this.covered) return;
    this.covered = covered;
    if (!this.window.isDestroyed()) this.schedulePublish();
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
          certificateException: this.certificateException(id, url),
          zoom,
          favicon: tab.favicon,
          audible: tab.audible,
          muted: tab.muted,
          pinned: tab.pinned,
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
      titleBar: this.titleBarShown,
      covered: this.covered,
    };
  }

  /**
   * Whether the web page of a tab may have come with a certificate that the user accepted
   * after the warning; the browser's own pages never do.
   */
  private certificateException(id: TabId, url: string): boolean {
    const contents = this.webContentsOf(id);
    return contents !== undefined && this.options.certificateException?.(contents, url) === true;
  }

  /** The area of the window controls in the top row, or `null` with the system's title bar. */
  private titleBarArea(density: Density): TitleBarArea | null {
    return this.integrated
      ? titleBarArea(process.platform, density, this.options.tabStripPosition())
      : null;
  }

  /** The window controls of Windows and Linux, in the color of the top row. */
  private controlsOverlay(area: TitleBarArea): ControlsOverlay {
    const window = this.options.backgroundColor(this.isPrivate);
    const toolbar = this.options.toolbarColor?.(this.isPrivate) ?? window;
    return controlsOverlay(area, { window, toolbar }, this.options.tabStripPosition());
  }

  /**
   * Fits the window controls to the top row and the theme after the density, the place of
   * the tab strip, the colors or full screen changed. In full screen, the system hides the
   * controls, and the top row keeps no room for them.
   */
  private fitTitleBar(): void {
    const area = this.titleBarArea(this.options.titleBar?.().density ?? 'normal');
    if (area === null || this.window.isDestroyed()) return;
    const before = this.titleBarShown;
    this.titleBarShown = this.window.isFullScreen() ? null : area;
    if (this.titleBarShown === null) return;
    if (process.platform === 'darwin') {
      if (before?.height !== area.height) this.window.setWindowButtonPosition(buttonPosition(area));
      return;
    }
    // The controls change only when their row or the colors of the theme change.
    const overlay = this.controlsOverlay(area);
    const key = JSON.stringify(overlay);
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    this.window.setTitleBarOverlay(overlay);
  }

  /**
   * Opens the home page in a tab: the page of the settings, or the new tab page.
   * @param id - The tab.
   */
  goHome(id: TabId): void {
    const page = this.options.homePage?.() ?? '';
    this.tabs.navigate(id, page === '' ? this.options.newTabUrl : page);
  }

  /**
   * Opens a tab that the shell asked for and sends the shell its state at once. The shell
   * waits for a state with the new tab, which a tab that closes again before the next frame
   * would otherwise never be in.
   * @param url - URL to load; defaults to the blank page.
   * @returns The new tab's id.
   */
  openTab(url?: string): TabId {
    const id = this.tabs.open(url);
    this.openedByShell = id;
    this.publishNow();
    return id;
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
    this.wake(id);
    const entry = this.entries.get(id);
    if (entry === undefined) return;
    const view = this.shownViewOf(entry);
    if (this.shown.includes(view)) {
      return;
    }
    this.overlay?.close();
    for (const previous of this.shownTabs()) this.stopFind(previous);
    // The pages that the content area showed make room for this one.
    for (const previous of this.shown.filter((other) => other !== view)) this.detachPage(previous);
    this.attachPage(view);
    view.setVisible(this.problemOf(id) === null);
    // Another window may have zoomed the site meanwhile.
    if (entry.page === undefined && !view.webContents.isDestroyed()) {
      this.tabs.update(id, { zoom: view.webContents.getZoomFactor() });
    }
    this.layout();
    this.focusContent();
  }

  /**
   * Whether the content area shows the page of a tab, also while the shell shows a problem of
   * the page in its place.
   * @param id - The tab.
   */
  isShown(id: TabId): boolean {
    const entry = this.entries.get(id);
    return entry !== undefined && this.shown.includes(this.shownViewOf(entry));
  }

  /**
   * Where the pages of the window go, in the coordinates of its content: in the room that the
   * shell leaves them, or in the whole window while the page of a shown tab is in full screen.
   */
  pageArea(): Rectangle {
    if (this.window.isDestroyed()) return { x: 0, y: 0, width: 0, height: 0 };
    const { width, height } = this.window.getContentBounds();
    // Only the tab whose page is in full screen covers the shell.
    const covering = this.fullScreenTab !== undefined && this.isShown(this.fullScreenTab);
    const { top, right, bottom, left } = covering
      ? { top: 0, right: 0, bottom: 0, left: 0 }
      : this.insets;
    return {
      x: left,
      y: top,
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
    };
  }

  /**
   * The area of the pages that a popover over them is placed in, such as one in their middle.
   * It is the page area: the overlay covers the whole window, so its coordinates are those of
   * the window's content.
   */
  contentArea(): Rectangle {
    return this.pageArea();
  }

  /** The view that shows the page of a tab in the content area: the tab's own view. */
  private shownViewOf(entry: TabEntry): WebContentsView {
    return entry.view;
  }

  /** The tabs whose pages the content area shows, in the order of their views. */
  private shownTabs(): TabId[] {
    return this.shown.flatMap((view) => {
      const id = [...this.entries].find(([, entry]) => this.shownViewOf(entry) === view)?.[0];
      return id === undefined ? [] : [id];
    });
  }

  /**
   * Attaches the view of a page to the window, where the content area shows it. The overlay
   * stays above it, so that no page covers a popover or a question.
   * @param view - The view.
   * @param index - Its place among the views of the content area; the last without it.
   */
  private attachPage(view: WebContentsView, index = this.shown.length): void {
    if (this.shown.includes(view) || this.window.isDestroyed()) return;
    this.shown.splice(index, 0, view);
    this.window.contentView.addChildView(view);
    this.overlay?.raise();
  }

  /**
   * Takes the view of a page out of the window. The other views keep their order, so the
   * overlay stays above them.
   * @param view - The view.
   */
  private detachPage(view: WebContentsView): void {
    const index = this.shown.indexOf(view);
    if (index === -1) return;
    this.shown.splice(index, 1);
    // A destroyed window no longer has a content view; touching it blocks.
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view);
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

  /** Where the shell shows the tab strip. */
  tabStripPosition(): TabStripPosition {
    return this.options.tabStripPosition();
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
    // In place of its page, the tab shows no icon of a page.
    if (problem !== null) this.dropFavicon(id);
    this.tabs.update(id, { problem });
    const entry = this.entries.get(id);
    if (entry !== undefined && this.isShown(id) && !this.window.isDestroyed()) {
      this.shownViewOf(entry).setVisible(problem === null);
      // Focusing a view raises its window: a window in the background stays there.
      if (this.window.isFocused()) this.focusContent();
    }
  }

  /**
   * Focuses the page that the content area shows, that of the active tab once it shows, or
   * the shell for the new tab page, where typing goes to the address bar.
   */
  focusContent(): void {
    const shown = this.shownTabs();
    const id = shown.find((tab) => tab === this.tabs.active?.id) ?? shown[0];
    const entry = id === undefined ? undefined : this.entries.get(id);
    // The shell shows the new tab page's address bar and the problems of pages.
    if (entry === undefined || entry.page === 'newtab' || this.problemOf(id ?? '') !== null) {
      this.shell.webContents.focus();
    } else {
      this.shownViewOf(entry).webContents.focus();
    }
  }

  destroy(id: TabId): void {
    this.lazyTabs.delete(id);
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    // The find bar looks in the page that the content area shows and closes with it, as when
    // another tab shows; the change of the tabs that follows tells the shell.
    if (this.isShown(id)) this.finding = null;
    this.entries.delete(id);
    entry.iconLoad?.abort();
    this.close(entry.view, entry.registration);
    // A page that closes in full screen ends it, unless the user chose full screen.
    if (this.fullScreenTab === id) {
      this.fullScreenTab = undefined;
      if (!this.userFullScreen && !this.window.isDestroyed()) this.setPageFullScreen(false);
      this.layout();
    }
  }

  load(id: TabId, url: string): void {
    this.wake(id);
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
    this.wake(id);
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

  /**
   * Paints the window and the views of internal pages in the current light or dark mode, and
   * gives the window controls the colors of the theme.
   */
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
    this.fitTitleBar();
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
    // The shortcuts that go to the next tab, or to a tab by its place, count the listed tabs.
    const listed = this.tabs.listed;
    const index = active === undefined ? -1 : listed.indexOf(active);
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
      case 'tab.duplicate':
        if (active !== undefined) this.tabAction(active.id, 'duplicate');
        break;
      case 'tab.closeOthers':
        if (active !== undefined) this.tabAction(active.id, 'closeOthers');
        break;
      case 'tab.closeRight':
        if (active !== undefined) this.tabAction(active.id, 'closeRight');
        break;
      case 'tab.next':
      case 'tab.previous': {
        const step = command === 'tab.next' ? 1 : -1;
        const next = listed[(index + step + listed.length) % listed.length];
        if (next !== undefined) this.tabs.activate(next.id);
        break;
      }
      case 'tab.select1':
      case 'tab.select2':
      case 'tab.select3':
      case 'tab.select4':
      case 'tab.select5':
      case 'tab.select6':
      case 'tab.select7':
      case 'tab.select8':
      case 'tab.selectLast': {
        const target =
          command === 'tab.selectLast' ? listed.at(-1) : listed[Number(command.slice(-1)) - 1];
        if (target !== undefined) this.tabs.activate(target.id);
        break;
      }
      case 'tab.moveLeft':
      case 'tab.moveRight':
        if (active !== undefined) this.tabs.step(active.id, command === 'tab.moveRight' ? 1 : -1);
        break;
      case 'tab.pin':
        if (active !== undefined) this.tabs.pin(active.id, !active.pinned);
        break;
      case 'tab.mute':
        if (active !== undefined) this.setMuted(active.id, !active.muted);
        break;
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
      case 'app.about':
      case 'app.quit':
        this.options.onAppCommand?.(this, command);
        break;
    }
  }

  /** Whether the find bar of the window is open. */
  get findOpen(): boolean {
    return this.finding !== null;
  }

  /**
   * Whether the view of the active tab is one of a web page, which the page tools work on,
   * rather than one of the browser's own pages, or of a tab whose view is not made yet.
   */
  get activeShowsWebPage(): boolean {
    const active = this.tabs.active;
    return active !== undefined && this.webContentsOf(active.id) !== undefined;
  }

  /**
   * What decides which commands can run in the window now, for `availableCommands` and
   * `canRun` of `domain/commands/availability.ts`.
   */
  commandContext(): CommandContext {
    const active = this.tabs.active;
    return {
      tabs: this.tabs.all.map(({ url, pinned, canGoBack, canGoForward, muted }) => ({
        url,
        pinned,
        canGoBack,
        canGoForward,
        muted,
      })),
      activeIndex: active === undefined ? -1 : this.tabs.all.indexOf(active),
      canReopen: this.tabs.canReopen,
      finding: this.findOpen,
      webPage: this.activeShowsWebPage,
      privateWindows: this.options.privateWindows?.() ?? true,
      developerTools: this.options.developerTools?.() ?? true,
    };
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
   * shows the new tab page, or else a new tab. A fragment names a place of the page, such as
   * a row of the settings, which the page shows also when its tab is open already.
   * @param page - The page.
   * @param fragment - `#` and the name of the place, such as `#tabs.position`; without it,
   *   a tab that shows the page stays where it is.
   */
  openPage(page: TabPage, fragment = ''): void {
    const url = pageUrl(page) + fragment;
    const open = this.tabs.all.find((tab) => tabPageOf(tab.url) === page);
    const active = this.tabs.active;
    if (open !== undefined) {
      this.tabs.activate(open.id);
      if (fragment === '') return;
      // A page sees no change of its address when it shows that address already.
      if (open.url === url) this.revealPlace(open.id, page, fragment);
      else this.tabs.navigate(open.id, url);
    } else if (active !== undefined && active.url === this.options.newTabUrl) {
      this.tabs.navigate(active.id, url);
    } else {
      this.tabs.open(url);
    }
  }

  /**
   * Tells the settings page of a tab to show the row or the section that its address names
   * once more, and gives the page the focus.
   * @param id - The tab.
   * @param page - The page that the tab shows.
   * @param fragment - `#` and the name of the place.
   */
  private revealPlace(id: TabId, page: TabPage, fragment: string): void {
    const contents = this.entries.get(id)?.view.webContents;
    if (page !== 'settings' || contents === undefined || contents.isDestroyed()) return;
    let place: string;
    try {
      place = decodeURIComponent(fragment.slice(1));
    } catch {
      return;
    }
    contents.focus();
    // The contracts of the settings page load with it, not with the window.
    void import('../../shared/ipc/settings-contracts.ts')
      .then(({ SettingsReveal }) => {
        // Only the name of a row or a section goes to the page.
        const payload = { id: place };
        if (is(SettingsReveal.payload, payload)) {
          this.options.router.publish(SettingsReveal, contents, payload);
        }
      })
      .catch((error: unknown) =>
        this.options.logger.debug('The settings did not show their row', { error: String(error) }),
      );
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

  /** Gives a tab without a view, such as a restored one, its view, which loads its page. */
  private wake(id: TabId): void {
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
      // The frame preload keeps every document that a web page loads from moving the window. A
      // page that a script opened shows what the script wrote into its first, empty document,
      // in which no preload runs, and every document gets the style sheet again once it is
      // parsed, in case no preload ran in it either.
      if (adopted !== undefined) keepAppRegionsOut(contents);
      contents.on('dom-ready', () => keepAppRegionsOut(contents));
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
    // The count of blocked requests belongs to one page.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && this.entries.get(id)?.view === view) {
        this.tabs.update(id, { blocked: 0 });
      }
    });
    // So does the icon, which goes once another page has taken its place: a link that starts
    // a download, or a response without content, leaves the page as it was.
    contents.on('did-navigate', () => {
      if (this.entries.get(id)?.view === view) this.dropFavicon(id);
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
   * Runs an item of the menu of a tab.
   * @param id - The tab.
   * @param action - What to do with it.
   */
  tabAction(id: TabId, action: 'newTabRight' | 'duplicate' | 'closeOthers' | 'closeRight'): void {
    const tab = this.tabs.all.find((candidate) => candidate.id === id);
    if (tab === undefined) return;
    switch (action) {
      case 'newTabRight':
        this.tabs.open(this.options.newTabUrl, { after: id });
        break;
      case 'duplicate':
        this.tabs.open(tab.url, { after: id, title: tab.title });
        break;
      case 'closeOthers':
      case 'closeRight': {
        const index = this.tabs.all.indexOf(tab);
        // Pinned tabs stay; they are closed one by one.
        const closing = this.tabs.all.filter(
          (other, place) =>
            other.id !== id && !other.pinned && (action === 'closeOthers' || place > index),
        );
        if (closing.length > 0) this.tabs.activate(id);
        for (const other of closing) this.tabs.close(other.id);
        break;
      }
    }
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

  /**
   * Loads the icon of a tab's page, which the tab shows unless its page changed meanwhile.
   * A tab loads one icon at a time: a newer icon of its page stops the load of the one
   * before, and so does another page.
   */
  private async loadFavicon(id: TabId, view: WebContentsView, urls: string[]): Promise<void> {
    const url = urls.find((candidate) => /^(?:https?:|data:image\/)/i.test(candidate));
    const entry = this.entries.get(id);
    if (url === undefined || entry?.view !== view) return;
    const before = entry.iconLoad;
    const loading = new AbortController();
    entry.iconLoad = loading;
    const { session } = view.webContents;
    const page = view.webContents.getURL();
    const { favicons } = await import('./favicons.ts');
    const loaded = favicons.load(session, url, page, loading.signal);
    // The load before gives way only now, so that a page that names the same icon again
    // does not start its load anew.
    before?.abort();
    const key = await loaded;
    if (entry.iconLoad === loading) entry.iconLoad = undefined;
    if (key !== undefined && !loading.signal.aborted && this.entries.get(id)?.view === view) {
      this.tabs.update(id, { favicon: key });
    }
  }

  /** Forgets the icon of a tab's page, and stops loading it, once the tab no longer shows it. */
  private dropFavicon(id: TabId): void {
    const entry = this.entries.get(id);
    if (entry !== undefined) {
      entry.iconLoad?.abort();
      entry.iconLoad = undefined;
    }
    this.tabs.update(id, { favicon: null });
  }

  /**
   * The icon of a page of the window by its key, as a `data:` address. The icons of each
   * session are apart, so the window looks among those of the sessions of its tabs.
   * @param key - The key of the icon in the state of a tab.
   */
  async favicon(key: string): Promise<string | undefined> {
    const { favicons } = await import('./favicons.ts');
    for (const { view } of this.entries.values()) {
      // A page that closed itself left its view without contents.
      const contents: WebContents | undefined = view.webContents;
      const icon =
        contents === undefined || contents.isDestroyed()
          ? undefined
          : favicons.get(contents.session, key);
      if (icon !== undefined) return icon;
    }
    return undefined;
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
    // The new view shows its own page, not the problem, the icon or the sound of the old one:
    // the old view's events no longer count, and a new page plays no sound until it says so.
    if (this.problemOf(id) !== null) this.tabs.update(id, { problem: null });
    this.dropFavicon(id);
    this.tabs.update(id, { audible: false });
    Object.assign(entry, this.createView(id, url), { requested: url });
    // The new view takes the place of the old one in the content area.
    const place = this.shown.indexOf(old);
    if (place !== -1 && !this.window.isDestroyed()) {
      this.overlay?.close();
      this.detachPage(old);
      this.attachPage(entry.view, place);
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
    this.detachPage(view);
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

  /** Lays the shell over the whole window and the shown pages out in the page area. */
  private layout(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    const { width, height } = this.window.getContentBounds();
    this.shell.setBounds({ x: 0, y: 0, width, height });
    const area = this.pageArea();
    for (const view of this.shown) view.setBounds(area);
  }

  private schedulePublish(): void {
    // Coalesce bursts of tab events into one message per frame.
    this.publishTimer ??= setTimeout(() => this.publishNow(), 16);
  }

  /** Sends the shell its state at once, instead of with the next frame. */
  private publishNow(): void {
    clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    this.fitTitleBar();
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
  private readonly keptEmitter = new Emitter<void>();
  /** Fires after windows opened or closed, or their tabs changed in a way that a session keeps. */
  readonly onDidChangeKept: Event<void> = this.keptEmitter.event;
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
   * Opens windows again with their tabs, such as those of a stored session. Only the active
   * tab of each window loads; the others load when they are shown.
   * @param windows - The windows, with their tabs and where they were.
   * @returns The first window, or a new window with a new tab page when there is none.
   */
  restore(windows: readonly RestoredWindow[]): BrowserWindowController {
    const areas = workAreas();
    const controllers = windows.map(({ tabs, active, place }) => {
      const controller = this.add({
        bounds: place.bounds === undefined ? undefined : visibleBounds(place.bounds, areas),
        maximized: place.maximized,
      });
      const ids = tabs.map((tab, index) =>
        controller.tabs.open(tab.url, {
          activate: false,
          lazy: index !== active,
          title: tab.title,
          pinned: tab.pinned === true,
        }),
      );
      const activeId = ids[active] ?? ids[0];
      if (activeId !== undefined) controller.tabs.activate(activeId);
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
    const kept = controller.tabs.onDidChangeKept(() => this.keptEmitter.fire());
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
      kept.dispose();
      forget();
      this.windows.delete(controller);
      this.changeEmitter.fire();
      this.keptEmitter.fire();
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

/**
 * Gives the current document of a web page the user style sheet that keeps it from marking
 * regions that move the window.
 * @param contents - The web page.
 */
function keepAppRegionsOut(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  // A page that went away meanwhile needs the style sheet no more.
  contents.insertCSS(noAppRegionCss, { cssOrigin: 'user' }).catch(() => undefined);
}

/**
 * The options of a window whose title bar the shell draws: on macOS, the window's three
 * buttons sit in the top row; elsewhere, Chromium draws the window controls in it, where the
 * desktop puts them, and tells the shell where they are.
 * @param area - Where the controls go.
 * @param overlay - The window controls of Windows and Linux.
 */
function titleBarOptions(
  area: TitleBarArea,
  overlay: ControlsOverlay,
): Pick<
  Electron.BaseWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'
> {
  return process.platform === 'darwin'
    ? { titleBarStyle: 'hidden', trafficLightPosition: buttonPosition(area) }
    : { titleBarStyle: 'hidden', titleBarOverlay: overlay };
}

/** Where the three buttons of a macOS window go: centered in the top row. */
function buttonPosition(area: TitleBarArea): Electron.Point {
  return { x: 14, y: Math.max(0, Math.round((area.height - 14) / 2)) };
}
