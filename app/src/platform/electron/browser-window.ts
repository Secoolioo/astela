import {
  BaseWindow,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Rectangle,
  type WebContents,
} from 'electron';
import { DisposableStore, toDisposable, type Disposable } from '../../shared/disposable.ts';
import type { Capability } from '../../shared/ipc/contract.ts';
import type { TabStripPosition } from '../../shared/layout.ts';
import {
  ShellCommand,
  ShellStateChanged,
  type ShellState,
} from '../../shared/ipc/shell-contracts.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import { pageUrl, sharedChannels, tabPageOf, type TabPage } from '../../shared/internal-pages.ts';
import { TabService, type TabId, type TabViewPort } from '../../domain/tabs/tab-service.ts';
import { ViewHistory, type ViewSnapshot } from '../../domain/tabs/view-history.ts';
import type { IpcGate } from './ipc-gate.ts';
import type { IpcRouter } from './ipc-router.ts';
import { commandForInput, type WindowCommand } from './shortcuts.ts';

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
  /** URL of a new tab. */
  readonly newTabUrl: string;
  /** Window background while the shell loads, for the current light or dark mode. */
  readonly backgroundColor: () => string;
  /** Command line argument that gives a view of the browser's own UI its design tokens. */
  readonly appearanceArgument: () => string;
  /** Where the shell shows the tab strip. */
  readonly tabStripPosition: () => TabStripPosition;
  /** Whether the content blocker works on a page: `none` for pages it never touches. */
  readonly blocking: (url: string) => 'on' | 'off' | 'none';
  readonly gate: IpcGate;
  readonly router: IpcRouter;
  readonly logger: Logger;
  /** Shows the context menu of a view; without it, views have none. */
  readonly onContextMenu?: (request: ContextMenuRequest) => void;
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
  private visible: WebContentsView | undefined;
  private insets: Insets = { top: 76, right: 0, bottom: 0, left: 0 };
  private readonly subscriptions = new DisposableStore();
  private publishTimer: NodeJS.Timeout | undefined;
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment of the window. */
  constructor(options: BrowserWindowOptions) {
    this.options = options;
    this.window = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 480,
      minHeight: 320,
      // Shown at once in the theme's background color: Chromium lowers the priority of the
      // renderer of a hidden window, so the shell would load later in one.
      backgroundColor: options.backgroundColor(),
    });
    this.shell = new WebContentsView({
      webPreferences: {
        preload: options.shellPreload,
        partition: options.internalPartition,
        additionalArguments: [options.appearanceArgument()],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        v8CacheOptions: 'bypassHeatCheck',
      },
    });
    this.shell.setBackgroundColor(options.backgroundColor());
    this.window.contentView.addChildView(this.shell);
    this.subscriptions.add(
      options.gate.registerView(this.shell.webContents.id, {
        origin: options.shellOrigin,
        capabilities: new Set(['shell', 'appearance']),
      }),
    );
    this.tabs = new TabService(this, options.newTabUrl);
    this.subscriptions.add(this.tabs.onDidChange(() => this.schedulePublish()));
    this.subscriptions.add(this.tabs);
    this.shell.webContents.on('before-input-event', (event, input) => this.intercept(event, input));
    this.forwardContextMenu(this.shell, undefined);
    this.shell.webContents.once('did-finish-load', () => this.layout());
    this.window.on('resize', () => this.layout());
    this.window.on('closed', () => this.dispose());
    void this.shell.webContents.loadURL(options.shellUrl);
    this.layout();
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
      tabs: this.tabs.all.map(({ id, title, url, loading, canGoBack, canGoForward, blocked }) => ({
        id,
        title,
        url,
        loading,
        canGoBack,
        canGoForward,
        blocked,
        blocking: this.options.blocking(url),
      })),
      activeTabId: this.tabs.active?.id ?? null,
      tabStrip: this.options.tabStripPosition(),
    };
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

  create(id: TabId, url: string): void {
    const entry: TabEntry = {
      ...this.createView(id, url),
      requested: url,
      history: new ViewHistory(),
    };
    this.entries.set(id, entry);
    this.loadInto(entry.view.webContents, url);
  }

  show(id: TabId): void {
    const entry = this.entries.get(id);
    const view = entry?.view;
    if (view === undefined || view === this.visible) {
      return;
    }
    if (this.visible !== undefined) {
      this.window.contentView.removeChildView(this.visible);
    }
    this.visible = view;
    this.window.contentView.addChildView(view);
    this.layout();
    // On the new tab page, typing goes to the address bar, which the shell focuses.
    if (entry?.page === 'newtab') {
      this.shell.webContents.focus();
    } else {
      view.webContents.focus();
    }
  }

  destroy(id: TabId): void {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }
    this.entries.delete(id);
    this.close(entry.view, entry.registration);
  }

  load(id: TabId, url: string): void {
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
    const color = this.options.backgroundColor();
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
      case 'omnibox.focus':
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
      case 'settings.open':
        this.openPage('settings');
        break;
    }
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
  private intercept(event: { preventDefault(): void }, input: Input): void {
    const command = commandForInput(input, process.platform);
    if (command !== undefined) {
      event.preventDefault();
      this.execute(command);
    }
  }

  /**
   * Creates the view for a URL: a web view without a preload, or for an internal page a
   * view in the internal session whose preload only offers that page's channels.
   */
  private createView(id: TabId, url: string): Pick<TabEntry, 'view' | 'page' | 'registration'> {
    const page = tabPageOf(url);
    const view = new WebContentsView({
      webPreferences:
        page === undefined
          ? {
              partition: this.options.webPartition,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              // Lets the content blocker's frame preload run in iframes; Node stays off.
              nodeIntegrationInSubFrames: true,
              spellcheck: false,
            }
          : {
              preload: this.options.pagePreload,
              partition: this.options.internalPartition,
              additionalArguments: [
                `--bridge-scope=${[page, ...sharedChannels[page]].join(',')}`,
                this.options.appearanceArgument(),
              ],
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              spellcheck: false,
              v8CacheOptions: 'bypassHeatCheck',
            },
    });
    const contents = view.webContents;
    let registration: Disposable | undefined;
    if (page !== undefined) {
      view.setBackgroundColor(this.options.backgroundColor());
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
    // The count of blocked requests belongs to one page.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument && this.entries.get(id)?.view === view) {
        this.tabs.update(id, { blocked: 0 });
      }
    });
    contents.on('did-start-loading', sync);
    contents.on('did-stop-loading', sync);
    contents.on('did-navigate', sync);
    contents.on('did-navigate-in-page', sync);
    contents.on('page-title-updated', sync);
    contents.on('before-input-event', (event, input) => this.intercept(event, input));
    this.forwardContextMenu(view, id);
    return { view, page, registration };
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
    Object.assign(entry, this.createView(id, url), { requested: url });
    if (this.visible === old && !this.window.isDestroyed()) {
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
    view.webContents.close();
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
    const { top, right, bottom, left } = this.insets;
    this.visible?.setBounds({
      x: left,
      y: top,
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
    });
  }

  private schedulePublish(): void {
    // Coalesce bursts of tab events into one message per frame.
    this.publishTimer ??= setTimeout(() => {
      this.publishTimer = undefined;
      this.options.router.publish(ShellStateChanged, this.shell.webContents, this.state());
    }, 16);
  }
}

/** Keeps track of open windows and routes shell requests to the right one. */
export class WindowManager implements Disposable {
  private readonly windows = new Set<BrowserWindowController>();
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment for new windows. */
  constructor(options: BrowserWindowOptions) {
    this.options = options;
  }

  /** Opens a window with one tab. */
  open(url?: string): BrowserWindowController {
    const controller = new BrowserWindowController(this.options);
    this.windows.add(controller);
    controller.window.on('closed', () => this.windows.delete(controller));
    controller.tabs.open(url);
    return controller;
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
