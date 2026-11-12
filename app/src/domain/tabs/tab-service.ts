import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';

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
  /** The icon of the page as a `data:` address, or `null` while it has none. */
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

/** How many closed tabs can be reopened. */
const closedTabLimit = 25;

/**
 * Owns the tabs of one window: their order, the active tab and recently closed tabs. A
 * window always keeps at least one tab.
 */
export class TabService implements Disposable {
  private readonly tabs: Tab[] = [];
  private activeId: TabId | undefined;
  /** Tabs opened in the background since the active tab became active. */
  private readonly openedInBackground = new Set<TabId>();
  private readonly closed: string[] = [];
  private nextId = 1;
  private readonly changeEmitter = new Emitter<void>();
  private readonly views: TabViewPort;
  private readonly blankUrl: string;
  /** Called instead of opening a new tab when the last tab closes, such as by a popup. */
  private readonly onLastClosed: (() => void) | undefined;

  /** Fires after any tab or the active tab changed. */
  readonly onDidChange: Event<void> = this.changeEmitter.event;

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
    return this.tabs;
  }

  /** The active tab, if any. */
  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
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
    const index = tab.pinned
      ? this.pinnedCount
      : options.after === undefined
        ? this.insertionIndex(activate)
        : this.indexOf(options.after) + 1;
    this.tabs.splice(Math.max(index, tab.pinned ? 0 : this.pinnedCount), 0, tab);
    this.views.create(id, url, lazy);
    if (activate) {
      this.activate(id);
    } else {
      this.openedInBackground.add(id);
      this.changeEmitter.fire();
    }
    return id;
  }

  /**
   * Makes a tab the active tab.
   * @param id - The tab.
   */
  activate(id: TabId): void {
    this.require(id);
    if (this.activeId !== id) {
      this.activeId = id;
      this.openedInBackground.clear();
      this.views.show(id);
    }
    this.changeEmitter.fire();
  }

  /**
   * Closes a tab. Closing the active tab activates its right neighbour, or the left one
   * at the end. Closing the last tab opens a blank tab.
   * @param id - The tab.
   */
  close(id: TabId): void {
    const index = this.indexOf(id);
    const [tab] = this.tabs.splice(index, 1);
    if (tab === undefined) {
      return;
    }
    this.closed.push(tab.url);
    if (this.closed.length > closedTabLimit) {
      this.closed.shift();
    }
    this.views.destroy(id);
    if (this.activeId === id) {
      this.activeId = undefined;
      const next = this.tabs[index] ?? this.tabs[index - 1];
      if (next === undefined) {
        if (this.onLastClosed === undefined) this.open();
        else {
          this.changeEmitter.fire();
          this.onLastClosed();
        }
        return;
      }
      this.activate(next.id);
      return;
    }
    this.changeEmitter.fire();
  }

  /**
   * Moves a tab to another place in the order of the tabs.
   * @param id - The tab.
   * @param index - Its new index, counted without the tab itself; clamped to the tabs.
   */
  move(id: TabId, index: number): void {
    const [tab] = this.tabs.splice(this.indexOf(id), 1);
    if (tab === undefined) return;
    // Pinned tabs stay among the pinned tabs, the others after them.
    const pinned = this.pinnedCount;
    const [first, last] = tab.pinned ? [0, pinned] : [pinned, this.tabs.length];
    this.tabs.splice(Math.max(first, Math.min(index, last)), 0, tab);
    this.changeEmitter.fire();
  }

  /**
   * Pins a tab, which moves it to the end of the pinned tabs, or unpins it, which moves it
   * right after them.
   * @param id - The tab.
   * @param pinned - Whether the tab is pinned.
   */
  pin(id: TabId, pinned: boolean): void {
    const [tab] = this.tabs.splice(this.indexOf(id), 1);
    if (tab === undefined) return;
    this.tabs.splice(this.pinnedCount, 0, { ...tab, pinned });
    this.changeEmitter.fire();
  }

  /** How many tabs are pinned; they are the first tabs. */
  private get pinnedCount(): number {
    const index = this.tabs.findIndex((tab) => !tab.pinned);
    return index === -1 ? this.tabs.length : index;
  }

  /**
   * Reopens the most recently closed tab.
   * @returns The reopened tab's id, or `undefined` if nothing was closed.
   */
  reopenClosed(): TabId | undefined {
    const url = this.closed.pop();
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
    const index = this.tabs.findIndex((t) => t.id === id);
    const current = this.tabs[index];
    if (current === undefined) {
      return;
    }
    const next = { ...current, ...update };
    if (
      tabFields.some((field) => update[field] !== undefined && update[field] !== current[field])
    ) {
      this.tabs[index] = next;
      this.changeEmitter.fire();
    }
  }

  /** Destroys every view and removes listeners. */
  dispose(): void {
    for (const tab of this.tabs.splice(0)) {
      this.views.destroy(tab.id);
    }
    this.changeEmitter.dispose();
  }

  /** Where a new tab goes: after the active tab and, in the background, its earlier tabs. */
  private insertionIndex(activate: boolean): number {
    if (this.activeId === undefined) {
      return this.tabs.length;
    }
    const next = this.indexOf(this.activeId) + 1;
    if (activate) {
      return next;
    }
    const end = this.tabs.findIndex(
      (tab, index) => index >= next && !this.openedInBackground.has(tab.id),
    );
    return end === -1 ? this.tabs.length : end;
  }

  private indexOf(id: TabId): number {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Unknown tab ${id}`);
    }
    return index;
  }

  private require(id: TabId): void {
    this.indexOf(id);
  }
}
