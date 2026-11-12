/** How many closed tabs can be reopened. */
const closedTabLimit = 25;

/** What a tab strip needs to know of a tab. */
export interface StripTab {
  readonly id: string;
  /** The address of the tab's page, which the strip keeps after the tab closed. */
  readonly url: string;
  /** Whether the tab is pinned: pinned tabs come first. */
  readonly pinned: boolean;
}

/** A tab that left a strip, and the tab that becomes active in its place. */
export interface ClosedTab<T> {
  readonly tab: T;
  /** Whether the tab was the active tab, which leaves the strip without one. */
  readonly active: boolean;
  /**
   * The tab to activate in place of the active tab: its right neighbour, or the left one at
   * the end; `undefined` when the tab was not active or no tab is left.
   */
  readonly next: T | undefined;
}

/**
 * The tabs of a window in their order, its active tab and the tabs that closed lately. Pinned
 * tabs come first. Tabs move in units: a tab and the tabs that move with it, which is the tab
 * alone for now. The strip knows of a tab only what {@link StripTab} names, and `TabService`
 * tells the views of the window what changed.
 */
export class TabStrip<T extends StripTab> {
  private readonly tabs: T[] = [];
  private activeId: string | undefined;
  /** Tabs opened in the background since the active tab became active. */
  private readonly openedInBackground = new Set<string>();
  /** The addresses of the tabs that closed, the most recent last. */
  private readonly closed: string[] = [];

  /** All tabs in display order. */
  get all(): readonly T[] {
    return this.tabs;
  }

  /** The active tab, if any. */
  get active(): T | undefined {
    return this.activeId === undefined ? undefined : this.get(this.activeId);
  }

  /** The tabs whose pages the content area of the window shows: the active tab. */
  get shown(): readonly string[] {
    return this.activeId === undefined ? [] : [this.activeId];
  }

  /**
   * The tabs that the strip lists, in their order, which the shortcuts that go to the next
   * tab or to a tab by its place count: all tabs.
   */
  get listed(): readonly T[] {
    return this.tabs;
  }

  /** How many tabs are pinned; they are the first tabs. */
  get pinnedCount(): number {
    const index = this.tabs.findIndex((tab) => !tab.pinned);
    return index === -1 ? this.tabs.length : index;
  }

  /** Whether a closed tab can be opened again. */
  get canReopen(): boolean {
    return this.closed.length > 0;
  }

  /**
   * A tab of the strip.
   * @param id - The tab.
   */
  get(id: string): T | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  /**
   * Whether a tab is in the strip.
   * @param id - The tab.
   */
  has(id: string): boolean {
    return this.indexOf(id) !== -1;
  }

  /**
   * The place of a tab in the strip.
   * @param id - The tab.
   * @returns Its index, or -1 when the tab is not in the strip.
   */
  indexOf(id: string): number {
    return this.tabs.findIndex((tab) => tab.id === id);
  }

  /**
   * The tabs that move together with a tab, in their order: the tab alone.
   * @param id - The tab.
   * @returns The tabs, or none when the tab is not in the strip.
   */
  unitOf(id: string): readonly string[] {
    return this.has(id) ? [id] : [];
  }

  /**
   * Puts a new tab in its place: a pinned tab at the end of the pinned tabs, another tab
   * after a given tab or after the active one. Tabs opened in the background line up after
   * the active tab in the order they open, until another tab becomes active, as in Chromium.
   * @param tab - The new tab.
   * @param options - Whether the tab becomes the active tab right after, and the tab of the
   *   strip that it follows instead of the active tab.
   */
  insert(
    tab: T,
    options: { readonly activate: boolean; readonly after?: string | undefined },
  ): void {
    const { activate, after } = options;
    const index = tab.pinned
      ? this.pinnedCount
      : after === undefined
        ? this.insertionIndex(activate)
        : this.indexOf(after) + 1;
    this.tabs.splice(Math.max(index, tab.pinned ? 0 : this.pinnedCount), 0, tab);
    if (!activate) this.openedInBackground.add(tab.id);
  }

  /**
   * Makes a tab of the strip the active tab.
   * @param id - The tab.
   * @returns Whether the active tab changed.
   */
  activate(id: string): boolean {
    if (this.activeId === id) return false;
    this.activeId = id;
    this.openedInBackground.clear();
    return true;
  }

  /**
   * Takes a tab out of the strip and keeps its address, so that it can be opened again.
   * @param id - The tab.
   * @returns The tab, and the one to activate in its place, or `undefined` when the tab is
   *   not in the strip.
   */
  close(id: string): ClosedTab<T> | undefined {
    const index = this.indexOf(id);
    const [tab] = index === -1 ? [] : this.tabs.splice(index, 1);
    if (tab === undefined) return undefined;
    this.closed.push(tab.url);
    if (this.closed.length > closedTabLimit) {
      this.closed.shift();
    }
    this.openedInBackground.delete(id);
    if (this.activeId !== id) return { tab, active: false, next: undefined };
    this.activeId = undefined;
    return { tab, active: true, next: this.tabs[index] ?? this.tabs[index - 1] };
  }

  /**
   * The address of the tab that closed last, which leaves the list of closed tabs.
   * @returns The address, or `undefined` when no tab closed.
   */
  reopen(): string | undefined {
    return this.closed.pop();
  }

  /**
   * Moves a tab to another place in the order of the tabs. Pinned tabs stay among the pinned
   * tabs, the others after them.
   * @param id - The tab.
   * @param index - Its new index, counted without the tab itself; clamped to the tabs.
   */
  move(id: string, index: number): void {
    const from = this.indexOf(id);
    const [tab] = from === -1 ? [] : this.tabs.splice(from, 1);
    if (tab === undefined) return;
    const pinned = this.pinnedCount;
    const [first, last] = tab.pinned ? [0, pinned] : [pinned, this.tabs.length];
    this.tabs.splice(Math.max(first, Math.min(index, last)), 0, tab);
  }

  /**
   * Moves the unit of a tab past the unit next to it, toward the start or the end of the
   * strip. A unit stays among the pinned tabs, or after them.
   * @param id - The tab.
   * @param direction - -1 toward the start, 1 toward the end.
   * @returns Whether the unit moved; it does not at the end of its tabs.
   */
  step(id: string, direction: -1 | 1): boolean {
    const unit = this.unitOf(id);
    const first = this.tabs.findIndex((tab) => tab.id === unit[0]);
    const head = this.tabs[first];
    if (head === undefined) return false;
    const end = first + unit.length;
    const pinned = this.pinnedCount;
    const [low, high] = head.pinned ? [0, pinned] : [pinned, this.tabs.length];
    const neighbour = direction < 0 ? this.tabs[first - 1] : this.tabs[end];
    if (neighbour === undefined || (direction < 0 ? first - 1 < low : end >= high)) return false;
    const passed = this.unitOf(neighbour.id).length;
    const moving = this.tabs.splice(first, unit.length);
    this.tabs.splice(direction < 0 ? first - passed : first + passed, 0, ...moving);
    return true;
  }

  /**
   * Pins a tab, which moves it to the end of the pinned tabs, or unpins it, which moves it
   * right after them.
   * @param id - The tab.
   * @param pinned - Whether the tab is pinned.
   */
  pin(id: string, pinned: boolean): void {
    const from = this.indexOf(id);
    const [tab] = from === -1 ? [] : this.tabs.splice(from, 1);
    if (tab === undefined) return;
    this.tabs.splice(this.pinnedCount, 0, { ...tab, pinned });
  }

  /**
   * Puts a newer state of a tab in the place of the tab with its id.
   * @param tab - The tab.
   */
  replace(tab: T): void {
    const index = this.indexOf(tab.id);
    if (index !== -1) this.tabs[index] = tab;
  }

  /**
   * Takes every tab out of the strip, without keeping them as closed tabs.
   * @returns The tabs, in their order.
   */
  clear(): T[] {
    this.activeId = undefined;
    this.openedInBackground.clear();
    return this.tabs.splice(0);
  }

  /** Where a new tab goes: after the active tab and, in the background, its earlier tabs. */
  private insertionIndex(activate: boolean): number {
    if (this.activeId === undefined) {
      return this.tabs.length;
    }
    // A tab that is not pinned goes after the pinned tabs, also when a pinned tab is active,
    // so the tabs opened in the background before it come first.
    const next = Math.max(this.indexOf(this.activeId) + 1, this.pinnedCount);
    if (activate) {
      return next;
    }
    const end = this.tabs.findIndex(
      (tab, index) => index >= next && !this.openedInBackground.has(tab.id),
    );
    return end === -1 ? this.tabs.length : end;
  }
}
