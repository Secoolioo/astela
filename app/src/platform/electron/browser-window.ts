import {
  BaseWindow,
  screen,
  session as sessions,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Rectangle,
  type WebContents,
} from 'electron';
import { DisposableStore, toDisposable, type Disposable } from '../../shared/disposable.ts';
import type { Capability } from '../../shared/ipc/contract.ts';
import { type TabStripPosition, type ToolbarItem, toolbarItems } from '../../shared/layout.ts';
import {
  type BarItem,
  type FindState,
  ShellCommand,
  ShellStateChanged,
  type ShellPopover,
  type ShellState,
} from '../../shared/ipc/shell-contracts.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import { sharedChannels, tabPageOf, type TabPage } from '../../shared/internal-pages.ts';
import {
  keptChange,
  TabService,
  type KeptChange,
  type SleepMode,
  type TabId,
  type TabProblem,
  type TabViewPort,
} from '../../domain/tabs/tab-service.ts';
import type { SleepCandidate } from '../../domain/tabs/tab-sleep.ts';
import { ViewHistory, type TabHistory, type ViewSnapshot } from '../../domain/tabs/view-history.ts';
import {
  currentEntry,
  historyMoves,
  memoryLimits,
  trimHistory,
} from '../../domain/tabs/tab-history.ts';
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
import { visibleBounds, type WindowBounds } from '../../domain/windows/window-bounds.ts';
import type { Blocking } from '../../domain/blocker/blocking.ts';
import type { CommandContext } from '../../domain/commands/availability.ts';
import { AltTap } from '../../domain/windows/alt-tap.ts';
import { HeldTyping, type TypedText } from '../../domain/palette/held-typing.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import { LaterCode } from '../../kernel/modules/later-code.ts';
import { privateWindowArgument } from '../../shared/private-window.ts';
import type { IpcGate } from './ipc-gate.ts';
import type { IpcRouter } from './ipc-router.ts';
import type { TabActivity } from './tab-activity.ts';
import { commandForInput, type WindowCommand } from './shortcuts.ts';
import type { ShortcutRecorder } from './shortcut-recorder.ts';
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
  /**
   * Opens the command palette of a window, which searches everything or the open tabs; the
   * window holds the keys typed until the palette asks for them.
   */
  readonly openPalette?: (window: BrowserWindowController, scope: PaletteOpening) => void;
  /** Whether the command palette is on, which a setting or a policy can turn off. */
  readonly commandPalette?: () => boolean;
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
  /**
   * Takes the key presses of a page while the editor of shortcuts waits for one; there is none
   * until the settings page could ask for one.
   */
  readonly shortcutRecorder?: () => ShortcutRecorder | undefined;
  /**
   * Whether Alt pressed and released alone opens the browser menu, as F10 does; never on
   * macOS, which opens its menus from the menu bar.
   */
  readonly altOpensMenu?: () => boolean;
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
  /**
   * Loads the code of the windows for their web pages (`web-pages.ts`), which follows their
   * views as they navigate and fail, and zooms them. A web page loads once it is there.
   */
  readonly webPages: () => Promise<WebPages>;
  /**
   * Loads the commands of the windows that do not move the focus (`window-commands.ts`), with
   * the first of them or once the shell of a window has loaded.
   */
  readonly windowCommands: () => Promise<WindowCommands>;
  /**
   * What the pages of tabs do that keeps them awake, such as a camera that they use or a
   * download, once its code has loaded with the code for web pages, before the first web page
   * loads; without it, only sound keeps a tab awake.
   */
  readonly activity?: () => TabActivity | undefined;
  /** The time of the wall clock in milliseconds, which counts how long tabs were not used. */
  readonly now?: () => number;
}

/**
 * What the code of the windows that loads later (`web-pages.ts`, `window-commands.ts`) uses of
 * a window.
 */
export interface WindowHost {
  readonly window: BrowserWindowController;
  readonly options: BrowserWindowOptions;
  /** The views of the window's tabs. */
  readonly entries: ReadonlyMap<TabId, TabEntry>;
  /** The zoom that each view of a web page was made with. */
  readonly madeZoom: WeakMap<WebContents, number>;
  /** The web contents of a tab that shows a web page, and no internal page or problem. */
  webContentsOf(id: TabId): WebContents | undefined;
  /** When each tab was last used: opened, shown, left or quiet again, by the wall clock. */
  readonly usedAt: Map<TabId, number>;
  /** Forgets the icon of a tab's page, and stops loading it. */
  dropFavicon(id: TabId): void;
  /** The view that shows the page of a tab in the content area. */
  shownViewOf(entry: TabEntry): WebContentsView;
  /** When the browser last tried to put each tab to sleep by itself. */
  readonly triedAt: Map<TabId, number>;
  /** Closes the view of a tab, which keeps its history until it wakes. */
  putToSleep(id: TabId, entry: TabEntry, dormant: DormantTab): void;
  /** The time of the wall clock, in milliseconds. */
  now(): number;
  /** What the find bar shows, or `null` while it is closed. */
  findState(): FindState | null;
  /** Shows the find bar with a state, and tells the shell. */
  setFindState(state: FindState): void;
  /** Keeps the text of the last search, which the find bar shows when it opens again. */
  keepQuery(query: string): void;
  /** Tabs without a view, with what they show once they wake. */
  readonly dormant: Map<TabId, DormantTab>;
  /** What each view is to do once the browser process is ready for its page. */
  readonly waiting: WeakMap<WebContents, PageJob>;
  /** Gives a tab without a view its view. */
  wake(id: TabId): void;
  /** Tells the tab what its view shows now. */
  sync(id: TabId, contents: WebContents): void;
  /** The history of a tab's view, with the page states of now. */
  snapshot(entry: TabEntry): ViewSnapshot;
  /** Shows a view that the tab had before, with its history. */
  restore(id: TabId, entry: TabEntry, snapshot: ViewSnapshot | undefined): void;
}

/** The code of the windows for their web pages, which loads with the first of them. */
export interface WebPages {
  /**
   * Follows the events of a new view of a web page.
   * @param host - The window.
   * @param id - The tab of the view.
   * @param view - The view.
   * @param adopted - Whether a script made the view's page, which loads already.
   */
  watch(host: WindowHost, id: TabId, view: WebContentsView, adopted: boolean): void;
  /** Zooms a tab's page in or out by one step, or back to the default zoom. */
  zoom(host: WindowHost, id: TabId, direction: 1 | -1 | 0): void;
  /** Gives the pages of sites without a zoom of their own a new default zoom. */
  applyDefaultZoom(host: WindowHost, factor: number): void;
  /** Takes note of a key that reaches a web page, which may type text into it. */
  typed(host: WindowHost, contents: WebContents, input: Input): void;
  /** Looks for text in a tab's page, or for its next or previous match. */
  find(host: WindowHost, id: TabId, query: string, forward: boolean, next: boolean): void;
  /** Continues to a page whose certificate was refused, once the certificate is accepted. */
  proceedUnsafely(host: WindowHost, id: TabId, accept: (contents: WebContents) => boolean): void;
  /** Loads the insecure address of a site without a secure connection, once it is allowed. */
  proceedInsecurely(
    host: WindowHost,
    id: TabId,
    allow: (contents: WebContents, address: string) => void,
  ): void;
}

/** The commands that move the focus, or the state of the window itself: they run at once. */
const commandsNow = [
  'tab.new',
  'omnibox.focus',
  'palette.open',
  'tabs.search',
  'menu.open',
  'find.open',
  'find.next',
  'find.previous',
  'window.fullscreen',
] as const satisfies readonly WindowCommand[];

/** A command that runs at once. */
type CommandNow = (typeof commandsNow)[number];

/** A window command whose code loads later, with the first of them (`window-commands.ts`). */
export type LaterWindowCommand = Exclude<WindowCommand, CommandNow>;

/** Whether a command runs at once. */
function runsNow(command: WindowCommand): command is CommandNow {
  return (commandsNow as readonly WindowCommand[]).includes(command);
}

/** The commands of the windows that load later. */
export interface WindowCommands {
  /**
   * Runs a window command that does not move the focus at once.
   * @param host - The window.
   * @param command - The command.
   */
  run(host: WindowHost, command: LaterWindowCommand): void;
  /** Whether a tab may go to sleep now, as {@link BrowserWindowController.canSleep} tells. */
  canSleep(host: WindowHost, id: TabId, mode: SleepMode): boolean;
  /** Puts a tab to sleep, as {@link BrowserWindowController.sleep} does. */
  sleep(host: WindowHost, id: TabId, mode: SleepMode): boolean;
  /** The tabs of the window as candidates to sleep, with since when each was not used. */
  sleepCandidates(host: WindowHost): SleepCandidate[];
  /** Runs a history or loading action of a tab, as {@link BrowserWindowController.run} does. */
  pageAction(host: WindowHost, id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void;
  /** What decides which commands can run in the window now. */
  context(host: WindowHost): CommandContext;
  /** Shows an internal page, as {@link BrowserWindowController.openPage} does. */
  openPage(host: WindowHost, page: TabPage, fragment: string): void;
  /** Forgets the back and forward history of every tab of the window. */
  forgetHistories(host: WindowHost): void;
  /** Runs an item of the menu of a tab. */
  tabAction(host: WindowHost, id: TabId, action: TabAction): void;
}

/** An item of the menu of a tab that the window runs. */
export type TabAction = 'newTabRight' | 'duplicate' | 'closeOthers' | 'closeRight';

/** The code that loads later for the windows of each window manager, by their options. */
const laterCode = new WeakMap<
  BrowserWindowOptions,
  { readonly pages: LaterCode<WebPages>; readonly commands: LaterCode<WindowCommands> }
>();

/**
 * The code that loads later for the windows with these options, which every window of them
 * shares: that for web pages, with the first web page of any of them, and the commands.
 * @param options - The options of the windows.
 */
function laterCodeOf(options: BrowserWindowOptions): {
  readonly pages: LaterCode<WebPages>;
  readonly commands: LaterCode<WindowCommands>;
} {
  let code = laterCode.get(options);
  if (code === undefined) {
    code = {
      pages: new LaterCode(options.webPages, (error) =>
        options.logger.error('The code for web pages failed', error),
      ),
      commands: new LaterCode(options.windowCommands, (error) =>
        options.logger.error('The commands of the windows failed', error),
      ),
    };
    laterCode.set(options, code);
  }
  return code;
}

/** The commands that tools outside the window carry out on a web page. */
export type PageCommand = 'page.print' | 'page.save' | 'page.source' | 'devtools.toggle';

/** The commands of the browser itself rather than of a window. */
export type AppCommand = 'app.about' | 'app.quit';

/** What the command palette searches when it opens: everything, or the open tabs. */
export type PaletteOpening = 'all' | 'tabs';

/** What a window needs of its overlay. */
export interface OverlayHandle {
  /** Whether the overlay covers the whole window, rather than a list below the address bar. */
  readonly coversWindow: boolean;
  /** The popover of a button of the shell that the overlay shows, or `null`. */
  readonly popover: ShellPopover | null;
  /**
   * Closes the overlay and gives the focus back to the page or the shell.
   * @param how - `now` takes the overlay out of the window without letting the popover leave.
   */
  close(how?: 'animate' | 'now'): void;
  /** Puts the overlay above the other views of the window again, after one of them was added. */
  raise(): void;
  /**
   * Offers a command to what the overlay shows, as its shortcut does.
   * @returns Whether the popover took it, so that the command does not run.
   */
  offer(command: WindowCommand): boolean;
}

/** Where a window opens, and whether it is a popup that a page opened. */
export interface WindowPlace {
  readonly bounds?: WindowBounds | undefined;
  readonly maximized?: boolean | undefined;
  /** Whether the window opens in full screen, as people left it. */
  readonly fullScreen?: boolean | undefined;
  /** A popup closes with its last tab and is not kept in the session. */
  readonly popup?: boolean;
  /** A private window keeps no history and no session, and its pages' data only in memory. */
  readonly private?: boolean;
}

/** Where a window is outside full screen, and whether it is maximized there. */
export interface NormalPlace {
  readonly bounds: Rectangle;
  readonly maximized: boolean;
}

/** The view that shows a tab, and what belongs to it. */
export interface TabEntry {
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
  /** The tab's history as {@link BrowserWindowController.historyOf} gave it, until the page changes. */
  cache?: TabHistory | undefined;
  /**
   * The address of the entry that the view restores when a tab without a view wakes: its
   * commit is no new visit, and the tab keeps its icon.
   */
  restored?: string | undefined;
  /**
   * Whether the back and forward entries of the view still go, after the whole history was
   * cleared: Chromium keeps them while a load of one of them runs, as after a restore, Back or
   * a reload, and the view drops them once that load ends.
   */
  clearing?: boolean | undefined;
}

/**
 * A tab without a view, such as a restored tab that was not shown yet: the address it shows
 * and its back and forward history, which come back once it wakes.
 */
export interface DormantTab {
  readonly url: string;
  /** The history, within the limits of memory; `undefined` loads the address as a new page. */
  readonly history: TabHistory | undefined;
}

/**
 * What a view does once the browser process is ready for its internal page: restore a history,
 * then load an address. A later job of the view takes the place of an earlier one.
 */
export interface PageJob {
  restore?: ViewSnapshot | undefined;
  load?: string | undefined;
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
  /** The popover of a button of the shell that the overlay shows, as the shell last learned. */
  private popover: ShellPopover | null = null;
  /** Alt pressed and released alone in the window, which opens the browser menu. */
  private readonly altTap = new AltTap();
  /** The view whose key press of Alt armed {@link altTap}; its release elsewhere opens nothing. */
  private altFrom: number | undefined;
  /** The keys typed after the shortcut of the command palette, until the palette is ready. */
  private readonly heldTyping = new HeldTyping(() => performance.now(), process.platform);
  /** Whether the pointer was pressed in the shell since the shortcut of the command palette. */
  private pressedSinceHold = false;
  /** Stops noting the presses of the pointer in the shell, once the held keys are let go. */
  private unwatchPresses: (() => void) | undefined;
  /** The find bar of the active tab, or `null` while it is closed. */
  private finding: FindState | null = null;
  /** What the find bar looked for last, to look for it again. */
  private lastQuery = '';
  /** The tab whose page shows an element in full screen; while it shows, it covers the shell. */
  private fullScreenTab: TabId | undefined;
  /** Whether the user put the window in full screen, rather than a page. */
  private userFullScreen = false;
  /**
   * Where the window was right before it went into full screen, until it leaves full screen.
   * Electron does not give that place while the window is in full screen: no system counts a
   * window in full screen as maximized; on Windows, the normal bounds come 1 px further left
   * and 2 px wider and 1 px taller, as Electron measures the frame without the title bar style
   * that full screen takes away; and on macOS, they are where Electron last placed the window
   * itself, not where people moved it, nor where the green button found it.
   */
  private placeBeforeFullScreen: NormalPlace | undefined;
  /**
   * On macOS, whether the window entered full screen and has not left it yet. While it leaves,
   * macOS has taken it out of full screen already, and the place from before still counts.
   */
  private fullScreenEntered = false;
  /** Views whose internal page waits for {@link BrowserWindowOptions.prepareInternalPage}. */
  private readonly waiting = new WeakMap<WebContents, PageJob>();
  /** The default zoom that each web view was made with, which Chromium keeps for its pages. */
  private readonly madeZoom = new WeakMap<WebContents, number>();
  /** What the code of the window that loads later uses of it, made with its first use. */
  private host: WindowHost | undefined;
  /** Tabs without a view, with what they show once they wake. */
  private readonly dormant = new Map<TabId, DormantTab>();
  /** When each tab was last used: opened, shown, left or quiet again, by the wall clock. */
  private readonly usedAt = new Map<TabId, number>();
  /**
   * When the browser last tried to put each tab to sleep by itself: a tab that stayed awake for
   * a reason that its plan does not see, such as a link to another page, is tried again only
   * after another while.
   */
  private readonly triedAt = new Map<TabId, number>();
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
    // On macOS, maximize() zooms the window before it returns, and full screen moves the window
    // into a space of its own, with an animation.
    if (place.maximized === true) this.window.maximize();
    if (place.fullScreen === true) {
      this.userFullScreen = true;
      this.setFullScreen(true, place.maximized === true);
    }
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
    // The commands that load later are there before people can use the shell.
    this.shell.webContents.once('did-finish-load', () =>
      laterCodeOf(this.options).commands.prepare(),
    );
    this.window.on('resize', () => this.layout());
    if (this.integrated) {
      // The system hides the window controls in full screen, where the top row needs no room.
      this.window.on('enter-full-screen', () => this.schedulePublish());
      this.window.on('leave-full-screen', () => this.schedulePublish());
    }
    // Full screen that the system's controls start or end counts as the user's, as the shortcut
    // does; a page in full screen does not.
    this.window.on('enter-full-screen', () => {
      if (this.fullScreenTab === undefined) this.userFullScreen = true;
    });
    this.window.on('leave-full-screen', () => {
      const before = this.placeBeforeFullScreen;
      this.userFullScreen = false;
      this.placeBeforeFullScreen = undefined;
      this.fullScreenEntered = false;
      if (process.platform === 'darwin' && before?.maximized === true) this.placeAgain(before);
    });
    // Electron on macOS takes note of where the window is only when it places the window itself,
    // and the green button puts the window in full screen without Electron: the browser notes
    // where the window is after each change outside full screen.
    if (process.platform === 'darwin') {
      const note = (): void => {
        this.notePlace();
      };
      note();
      this.window.on('enter-full-screen', () => {
        this.fullScreenEntered = true;
      });
      this.window.on('move', note);
      this.window.on('resize', note);
      this.window.on('maximize', note);
      this.window.on('unmaximize', note);
      this.window.on('leave-full-screen', note);
    }
    // Alt held while the window loses the focus, as for Alt+Tab, opens nothing.
    this.window.on('blur', () => this.altTap.reset());
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

  /**
   * Whether people put the window in full screen, rather than a page of it. On macOS, a page
   * takes a full screen of its own, so the full screen of the window while no page is in full
   * screen is people's, from the moment that macOS starts to move the window there: Electron
   * reports it from the green button only once that animation has ended, and a browser that
   * quits before keeps it.
   */
  get fullScreen(): boolean {
    if (this.window.isDestroyed() || !this.window.isFullScreen()) return false;
    return (
      this.userFullScreen || (process.platform === 'darwin' && this.fullScreenTab === undefined)
    );
  }

  /**
   * Where the window is outside full screen, and whether it is maximized there, as the session
   * keeps it; while the window or a page in it is in full screen, or on macOS on its way out of
   * full screen, where it was before.
   */
  get normalPlace(): NormalPlace {
    const before = this.placeBeforeFullScreen;
    if (
      before !== undefined &&
      (this.fullScreenEntered || this.window.isFullScreen() || this.window.isSimpleFullScreen())
    ) {
      return before;
    }
    return { bounds: this.window.getNormalBounds(), maximized: this.window.isMaximized() };
  }

  /** The overlay while it shows something; a change of the visible tab closes it. */
  get overlay(): OverlayHandle | undefined {
    return this.shownOverlay;
  }

  /**
   * Takes note of what the overlay shows. While it covers the window, the top row of the shell
   * does not move the window: the window would take a click next to a popover for itself. The
   * button of the shell whose popover the overlay shows looks open.
   */
  set overlay(overlay: OverlayHandle | undefined) {
    this.shownOverlay = overlay;
    const covered = overlay?.coversWindow === true;
    const popover = overlay?.popover ?? null;
    if (covered === this.covered && samePopover(popover, this.popover)) return;
    this.covered = covered;
    this.popover = popover;
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
          sleeping: tab.sleeping,
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
      popover: this.popover,
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
   * would otherwise never be in. A click in the shell after the shortcut of the command
   * palette, such as on New tab while the palette still loads, turns to the new tab: the
   * palette does not open, and the keys typed after the click reach the shell, whose address
   * bar is the new tab's. A request of a click before the shortcut that comes late leaves the
   * palette alone.
   * @param url - URL to load; defaults to the blank page.
   * @returns The new tab's id.
   */
  openTab(url?: string): TabId {
    if (this.pressedSinceHold) this.heldTyping.cancel();
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

  create(id: TabId, url: string, lazy = false, history?: TabHistory): void {
    const adopted = this.adopting;
    this.adopting = undefined;
    // A tab that opens in the background counts as used when it opens.
    this.usedAt.set(id, this.now());
    // A history comes back within the limits of memory, and only when it shows the address.
    const kept = history === undefined ? undefined : trimHistory(history, memoryLimits);
    const dormant = {
      url,
      history: kept !== undefined && currentEntry(kept)?.url === url ? kept : undefined,
    };
    if (adopted === undefined && (lazy || dormant.history !== undefined)) {
      this.dormant.set(id, dormant);
      if (!lazy) this.wake(id);
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
    for (const previous of this.shownTabs()) {
      this.stopFind(previous);
      // A tab that the window no longer shows was used until now.
      this.usedAt.set(previous, this.now());
    }
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
    // Only a web page has a certificate; before the code for web pages, none loaded.
    this.webPages().loaded?.proceedUnsafely(this.windowHost(), id, accept);
  }

  /**
   * Loads the insecure address of a site without a secure connection, once it is allowed.
   * @param id - The tab.
   * @param allow - Allows the site's insecure address for the session of the tab's page.
   */
  proceedInsecurely(id: TabId, allow: (contents: WebContents, address: string) => void): void {
    this.webPages().loaded?.proceedInsecurely(this.windowHost(), id, allow);
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
    this.dormant.delete(id);
    this.usedAt.delete(id);
    this.triedAt.delete(id);
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
    this.endPageFullScreen(id);
  }

  /**
   * Ends the full screen of a tab's page whose view closed, unless the user chose full screen:
   * a page that closes leaves full screen without telling.
   */
  private endPageFullScreen(id: TabId): void {
    if (this.fullScreenTab !== id) return;
    this.fullScreenTab = undefined;
    if (!this.userFullScreen && !this.window.isDestroyed()) this.setPageFullScreen(false);
    this.layout();
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
    // The buttons and keys of the toolbar run with the commands of the windows, in their turn.
    this.withCommands((code, host) => code.pageAction(host, id, action));
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
   * Runs a window command, such as opening a tab. The commands that move the focus run at once,
   * so that the keys typed right after them follow the focus; the others load with the first of
   * them, or once the shell has loaded. A command that comes while others wait for their code
   * waits behind them, so the commands keep their order.
   * @param command - The command.
   */
  execute(command: WindowCommand): void {
    const later = laterCodeOf(this.options).commands;
    if (runsNow(command)) later.runInTurn(() => this.executeNow(command));
    else later.run((commands) => commands.run(this.windowHost(), command));
  }

  /** Runs a command that moves the focus, or changes the state of the window itself. */
  private executeNow(command: CommandNow): void {
    const active = this.tabs.active;
    switch (command) {
      case 'tab.new':
        this.tabs.open();
        // The shell learns of the new tab before its address bar takes the focus, so that the
        // keys typed right away go to the new tab and not to the tab that was active.
        this.publishNow();
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
      case 'omnibox.focus':
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
      case 'palette.open':
      case 'tabs.search':
        this.options.openPalette?.(this, command === 'tabs.search' ? 'tabs' : 'all');
        break;
      case 'menu.open':
        // The shortcut closes the menu that is open; the shell opens it at its button.
        if (this.overlay?.popover?.kind === 'menu') this.overlay.close();
        else this.options.router.publish(ShellCommand, this.shell.webContents, 'menu.open');
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
      case 'window.fullscreen':
        this.userFullScreen = !this.window.isFullScreen();
        this.setFullScreen(this.userFullScreen);
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
    return this.loadedCommands().context(this.windowHost());
  }

  /**
   * Holds the keys typed in the window from now on, while the command palette gets ready, so
   * that they go to its field and not to the page or the shell. Until the keys are let go, the
   * window notes whether the pointer is pressed in the shell, for {@link openTab}.
   */
  holdTyping(): void {
    this.heldTyping.hold();
    this.pressedSinceHold = false;
    const contents = this.shell.webContents;
    if (this.unwatchPresses !== undefined || contents.isDestroyed()) return;
    const onInput = (_event: unknown, input: Electron.InputEvent): void => {
      if (input.type === 'mouseDown' || input.type === 'touchStart') this.pressedSinceHold = true;
    };
    contents.on('input-event', onInput);
    this.unwatchPresses = () => {
      contents.off('input-event', onInput);
    };
  }

  /**
   * Takes a key press while keys are held for the command palette.
   * @param input - The key press, before its view sees it.
   * @returns Whether the palette gets the key, so that its view must not.
   */
  holdKey(input: Input): boolean {
    return this.heldTyping.take(input);
  }

  /**
   * Whether Escape was pressed while keys were held for the command palette, or the hold was
   * given up for a new tab.
   */
  get typingCancelled(): boolean {
    return this.heldTyping.wasCancelled;
  }

  /**
   * Lets the keys that were held for the command palette go, as it is ready or does not open.
   * @returns What was typed, for the palette's field.
   */
  releaseTyping(): TypedText {
    this.unwatchPresses?.();
    this.unwatchPresses = undefined;
    this.pressedSinceHold = false;
    return this.heldTyping.release();
  }

  /**
   * Looks for text in a tab's page, or for its next or previous match.
   * @param id - The tab.
   * @param query - The text.
   * @param forward - Whether to look forward.
   * @param next - Whether to go on from the current match.
   */
  find(id: TabId, query: string, forward: boolean, next: boolean): void {
    // Only web pages are searched, with the code for web pages.
    this.webPages().run((pages) => pages.find(this.windowHost(), id, query, forward, next));
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
    // The browser's own pages keep their zoom; the code for web pages zooms theirs.
    if (this.webContentsOf(id) === undefined) return;
    this.webPages().run((pages) => pages.zoom(this.windowHost(), id, direction));
  }

  /**
   * Gives the pages of sites without a zoom of their own a new default zoom.
   * @param factor - The new default zoom.
   */
  applyDefaultZoom(factor: number): void {
    // Before the code for web pages has loaded, no web page has loaded either: the first ones
    // get the default zoom of the moment as they load.
    this.webPages().loaded?.applyDefaultZoom(this.windowHost(), factor);
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
    this.withCommands((code, host) => code.openPage(host, page, fragment));
  }

  /**
   * Runs the shortcut of a key press in the shell or in a tab before the view sees the key.
   * The mouse's back and forward buttons need nothing here: Chromium navigates the page
   * under the pointer itself, and the shell passes them on to the active tab. The window's
   * `app-command` event reports them as well and stays unused, or one click would go back
   * two pages.
   * @returns Whether the window took the key, so that the view does not see it.
   */
  private intercept(event: { preventDefault(): void }, input: Input, contentsId: number): boolean {
    if (this.options.shortcutRecorder?.()?.take(contentsId, input, process.platform) === true) {
      event.preventDefault();
      this.altTap.reset();
      return true;
    }
    const command = commandForInput(input, process.platform, this.shortcuts());
    if (command !== undefined) {
      event.preventDefault();
      // Alt+Left and the like are no Alt alone.
      this.altTap.reset();
      this.execute(command);
      return true;
    }
    // The keys typed right after the shortcut of the command palette go to the palette.
    if (this.holdKey(input)) {
      event.preventDefault();
      this.altTap.reset();
      return true;
    }
    this.tapAlt(input, contentsId);
    return false;
  }

  /**
   * Opens the browser menu when Alt is pressed and released alone in a view of the window, on
   * Windows and Linux, unless the setting turned it off or a page shows something in full
   * screen. The pointer while Alt is down, as for a drag that the desktop moves the window
   * with or a drag in a page that started before Alt, and the release of Alt in another view
   * open nothing. Nothing gets ready while Alt is down, as Alt starts many shortcuts.
   */
  private tapAlt(input: Input, contentsId: number): void {
    if (process.platform === 'darwin') return;
    const tap = this.altTap.key(input);
    if (tap === 'arm') {
      this.altFrom = contentsId;
      this.watchPointer(contentsId);
    } else if (
      tap === 'open' &&
      this.altFrom === contentsId &&
      this.fullScreenTab === undefined &&
      this.options.altOpensMenu?.() === true
    ) {
      this.execute('menu.open');
    }
  }

  /**
   * Disarms the tap of Alt when the pointer is pressed, released, turns its wheel or drags in
   * the view while Alt is down.
   */
  private watchPointer(contentsId: number): void {
    const contents =
      this.shell.webContents.id === contentsId
        ? this.shell.webContents
        : [...this.entries.values()].find((entry) => entry.view.webContents.id === contentsId)?.view
            .webContents;
    if (contents === undefined || contents.isDestroyed()) return;
    const onInput = (_event: unknown, input: Electron.InputEvent): void => {
      this.altTap.pointer(input);
      if (!this.altTap.waiting || this.altFrom !== contentsId) contents.off('input-event', onInput);
    };
    contents.on('input-event', onInput);
  }

  /**
   * Gives a tab without a view, such as a restored one, its view: of the kind of the entry that
   * the tab shows, with the tab's back and forward history, or a view that loads the tab's
   * address when the tab has no history.
   */
  private wake(id: TabId): void {
    const dormant = this.dormant.get(id);
    if (dormant === undefined) return;
    this.dormant.delete(id);
    if (dormant.history === undefined) {
      this.create(id, dormant.url);
    } else {
      const { views, current } = ViewHistory.fromTabHistory(dormant.history);
      const url = current.entries[current.index]?.url ?? dormant.url;
      const entry: TabEntry = {
        ...this.createView(id, url),
        requested: url,
        history: views,
        restored: url,
      };
      this.entries.set(id, entry);
      this.restoreInto(entry.view.webContents, current);
      this.usedAt.set(id, this.now());
    }
    this.tabs.update(id, { sleeping: false, loading: true, problem: null });
  }

  /**
   * Whether a tab may go to sleep now: it has a view whose page is not shown, plays no sound
   * and is not busy otherwise, such as with a camera, a download or a page that it opened. The
   * browser leaves pinned tabs awake, and pages that people typed into since they loaded;
   * people may put them to sleep.
   * @param id - The tab.
   * @param mode - Whether people ask for it, or the browser does after the tab was not used.
   */
  canSleep(id: TabId, mode: SleepMode): boolean {
    return this.laterCommands()?.canSleep(this.windowHost(), id, mode) ?? false;
  }

  sleep(id: TabId, mode: SleepMode): boolean {
    return this.laterCommands()?.sleep(this.windowHost(), id, mode) ?? false;
  }

  /**
   * The tabs of the window as candidates to sleep, with since when each was not used: since it
   * was last shown, opened, quiet again or busy otherwise.
   */
  sleepCandidates(): SleepCandidate[] {
    return this.laterCommands()?.sleepCandidates(this.windowHost()) ?? [];
  }

  /**
   * Closes the view of a tab, which keeps its history until it wakes, and shows the tab as a
   * tab that sleeps, with its title and icon.
   */
  private putToSleep(id: TabId, entry: TabEntry, dormant: DormantTab): void {
    this.entries.delete(id);
    entry.iconLoad?.abort();
    entry.iconLoad = undefined;
    this.close(entry.view, entry.registration);
    // A page in the background may still show an element in full screen; it ends with the page.
    this.endPageFullScreen(id);
    this.dormant.set(id, dormant);
    const moves =
      dormant.history === undefined
        ? { back: false, forward: false }
        : historyMoves(dormant.history);
    this.tabs.update(id, {
      sleeping: true,
      loading: false,
      audible: false,
      problem: null,
      canGoBack: moves.back,
      canGoForward: moves.forward,
    });
  }

  /** The time of the wall clock, in milliseconds. */
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /**
   * The back and forward history of a tab across its views, as the session keeps it. For an
   * open tab, it is made when it is needed and kept until the page changes, so that a session
   * costs little while tabs change; the page states in it, such as the scroll position, may be
   * older than the page.
   * @param id - The tab.
   * @param fresh - Reads the history of an open tab anew, with its page states of now.
   * @returns The history, or `undefined` for a tab without one.
   */
  historyOf(id: TabId, fresh = false): TabHistory | undefined {
    const dormant = this.dormant.get(id);
    if (dormant !== undefined) return dormant.history;
    const entry = this.entries.get(id);
    // A page that closed itself left its view without contents.
    const contents: WebContents | undefined = entry?.view.webContents;
    if (entry === undefined || contents === undefined || contents.isDestroyed()) {
      return entry?.cache;
    }
    if (fresh || entry.cache === undefined) {
      entry.cache = entry.history.toTabHistory(this.snapshot(entry));
    }
    return entry.cache;
  }

  /**
   * Reads the history of every open tab anew, with the page states of now, such as the scroll
   * positions, for the next session: before the last window closes, after which no tab is left
   * to read.
   */
  readHistories(): void {
    for (const id of this.entries.keys()) this.historyOf(id, true);
  }

  /**
   * Forgets the back and forward history of every tab, as when the whole history is cleared:
   * each tab keeps only the entry that it shows.
   */
  forgetHistories(): void {
    this.withCommands((code, host) => code.forgetHistories(host));
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
    // Electron gives a page that a view takes over the preferences of the view, so that the
    // page, as the browser's other web pages, leaves the window to the browser in full screen:
    // Electron would put the window in full screen before it reports the page's.
    const view = new WebContentsView(
      adopted === undefined
        ? this.viewOptions(page)
        : { webContents: adopted, webPreferences: { disableHtmlFullscreenWindowResize: true } },
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
      // What a web page does as it navigates, fails or stops answering is followed by the code
      // for web pages, which loads with the first of them; the page loads once it is there.
      this.watchWebPage(id, view, adopted !== undefined);
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
    // A tab keeps its sound muted when it changes between web pages and the browser's own.
    contents.setAudioMuted(this.tabs.all.find((tab) => tab.id === id)?.muted ?? false);
    contents.on('did-start-loading', sync);
    contents.on('did-stop-loading', sync);
    contents.on('did-navigate', sync);
    contents.on('did-navigate-in-page', sync);
    contents.on('page-title-updated', sync);
    contents.on('before-input-event', (event, input) => {
      const taken = this.intercept(event, input, contents.id);
      // A web page that people type into may hold changes that it has not saved yet; the code
      // for web pages takes note of it, which is there before the page loads.
      if (!taken && page === undefined) {
        this.webPages().loaded?.typed(this.windowHost(), contents, input);
      }
    });
    this.forwardContextMenu(view, id);
    return { view, page, registration };
  }

  /**
   * Puts the window in full screen for a page, or takes it out again. On macOS, the window
   * covers the screen without the animation into a space of its own: while that animation
   * runs, Electron keeps the page in full screen, also after it left. Out of it, the window
   * goes back where it was before.
   */
  private setPageFullScreen(on: boolean): void {
    if (process.platform !== 'darwin') {
      this.setFullScreen(on);
      return;
    }
    const before = this.placeBeforeFullScreen;
    this.window.setSimpleFullScreen(on);
    if (!on && before !== undefined) this.placeAgain(before);
  }

  /**
   * Puts the window in full screen, or takes it out, and notes where it was before.
   * @param maximized - Whether the window is maximized, when the system may not say so yet, as
   *   right after a window that opens maximized asked for it on Linux.
   */
  private setFullScreen(on: boolean, maximized?: boolean): void {
    if (on) this.notePlace(maximized);
    this.window.setFullScreen(on);
  }

  /**
   * Puts a window back where it was before full screen on macOS once it left full screen, and
   * maximizes it again when it was, unless it is so. Electron ends a page's full screen at the
   * place where it last put the window itself, not where people moved it, nor maximized; and a
   * window that opened again maximized and in full screen has come back from full screen not
   * maximized. Electron takes the place that a maximized window goes back to from where the
   * window is when it maximizes, so the window goes to its place from before first.
   * @param before - Where the window was before full screen, and whether it was maximized.
   */
  private placeAgain(before: NormalPlace): void {
    // Out of the report of the end of full screen: AppKit counts a change made there as part
    // of the transition, as Electron notes for a full screen that follows.
    setTimeout(() => {
      const window = this.window;
      if (
        window.isDestroyed() ||
        window.isFullScreen() ||
        window.isSimpleFullScreen() ||
        window.isMinimized() ||
        (before.maximized && window.isMaximized())
      ) {
        return;
      }
      window.setBounds(before.bounds);
      if (before.maximized && !window.isMaximized()) window.maximize();
    }, 0);
  }

  /**
   * Notes where the window is, while it is neither in full screen, nor on its way out of it,
   * nor minimized.
   * @param maximized - Whether the window is maximized, when the system may not say so yet.
   */
  private notePlace(maximized?: boolean): void {
    const window = this.window;
    if (
      window.isDestroyed() ||
      window.isFullScreen() ||
      window.isSimpleFullScreen() ||
      window.isMinimized() ||
      this.fullScreenEntered
    ) {
      return;
    }
    this.placeBeforeFullScreen = {
      bounds: window.getNormalBounds(),
      maximized: maximized ?? window.isMaximized(),
    };
  }

  /**
   * Runs an item of the menu of a tab.
   * @param id - The tab.
   * @param action - What to do with it.
   */
  tabAction(id: TabId, action: TabAction): void {
    this.withCommands((code, host) => code.tabAction(host, id, action));
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
    const iconSessions = new Set<Electron.Session>();
    for (const { view } of this.entries.values()) {
      // A page that closed itself left its view without contents.
      const contents: WebContents | undefined = view.webContents;
      if (contents !== undefined && !contents.isDestroyed()) iconSessions.add(contents.session);
    }
    // A tab that sleeps has no view; the icon of its page stays with the window's web pages.
    iconSessions.add(
      this.isPrivate
        ? this.options.privateSession()
        : sessions.fromPartition(this.options.webPartition),
    );
    for (const iconSession of iconSessions) {
      const icon = favicons.get(iconSession, key);
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
    // The page changed, so its history is read again when the session needs it.
    entry.cache = undefined;
    const history = contents.navigationHistory;
    if (entry.clearing === true) {
      // Chromium keeps every entry while a load of one of them runs; it is tried again with
      // each change of the page until no other entry is left.
      history.clear();
      entry.clearing = history.length() > 1;
    }
    const steps = entry.clearing !== true;
    this.tabs.update(id, {
      url: contents.getURL() || entry.requested,
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: (steps && history.canGoBack()) || entry.history.canGoBack,
      canGoForward: (steps && history.canGoForward()) || entry.history.canGoForward,
      zoom: contents.getZoomFactor(),
    });
  }

  /** The history of a tab's current view, for {@link ViewHistory}. */
  private snapshot(entry: TabEntry): ViewSnapshot {
    const contents = entry.view.webContents;
    const history = contents.navigationHistory;
    const entries = history
      .getAllEntries()
      .map(({ url, title, pageState }) =>
        pageState === undefined ? { url, title } : { url, title, pageState },
      );
    if (entries.length > 0) {
      const view = { entries, index: history.getActiveIndex() };
      // Entries that go once a load ends are not kept.
      return entry.clearing === true ? onlyShown(view) : view;
    }
    // A view that still waits for its internal page has the history that it is to restore.
    return (
      this.waiting.get(contents)?.restore ?? {
        entries: [{ url: entry.requested, title: '' }],
        index: 0,
      }
    );
  }

  /** Shows a view that the tab had before, with its history. */
  private restore(id: TabId, entry: TabEntry, snapshot: ViewSnapshot | undefined): void {
    const current = snapshot?.entries[snapshot.index];
    if (snapshot === undefined || current === undefined) {
      return;
    }
    this.replaceView(id, entry, current.url, (contents) => this.restoreInto(contents, snapshot));
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
    // The new view's first page is a page of its own, not the one that a waking tab restores.
    Object.assign(entry, this.createView(id, url), {
      requested: url,
      restored: undefined,
      clearing: undefined,
    });
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
    // A load after a restore that still waits keeps the restored entries before it.
    this.runJob(contents, tabPageOf(url), {
      restore: this.waiting.get(contents)?.restore,
      load: url,
    });
  }

  /**
   * Restores the history of a view, with the page states of its entries, such as their
   * scroll positions and form values, once the browser process is ready for its internal page.
   * @param contents - The view's contents, which have no entries yet.
   * @param snapshot - The history of the view.
   */
  private restoreInto(contents: WebContents, snapshot: ViewSnapshot): void {
    const url = snapshot.entries[snapshot.index]?.url ?? '';
    this.runJob(contents, tabPageOf(url), { restore: snapshot });
  }

  /**
   * Runs what a view is to do once the browser process is ready for its page: at once for a
   * page that is ready, or else after the handlers of an internal page loaded, or the code
   * for web pages that follows the view of a web page. A later job of the same view wins over
   * this one while it waits.
   */
  private runJob(contents: WebContents, page: TabPage | undefined, job: PageJob): void {
    this.waiting.set(contents, job);
    const start = (): void => {
      if (this.waiting.get(contents) !== job || contents.isDestroyed()) return;
      this.waiting.delete(contents);
      this.startJob(contents, job);
    };
    // A web page loads once the code for web pages follows its view, which a view made while
    // that code loads waits for; it loads without it when the code cannot load.
    if (page === undefined) {
      this.webPages().run(start, start);
      return;
    }
    const preparing = this.options.prepareInternalPage?.(page);
    if (preparing === undefined) start();
    else void preparing.then(start);
  }

  /**
   * Has the code for web pages follow a new view of a web page: at once when it has loaded,
   * or else once it is there, before the view's first load.
   */
  private watchWebPage(id: TabId, view: WebContentsView, adopted: boolean): void {
    const contents = view.webContents;
    this.webPages().run((pages) => {
      if (!contents.isDestroyed()) pages.watch(this.windowHost(), id, view, adopted);
    });
  }

  /** The code for web pages, which loads with the first web page of any window. */
  private webPages(): LaterCode<WebPages> {
    return laterCodeOf(this.options).pages;
  }

  /**
   * The commands of the windows that load later, once they are there: the menus, the command
   * palette and the timer of sleeping tabs ask with them only after they loaded.
   */
  private laterCommands(): WindowCommands | undefined {
    return laterCodeOf(this.options).commands.loaded;
  }

  /** The commands of the windows that load later, which those who ask with them wait for. */
  private loadedCommands(): WindowCommands {
    const code = this.laterCommands();
    if (code === undefined) throw new Error('The commands of the windows did not load');
    return code;
  }

  /**
   * Runs a call with the commands of the windows that load later: at once when they are there,
   * or else once they loaded, after the calls and commands that came before.
   */
  private withCommands(call: (code: WindowCommands, host: WindowHost) => void): void {
    laterCodeOf(this.options).commands.run((code) => call(code, this.windowHost()));
  }

  /** What the code of the window that loads later uses of it. */
  private windowHost(): WindowHost {
    this.host ??= {
      window: this,
      options: this.options,
      entries: this.entries,
      madeZoom: this.madeZoom,
      webContentsOf: (id) => this.webContentsOf(id),
      usedAt: this.usedAt,
      dropFavicon: (id) => this.dropFavicon(id),
      shownViewOf: (entry) => this.shownViewOf(entry),
      triedAt: this.triedAt,
      putToSleep: (id, entry, dormant) => this.putToSleep(id, entry, dormant),
      now: () => this.now(),
      findState: () => this.finding,
      setFindState: (state) => {
        this.finding = state;
        this.schedulePublish();
      },
      keepQuery: (query) => {
        this.lastQuery = query;
      },
      dormant: this.dormant,
      waiting: this.waiting,
      wake: (id) => this.wake(id),
      sync: (id, contents) => this.sync(id, contents),
      snapshot: (entry) => this.snapshot(entry),
      restore: (id, entry, snapshot) => this.restore(id, entry, snapshot),
    };
    return this.host;
  }

  private startJob(contents: WebContents, job: PageJob): void {
    const { restore, load } = job;
    if (restore !== undefined) {
      // Chromium takes the entries at once; a load right after it keeps them before its own.
      contents.navigationHistory
        .restore({ entries: [...restore.entries], index: restore.index })
        .catch((error: unknown) => {
          if (!String(error).includes('ERR_ABORTED')) {
            this.options.logger.debug('History restore failed', { error: String(error) });
          }
        });
    }
    if (load !== undefined) this.startLoad(contents, load);
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
  private readonly keptEmitter = new Emitter<KeptChange>();
  /**
   * Fires after windows opened or closed, another regular window became the one used last, or
   * their tabs changed in a way that a session keeps, and before the last regular window closes,
   * once its tabs read their histories anew.
   */
  readonly onDidChangeKept: Event<KeptChange> = this.keptEmitter.event;
  private readonly boundsEmitter = new Emitter<void>();
  /** Fires while a window moves or changes its size. */
  readonly onDidMove: Event<void> = this.boundsEmitter.event;
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment for new windows. */
  constructor(options: BrowserWindowOptions) {
    this.options = options;
  }

  /**
   * Waits for the commands of the windows that load later (`window-commands.ts`), which load
   * with it if they have not: the menus, the command palette and the timer of sleeping tabs
   * ask the windows about their tabs with them.
   * @returns Resolves once they are there, or could not load.
   */
  laterCode(): Promise<void> {
    return new Promise((resolve) =>
      laterCodeOf(this.options).commands.run(() => resolve(), resolve),
    );
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
   * Opens windows again with their tabs, such as those of a stored session. Only the active
   * tab of each window loads; the others load when they are shown.
   * @param windows - The windows, with their tabs and where they were.
   * @returns The first window, or a new window with a new tab page when there is none.
   */
  restore(windows: readonly RestoredWindow[]): BrowserWindowController {
    const areas = workAreas();
    // The window used last opens last, so that it ends up in front.
    const controllers = windows.map(({ tabs, active, place }) => {
      const controller = this.add({
        bounds: place.bounds === undefined ? undefined : visibleBounds(place.bounds, areas),
        maximized: place.maximized,
        fullScreen: place.fullScreen,
      });
      const ids = tabs.map((tab, index) =>
        controller.tabs.open(tab.url, {
          activate: false,
          lazy: index !== active,
          title: tab.title,
          pinned: tab.pinned === true,
          history: tab.history,
        }),
      );
      const activeId = ids[active] ?? ids[0];
      if (activeId !== undefined) controller.tabs.activate(activeId);
      return controller;
    });
    return controllers[0] ?? this.open();
  }

  /**
   * The tabs of every open window, as a session keeps them, with their back and forward
   * history, and the windows in the order in which they were used, the window used last at the
   * end.
   * @param options - `fresh` reads the history of every open tab anew, with the page states
   *   of now, such as when the browser quits; without it, a tab gives the history that it gave
   *   since its page last changed.
   */
  snapshot(options: { readonly fresh?: boolean } = {}): SessionSnapshot {
    const fresh = options.fresh === true;
    return {
      version: 1,
      // Popups and private windows are not kept; the window that opened a popup is.
      windows: this.keptByFocus()
        .toReversed()
        .flatMap((controller) => {
          const tabs = controller.tabs.all;
          const active = controller.tabs.active;
          const window = sessionWindow(
            tabs.map(({ id, url, title, pinned }) => ({
              url,
              title,
              pinned,
              history: controller.historyOf(id, fresh),
            })),
            active === undefined ? -1 : tabs.indexOf(active),
            {
              ...controller.normalPlace,
              fullScreen: controller.fullScreen,
            },
          );
          return window === undefined ? [] : [window];
        }),
    };
  }

  /**
   * Forgets the back and forward history of the tabs of every regular window, and the
   * session's with them, as when the whole history is cleared; each tab keeps only the entry
   * that it shows. Private windows keep theirs, as they keep no history to clear.
   */
  forgetTabHistories(): void {
    for (const window of this.windows) {
      if (!window.isPrivate) window.forgetHistories();
    }
    this.keptEmitter.fire(keptChange);
  }

  private add(place?: WindowPlace): BrowserWindowController {
    const controller = new BrowserWindowController(this.options, place);
    this.windows.add(controller);
    const listener = controller.tabs.onDidChange(() => this.changeEmitter.fire());
    const kept = controller.tabs.onDidChangeKept((change) => this.keptEmitter.fire(change));
    // The session keeps where each window is.
    const moved = (): void => this.boundsEmitter.fire();
    controller.window.on('move', moved);
    controller.window.on('resize', moved);
    controller.window.on('maximize', moved);
    controller.window.on('unmaximize', moved);
    controller.window.on('enter-full-screen', moved);
    controller.window.on('leave-full-screen', moved);
    const forget = (): void => {
      const index = this.focusOrder.indexOf(controller);
      if (index !== -1) this.focusOrder.splice(index, 1);
    };
    controller.window.on('focus', () => {
      // The focus that a window got while it opened can reach it after it closed, on macOS
      // when it closes right away; a closed window never counts as the one used last.
      if (!this.windows.has(controller)) return;
      const before = this.keptByFocus();
      forget();
      this.focusOrder.push(controller);
      this.options.onFocus?.();
      // The session keeps the order in which the regular windows were used; popups and private
      // windows are not in it.
      const after = this.keptByFocus();
      if (after.some((window, index) => before[index] !== window)) {
        this.keptEmitter.fire(keptChange);
      }
    });
    // The last regular window that closes takes the page states of its tabs of now into the
    // session, such as the scroll positions, as its tabs are gone when the browser quits.
    controller.window.on('close', () => {
      if (!inSession(controller) || this.keptByFocus().some((other) => other !== controller)) {
        return;
      }
      controller.readHistories();
      this.keptEmitter.fire(keptChange);
    });
    controller.window.on('closed', () => {
      listener.dispose();
      kept.dispose();
      forget();
      this.windows.delete(controller);
      this.changeEmitter.fire();
      this.keptEmitter.fire(keptChange);
      if (controller.isPrivate && ![...this.windows].some((other) => other.isPrivate)) {
        this.options.onPrivateWindowsClosed?.();
      }
    });
    return controller;
  }

  /**
   * The open windows in the order in which they had the focus, the one that had it last first;
   * windows that never had it come after them, the newest first.
   */
  get byFocus(): readonly BrowserWindowController[] {
    const focused = this.focusOrder.toReversed();
    const others = [...this.windows].filter((window) => !focused.includes(window)).toReversed();
    return [...focused, ...others].filter((window) => this.windows.has(window));
  }

  /** The windows that the session keeps, in the order of {@link WindowManager.byFocus}. */
  private keptByFocus(): BrowserWindowController[] {
    return this.byFocus.filter(inSession);
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

/** Whether the session keeps a window: popups and private windows are not kept. */
function inSession(window: BrowserWindowController): boolean {
  return !window.popup && !window.isPrivate;
}

/** The history of a view with only the entry that it shows. */
export function onlyShown(view: ViewSnapshot): ViewSnapshot {
  const entry = view.entries[view.index];
  return entry === undefined ? view : { entries: [entry], index: 0 };
}

/** Whether two popovers of the shell are the same, or both none. */
function samePopover(a: ShellPopover | null, b: ShellPopover | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.folder === b.folder);
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
