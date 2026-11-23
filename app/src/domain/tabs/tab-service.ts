import type { Disposable } from '../../shared/disposable.ts';
import type { PictureInPictureState, ReaderState } from '../../shared/page-tools.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import { historyMoves, sessionLimits, trimHistory } from './tab-history.ts';
import { TabStrip, type SplitPair, type TabGroup, type WorkspaceTabs } from './tab-strip.ts';
import type { TabHistory } from './view-history.ts';

export type { SplitPair, TabGroup } from './tab-strip.ts';

/** Identifier of a tab, such as `t1a`. */
export type TabId = string;

/**
 * Why a tab shows no page: the page could not be loaded (`error`), the certificate of its
 * site is not trusted (`certificate`), the site has no secure connection (`insecure`, with the
 * insecure address in `url`), or the process that showed it is gone (`crashed`).
 * `code` is Chromium's name for the cause, such as `ERR_CONNECTION_REFUSED`, `url` the
 * address of the page, and `proceed` whether the user may continue to it after a warning.
 */
export interface TabProblem {
  readonly kind: 'error' | 'certificate' | 'insecure' | 'crashed';
  readonly code: string;
  readonly url: string;
  readonly proceed: boolean;
}

/** The state of one tab. */
export interface Tab {
  readonly id: TabId;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  /** Requests that the content blocker blocked on the current page. */
  readonly blocked: number;
  /** Why the tab shows no page, or `null` when it shows one. */
  readonly problem: TabProblem | null;
  /** The zoom factor of the page, 1 for 100 %. */
  readonly zoom: number;
  /**
   * The key of the page's icon in the browser's `FaviconStore`, or `null` while the page has
   * none. It is no address of an image: the shell asks for the icon by this key.
   */
  readonly favicon: string | null;
  /** Whether the page plays sound. */
  readonly audible: boolean;
  /** Whether the sound of the tab is muted. */
  readonly muted: boolean;
  /** Whether the tab is pinned: pinned tabs come first and are small. */
  readonly pinned: boolean;
  /**
   * Whether the tab has no view and keeps only its history, as a tab that was put to sleep or
   * a restored tab that was not shown yet; it loads again once it is shown.
   */
  readonly sleeping: boolean;
  /** The group of tabs that the tab is in, or `null`; only the strip changes it. */
  readonly group: TabGroup | null;
  /** Whether the page has an article for the reader view, and whether the reader view shows it. */
  readonly reader: ReaderState;
  /** Whether a video of the page plays, which picture in picture can show, or shows in it. */
  readonly pictureInPicture: PictureInPictureState;
}

/** Fields of a tab that the web view reports. */
export type TabUpdate = Partial<Omit<Tab, 'id' | 'group'>>;

/**
 * Who puts a tab to sleep: people from the menu of the tab (`manual`), or the browser after
 * the tab was not used for a while (`auto`), which leaves pinned tabs and pages that ask to
 * stay awake.
 */
export type SleepMode = 'manual' | 'auto';

/**
 * Port to the web views of a window. The platform layer implements it with one
 * `WebContentsView` per tab; tests use a fake.
 */
export interface TabViewPort {
  /**
   * Creates the view of a tab and loads the URL. A lazy tab gets its view only when it is
   * shown, so restored tabs cost nothing until they are used. A tab with a history comes back
   * with its back and forward lists; the entry that the history shows has the URL.
   */
  create(id: TabId, url: string, lazy?: boolean, history?: TabHistory): void;
  /**
   * Shows the view of a tab and, with a split view, the view of the other tab of the pair
   * beside it, and hides what showed before. It is called again when the split view of the
   * active tab changes.
   */
  show(id: TabId, split?: SplitPair): void;
  /** Destroys the view of a tab. */
  destroy(id: TabId): void;
  /** Loads a URL in a tab. */
  load(id: TabId, url: string): void;
  /** Runs a history or loading action. */
  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void;
  /**
   * The back and forward history of a tab, with what its pages hold now, such as typed text.
   * @param fresh - Reads it anew, rather than as it was kept last.
   */
  historyOf?(id: TabId, fresh?: boolean): TabHistory | undefined;
  /**
   * Puts a tab that the window does not show to sleep: its view closes and the tab keeps its
   * history, with which it loads again once it is shown.
   * @returns Whether the tab goes to sleep; a tab that is busy, such as one that plays sound,
   *   stays awake.
   */
  sleep(id: TabId, mode: SleepMode): boolean;
}

/** Options for {@link TabService.open}. */
export interface OpenTabOptions {
  /**
   * Whether the new tab becomes the active tab. Defaults to `true`. Tabs opened in the
   * background line up after the active tab in the order they open, until another tab
   * becomes active, so links opened one after another keep their order.
   */
  readonly activate?: boolean;
  /** Creates the tab's view only when the tab is shown. */
  readonly lazy?: boolean;
  /** Title to show until the page reports its own, such as the title of a restored tab. */
  readonly title?: string;
  /** Opens the tab pinned, at the end of the pinned tabs. */
  readonly pinned?: boolean;
  /** Opens the tab right after this tab instead of after the active one, in its group. */
  readonly after?: TabId;
  /**
   * The tab whose page opened the tab, such as with a link: once the window has groups of tabs,
   * the new tab joins the group of that tab.
   */
  readonly opener?: TabId | undefined;
  /** The group that the tab joins, at its end; a group that the window does not have forms. */
  readonly group?: TabGroup | undefined;
  /**
   * The back and forward history that the tab comes back with, such as that of a restored
   * tab; the entry that it shows has the tab's URL.
   */
  readonly history?: TabHistory | undefined;
}

/** Token for the {@link TabService} of a window. */
export const TabServiceToken: Token<TabService> = token<TabService>('TabService');

/** Fields that {@link TabService.update} compares. */
const tabFields = [
  'url',
  'title',
  'loading',
  'canGoBack',
  'canGoForward',
  'blocked',
  'problem',
  'zoom',
  'favicon',
  'audible',
  'muted',
  'pinned',
  'sleeping',
  'reader',
  'pictureInPicture',
] as const;

/**
 * Fields of a tab that a session keeps, or that change what it keeps: the history of a tab that
 * sleeps comes from another place than that of a tab that is awake.
 */
const keptFields = ['url', 'title', 'pinned', 'sleeping'] as const;

/** A change that a session keeps. */
export interface KeptChange {
  /**
   * Whether only titles of pages changed, which a session may write later: some pages change
   * their title all the time, such as a timer.
   */
  readonly titleOnly: boolean;
}

/** A change of tabs, windows or pages that the session cannot wait long for. */
export const keptChange: KeptChange = { titleOnly: false };
/** A change of titles of pages alone. */
const titleChange: KeptChange = { titleOnly: true };

/**
 * Owns the tabs of one window and tells its views what changed. A {@link TabStrip} keeps the
 * order of the tabs, the active tab and the tabs that closed lately; a strip that knows groups
 * of tabs takes its place with the first group (`tab-groups.ts`), and one that keeps a strip
 * for each workspace with the window's second workspace (`workspace-strips.ts`). Then `all`,
 * `active` and the other reads without a tab are those of the workspace that the window shows,
 * the operations on a tab reach it in any workspace, and only the shown workspace's tabs show.
 * A window always keeps at least one tab in the workspace that it shows. Tab ids are unique
 * across the workspaces of a window.
 */
export class TabService implements Disposable {
  /** The tabs of the window. */
  private tabStrip: TabStrip<Tab>;
  private nextId = 1;
  private readonly changeEmitter = new Emitter<void>();
  private readonly views: TabViewPort;
  private readonly blankUrl: string;
  /** Called instead of opening a new tab when the last tab closes, such as by a popup. */
  private readonly onLastClosed: (() => void) | undefined;

  /** Fires after any tab or the active tab changed. */
  readonly onDidChange: Event<void> = this.changeEmitter.event;
  private readonly keptEmitter = new Emitter<KeptChange>();
  /**
   * Fires after a change that a session keeps: tabs that open, close, move, are pinned, sleep
   * or wake, the active tab, and the address and the title of a page.
   */
  readonly onDidChangeKept: Event<KeptChange> = this.keptEmitter.event;

  /**
   * @param views - Creates and controls the web views.
   * @param blankUrl - URL of a new, empty tab.
   * @param onLastClosed - Called instead of opening a new tab when the last tab closes.
   * @param workspace - The workspace that the window shows first.
   */
  constructor(views: TabViewPort, blankUrl: string, onLastClosed?: () => void, workspace?: string) {
    this.views = views;
    this.blankUrl = blankUrl;
    this.onLastClosed = onLastClosed;
    this.tabStrip = new TabStrip(workspace);
  }

  /** The tabs of the workspace that the window shows, in display order. */
  get all(): readonly Tab[] {
    return this.strip.all;
  }

  /**
   * The tabs of each workspace of the window, in the order of the workspaces: the workspace, its
   * tabs, its active tab and its split views.
   */
  get strips(): readonly WorkspaceTabs<Tab>[] {
    return this.strip.strips;
  }

  /** The tabs of every workspace of the window, workspace by workspace. */
  get allTabs(): readonly Tab[] {
    return this.strips.flatMap((strip) => strip.all);
  }

  /** The workspace that the window shows. */
  get workspace(): string {
    return this.strip.workspace;
  }

  /**
   * The workspace of a tab of the window.
   * @param id - The tab.
   * @returns The workspace, or `undefined` for a tab that the window does not have.
   */
  workspaceOf(id: TabId): string | undefined {
    return this.strips.find((strip) => strip.has(id))?.workspace;
  }

  /**
   * A tab of the window, in any of its workspaces.
   * @param id - The tab.
   */
  get(id: TabId): Tab | undefined {
    return this.strip.get(id);
  }

  /** The active tab, if any. */
  get active(): Tab | undefined {
    return this.strip.active;
  }

  /**
   * The tabs whose pages the content area shows, from left to right: the active tab, and the
   * other tab of its split view.
   */
  get shown(): readonly TabId[] {
    return this.strip.shown;
  }

  /** The pairs of tabs that the window shows side by side, in the order of the tabs. */
  get splits(): readonly SplitPair[] {
    return this.strip.splits;
  }

  /**
   * The split view that a tab is a side of.
   * @param id - The tab.
   * @returns The pair, or `undefined` when the tab is in none.
   */
  splitOf(id: TabId): SplitPair | undefined {
    return this.stripOf(id)?.splitOf(id);
  }

  /**
   * Shows a tab beside another one in a split view: the tab that is added moves next to the
   * one that stays, on the right, or in the place of the other tab of its split view, which
   * stays open next to the pair.
   * @param keep - The tab that stays where it is.
   * @param add - The tab that joins it.
   * @param ratio - The share of the width of the left side of a new split view.
   * @returns Whether the pair formed; pinned tabs are never in one.
   */
  split(keep: TabId, add: TabId, ratio?: number): boolean {
    const strip = this.require(keep);
    const before = [strip.splitOf(keep), strip.splitOf(add)];
    if (!strip.split(keep, add, ratio)) return false;
    this.pairChanged(...before, strip.splitOf(keep));
    return true;
  }

  /**
   * Ends the split view that a tab is a side of; both tabs stay open.
   * @param id - The tab.
   */
  unsplit(id: TabId): void {
    const strip = this.require(id);
    const pair = strip.splitOf(id);
    if (strip.unsplit(id)) this.pairChanged(pair);
  }

  /**
   * Swaps the sides of the split view that a tab is a side of; each page keeps its width.
   * @param id - The tab.
   */
  swapSplit(id: TabId): void {
    const strip = this.require(id);
    if (strip.swapSplit(id)) this.pairChanged(strip.splitOf(id));
  }

  /**
   * Gives the left side of the split view that a tab is a side of another share of the width,
   * from 0.2 to 0.8.
   * @param id - The tab.
   * @param ratio - The share.
   */
  resizeSplit(id: TabId, ratio: number): void {
    const strip = this.require(id);
    if (strip.resizeSplit(id, ratio)) this.pairChanged(strip.splitOf(id));
  }

  /**
   * The tabs that the strip lists, in their order, which the shortcuts that go to the next
   * tab or to a tab by its place count: all tabs.
   */
  get listed(): readonly Tab[] {
    return this.strip.listed;
  }

  /**
   * The tabs that move together with a tab, in their order: the two tabs of its split view, or
   * the tab alone.
   * @param id - The tab.
   * @returns The tabs, or none for a tab that the window does not have.
   */
  unitOf(id: TabId): readonly TabId[] {
    return this.stripOf(id)?.unitOf(id) ?? [];
  }

  /**
   * Opens a tab after the active one, or in the background after the tabs opened there
   * before it, as Chromium does; never between the two tabs of a split view.
   * @param url - URL to load; defaults to the blank page.
   * @param options - Whether to activate the tab.
   * @returns The new tab's id.
   */
  open(url: string = this.blankUrl, options: OpenTabOptions = {}): TabId {
    const id = `t${(this.nextId++).toString(36)}`;
    const lazy = options.lazy === true;
    // A tab without a view knows its moves from its history alone.
    const moves = options.history === undefined ? undefined : historyMoves(options.history);
    const tab: Tab = {
      id,
      url,
      title: options.title ?? '',
      loading: !lazy,
      canGoBack: moves?.back ?? false,
      canGoForward: moves?.forward ?? false,
      blocked: 0,
      problem: null,
      zoom: 1,
      favicon: null,
      audible: false,
      muted: false,
      pinned: options.pinned === true,
      sleeping: lazy,
      group: null,
      reader: 'none',
      pictureInPicture: 'none',
    };
    const activate = options.activate ?? true;
    if (options.after !== undefined) this.require(options.after);
    this.strip.insert(tab, { ...options, activate });
    this.views.create(id, url, lazy, options.history);
    if (activate) {
      this.activate(id);
    } else {
      this.changed(keptChange);
    }
    return id;
  }

  /**
   * Makes a tab the active tab.
   * @param id - The tab.
   */
  activate(id: TabId): void {
    const strip = this.require(id);
    if (strip.activate(id)) {
      this.views.show(id, strip.splitOf(id));
    }
    this.changed(keptChange);
  }

  /**
   * Closes a tab. Closing the active tab activates the other tab of its split view, or its
   * right neighbour, or the left one at the end; the split view ends with either of its tabs.
   * Closing the last tab opens a blank tab, or closes the window when it closes with its last
   * tab, as popups and private windows do.
   * @param id - The tab.
   */
  close(id: TabId): void {
    const strip = this.require(id);
    // The tab can open again with its history, which goes with its view.
    const history = this.historyOf(id);
    this.edit(() => {
      const closed = strip.close(id, true, history);
      if (closed?.next !== undefined) strip.activate(closed.next.id);
      return closed === undefined ? [] : [closed.tab];
    });
  }

  /**
   * Changes the strip in a way of its own, such as the groups of tabs do, and tells the views
   * and the session: the tabs that left the strip lose their views, the content area shows the
   * tabs that the strip shows now, and a window that the change left without an active tab gets
   * a new tab, or closes when it has no tabs left and closes with its last tab, as popups and
   * private windows do.
   * @param change - Changes the strip, and gives the tabs that left it.
   */
  edit(change: (strip: TabStrip<Tab>) => readonly Tab[] | void): void {
    const shown = this.shown.join();
    for (const tab of change(this.strip) ?? []) this.views.destroy(tab.id);
    const active = this.active;
    if (active === undefined && shown !== '') {
      if (this.all.length > 0 || this.onLastClosed === undefined) this.open();
      else {
        this.changed(keptChange);
        this.onLastClosed();
      }
      return;
    }
    if (active !== undefined && this.shown.join() !== shown) {
      this.views.show(active.id, this.strip.splitOf(active.id));
    }
    this.changed(keptChange);
  }

  /**
   * Lets another kind of strip keep the tabs of the window, such as one that knows groups of
   * tabs, which load with their first use; it takes over the tabs of the strip before.
   * @param make - Makes the new strip from the one before.
   */
  useStrip(make: (strip: TabStrip<Tab>) => TabStrip<Tab>): void {
    this.tabStrip = make(this.tabStrip);
  }

  /**
   * Moves a tab, with the other tab of its split view, to another place in the order of the
   * tabs. Pinned tabs stay among the pinned tabs, the others after them, and nothing comes
   * between the two tabs of a split view.
   * @param id - The tab.
   * @param index - The new index of the first tab of its unit, counted without the unit;
   *   clamped to the tabs.
   */
  move(id: TabId, index: number): void {
    this.require(id).move(id, index);
    this.changed(keptChange);
  }

  /**
   * Moves a tab, with the tabs that move together with it, past the tab or the tabs next to
   * it, as the keyboard moves the active tab. Pinned tabs stay among the pinned tabs, the
   * others after them.
   * @param id - The tab.
   * @param direction - -1 toward the start of the strip, 1 toward its end.
   * @returns Whether the tab moved; it does not at the end of its tabs.
   */
  step(id: TabId, direction: -1 | 1): boolean {
    if (!this.require(id).step(id, direction)) return false;
    this.changed(keptChange);
    return true;
  }

  /**
   * Pins a tab, which moves it to the end of the pinned tabs and ends its split view, or unpins
   * it, which moves it right after them.
   * @param id - The tab.
   * @param pinned - Whether the tab is pinned.
   */
  pin(id: TabId, pinned: boolean): void {
    const strip = this.require(id);
    const pair = strip.splitOf(id);
    strip.pin(id, pinned);
    if (pair !== undefined && strip.splitOf(id) === undefined) this.pairChanged(pair);
    else this.changed(keptChange);
  }

  /**
   * The back and forward history of a tab with what its pages hold now, as it closes, which the
   * strip keeps within the limits of a session: at most 128 KiB of page states for each of the
   * tabs that can open again.
   * @param id - The tab.
   */
  historyOf(id: TabId): TabHistory | undefined {
    const history = this.views.historyOf?.(id, true);
    return history === undefined ? undefined : trimHistory(history, sessionLimits);
  }

  /** Whether a closed tab can be opened again. */
  get canReopen(): boolean {
    return this.strip.canReopen;
  }

  /**
   * Reopens the most recently closed tab, or the tabs of the group that closed last.
   * @returns The reopened tab's id, or `undefined` if nothing was closed.
   */
  reopenClosed(): TabId | undefined {
    return this.strip.reopenWith((url, place) => this.open(url, place));
  }

  /**
   * Loads a URL in a tab.
   * @param id - The tab.
   * @param url - The URL.
   */
  navigate(id: TabId, url: string): void {
    this.require(id);
    this.views.load(id, url);
  }

  /**
   * Runs a history or loading action in a tab.
   * @param id - The tab.
   * @param action - What to do.
   */
  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    this.require(id);
    this.views.run(id, action);
  }

  /**
   * Puts a tab to sleep: its view closes, and the tab loads again with its history once it is
   * shown. A tab that the window shows stays awake.
   * @param id - The tab.
   * @param mode - Whether people asked for it, or the tab was not used for a while.
   * @returns Whether the tab goes to sleep; not for a tab that shows, that the window does not
   *   have, or whose page is busy.
   */
  sleep(id: TabId, mode: SleepMode = 'manual'): boolean {
    if (this.stripOf(id) === undefined || this.shown.includes(id)) return false;
    return this.views.sleep(id, mode);
  }

  /**
   * Applies state reported by the web view, such as a new title.
   * @param id - The tab.
   * @param update - Changed fields.
   */
  update(id: TabId, update: TabUpdate): void {
    const strip = this.stripOf(id);
    const current = strip?.get(id);
    if (strip === undefined || current === undefined) {
      return;
    }
    const next = { ...current, ...update };
    const differs = (field: (typeof tabFields)[number]): boolean =>
      update[field] !== undefined && update[field] !== current[field];
    if (tabFields.some(differs)) {
      strip.replace(next);
      // A count of blocked requests or a page that loads changes nothing that a session keeps.
      const kept = keptFields.filter(differs);
      this.changed(
        kept.length === 0
          ? undefined
          : kept.every((field) => field === 'title')
            ? titleChange
            : keptChange,
      );
    }
  }

  /**
   * Tells the views and the session that split views changed: when the active tab was or is a
   * side of one of them, the content area shows it anew.
   * @param pairs - The pairs before and after the change.
   */
  private pairChanged(...pairs: readonly (SplitPair | undefined)[]): void {
    const active = this.active;
    if (
      active !== undefined &&
      pairs.some((pair) => pair?.start === active.id || pair?.end === active.id)
    ) {
      this.views.show(active.id, this.strip.splitOf(active.id));
    }
    this.changed(keptChange);
  }

  private changed(kept: KeptChange | undefined): void {
    this.changeEmitter.fire();
    if (kept !== undefined) this.keptEmitter.fire(kept);
  }

  /** Destroys every view and removes listeners. */
  dispose(): void {
    for (const tab of this.strip.clear()) {
      this.views.destroy(tab.id);
    }
    this.changeEmitter.dispose();
    this.keptEmitter.dispose();
  }

  /** The strip of tabs that the window shows. */
  private get strip(): TabStrip<Tab> {
    return this.tabStrip;
  }

  /**
   * The strip that holds a tab.
   * @param id - The tab.
   * @returns The strip, or `undefined` when the window has no such tab.
   */
  private stripOf(id: TabId): TabStrip<Tab> | undefined {
    return this.tabStrip.has(id) ? this.tabStrip : undefined;
  }

  /**
   * The strip that holds a tab, which must be one of the window's.
   * @param id - The tab.
   * @throws When the window has no such tab.
   */
  private require(id: TabId): TabStrip<Tab> {
    const strip = this.stripOf(id);
    if (strip === undefined) {
      throw new Error(`Unknown tab ${id}`);
    }
    return strip;
  }
}
