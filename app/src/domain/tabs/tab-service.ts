import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import { TabStrip } from './tab-strip.ts';

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
}

/** Fields of a tab that the web view reports. */
export type TabUpdate = Partial<Omit<Tab, 'id'>>;

/**
 * Port to the web views of a window. The platform layer implements it with one
 * `WebContentsView` per tab; tests use a fake.
 */
export interface TabViewPort {
  /**
   * Creates the view of a tab and loads the URL. A lazy tab gets its view only when it is
   * shown, so restored tabs cost nothing until they are used.
   */
  create(id: TabId, url: string, lazy?: boolean): void;
  /** Shows the view of a tab and hides the previously shown one. */
  show(id: TabId): void;
  /** Destroys the view of a tab. */
  destroy(id: TabId): void;
  /** Loads a URL in a tab. */
  load(id: TabId, url: string): void;
  /** Runs a history or loading action. */
  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void;
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
  /** Opens the tab right after this tab instead of after the active one. */
  readonly after?: TabId;
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
] as const;

/** Fields of a tab that a session keeps. */
const keptFields = ['url', 'title', 'pinned'] as const;

/**
 * Owns the tabs of one window and tells its views what changed. A {@link TabStrip} keeps the
 * order of the tabs, the active tab and the tabs that closed lately. A window always keeps at
 * least one tab.
 */
export class TabService implements Disposable {
  /** The tabs of the window. */
  private readonly tabStrip = new TabStrip<Tab>();
  private nextId = 1;
  private readonly changeEmitter = new Emitter<void>();
  private readonly views: TabViewPort;
  private readonly blankUrl: string;
  /** Called instead of opening a new tab when the last tab closes, such as by a popup. */
  private readonly onLastClosed: (() => void) | undefined;

  /** Fires after any tab or the active tab changed. */
  readonly onDidChange: Event<void> = this.changeEmitter.event;
  private readonly keptEmitter = new Emitter<void>();
  /**
   * Fires after a change that a session keeps: tabs that open, close, move or are pinned, the
   * active tab, and the address and the title of a page.
   */
  readonly onDidChangeKept: Event<void> = this.keptEmitter.event;

  /**
   * @param views - Creates and controls the web views.
   * @param blankUrl - URL of a new, empty tab.
   * @param onLastClosed - Called instead of opening a new tab when the last tab closes.
   */
  constructor(views: TabViewPort, blankUrl: string, onLastClosed?: () => void) {
    this.views = views;
    this.blankUrl = blankUrl;
    this.onLastClosed = onLastClosed;
  }

  /** All tabs in display order. */
  get all(): readonly Tab[] {
    return this.strip.all;
  }

  /** The active tab, if any. */
  get active(): Tab | undefined {
    return this.strip.active;
  }

  /** The tabs whose pages the content area shows: the active tab. */
  get shown(): readonly TabId[] {
    return this.strip.shown;
  }

  /**
   * The tabs that the strip lists, in their order, which the shortcuts that go to the next
   * tab or to a tab by its place count: all tabs.
   */
  get listed(): readonly Tab[] {
    return this.strip.listed;
  }

  /**
   * The tabs that move together with a tab, in their order: the tab alone.
   * @param id - The tab.
   * @returns The tabs, or none for a tab that the window does not have.
   */
  unitOf(id: TabId): readonly TabId[] {
    return this.stripOf(id)?.unitOf(id) ?? [];
  }

  /**
   * Opens a tab after the active one, or in the background after the tabs opened there
   * before it, as Chromium does.
   * @param url - URL to load; defaults to the blank page.
   * @param options - Whether to activate the tab.
   * @returns The new tab's id.
   */
  open(url: string = this.blankUrl, options: OpenTabOptions = {}): TabId {
    const id = `t${(this.nextId++).toString(36)}`;
    const lazy = options.lazy === true;
    const tab: Tab = {
      id,
      url,
      title: options.title ?? '',
      loading: !lazy,
      canGoBack: false,
      canGoForward: false,
      blocked: 0,
      problem: null,
      zoom: 1,
      favicon: null,
      audible: false,
      muted: false,
      pinned: options.pinned === true,
    };
    const activate = options.activate ?? true;
    if (options.after !== undefined) this.require(options.after);
    this.strip.insert(tab, { activate, after: options.after });
    this.views.create(id, url, lazy);
    if (activate) {
      this.activate(id);
    } else {
      this.changed(true);
    }
    return id;
  }

  /**
   * Makes a tab the active tab.
   * @param id - The tab.
   */
  activate(id: TabId): void {
    if (this.require(id).activate(id)) {
      this.views.show(id);
    }
    this.changed(true);
  }

  /**
   * Closes a tab. Closing the active tab activates its right neighbour, or the left one
   * at the end. Closing the last tab opens a blank tab.
   * @param id - The tab.
   */
  close(id: TabId): void {
    const closed = this.require(id).close(id);
    if (closed === undefined) {
      return;
    }
    this.views.destroy(id);
    if (closed.active) {
      if (closed.next === undefined) {
        if (this.onLastClosed === undefined) this.open();
        else {
          this.changed(true);
          this.onLastClosed();
        }
        return;
      }
      this.activate(closed.next.id);
      return;
    }
    this.changed(true);
  }

  /**
   * Moves a tab to another place in the order of the tabs. Pinned tabs stay among the pinned
   * tabs, the others after them.
   * @param id - The tab.
   * @param index - Its new index, counted without the tab itself; clamped to the tabs.
   */
  move(id: TabId, index: number): void {
    this.require(id).move(id, index);
    this.changed(true);
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
    this.changed(true);
    return true;
  }

  /**
   * Pins a tab, which moves it to the end of the pinned tabs, or unpins it, which moves it
   * right after them.
   * @param id - The tab.
   * @param pinned - Whether the tab is pinned.
   */
  pin(id: TabId, pinned: boolean): void {
    this.require(id).pin(id, pinned);
    this.changed(true);
  }

  /** Whether a closed tab can be opened again. */
  get canReopen(): boolean {
    return this.strip.canReopen;
  }

  /**
   * Reopens the most recently closed tab.
   * @returns The reopened tab's id, or `undefined` if nothing was closed.
   */
  reopenClosed(): TabId | undefined {
    const url = this.strip.reopen();
    return url === undefined ? undefined : this.open(url);
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
      this.changed(keptFields.some(differs));
    }
  }

  private changed(kept: boolean): void {
    this.changeEmitter.fire();
    if (kept) this.keptEmitter.fire();
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
