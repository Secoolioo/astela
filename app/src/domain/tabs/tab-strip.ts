import { clampRatio, splitRatio } from '../../shared/split-view.ts';
import type { Swatch } from '../../shared/swatches.ts';
import { defaultWorkspaceId } from '../../shared/workspaces.ts';
import type { TabHistory } from './view-history.ts';

/** How many closed tabs can be reopened. */
export const closedTabLimit = 25;

/**
 * A tab that closed, as a strip keeps it to open it again: its address and its back and forward
 * history, with what its pages held, such as typed text, within the limits of a session
 * (`TabService.historyOf`). It stays in memory with its window.
 */
export interface KeptTab {
  readonly url: string;
  history: TabHistory | undefined;
}

/** What a tab strip needs to know of a tab. */
export interface StripTab {
  readonly id: string;
  /** The address of the tab's page, which the strip keeps after the tab closed. */
  readonly url: string;
  /** Whether the tab is pinned: pinned tabs come first. */
  readonly pinned: boolean;
}

/**
 * Two neighbouring tabs that the window shows side by side in a split view. `start` is the
 * left side and comes right before `end` in the strip; `ratio` is the share of the width that
 * the left side takes, from 0.2 to 0.8. Pinned tabs are never in a pair, and a tab is in one
 * pair at most.
 */
export interface SplitPair {
  readonly start: string;
  readonly end: string;
  readonly ratio: number;
}

/**
 * A group of neighbouring tabs: its id, unique in its window, such as `g1`, its name, which may
 * be empty, its color, and whether its tabs are hidden behind its chip. Each tab of a group
 * carries the group; a strip without groups has none.
 */
export interface TabGroup {
  readonly id: string;
  readonly name: string;
  readonly color: Swatch;
  readonly collapsed: boolean;
}

/**
 * Where a new tab goes, and whether it becomes the active tab. A strip without groups looks at
 * `activate` and `after`; a strip that knows groups also at the tab whose page opened the tab
 * and at the group that the tab joins.
 */
export interface StripPlace {
  readonly activate: boolean;
  /** The tab that the new tab follows instead of the active one. */
  readonly after?: string | undefined;
  /** The tab whose page opened the new tab, such as with a link. */
  readonly opener?: string | undefined;
  /** The group that the new tab joins. */
  readonly group?: TabGroup | undefined;
}

/** How a tab that closed opens again: its place and whether it loads at once. */
export interface ReopenPlace {
  readonly activate?: boolean;
  /** Whether the tab loads only once it is shown. */
  readonly lazy?: boolean;
  /** The title that the tab shows until its page loads. */
  readonly title?: string;
  /** The group that the tab joins. */
  readonly group?: TabGroup;
  /** The back and forward history that the tab had, with what its pages held. */
  readonly history?: TabHistory | undefined;
}

/**
 * The tabs of a workspace of a window as those outside the tab model read them: the workspace,
 * its tabs in their order, its active tab and its split views.
 */
export type WorkspaceTabs<T extends StripTab> = Readonly<
  Pick<TabStrip<T>, 'workspace' | 'all' | 'active' | 'splits' | 'has'>
>;

/** A tab that left a strip, and the tab that becomes active in its place. */
export interface ClosedTab<T> {
  readonly tab: T;
  /** Whether the tab was the active tab, which leaves the strip without one. */
  readonly active: boolean;
  /**
   * The tab to activate in place of the active tab: the other tab of its split view, or its
   * right neighbour, or the left one at the end; `undefined` when the tab was not active or no
   * tab is left.
   */
  readonly next: T | undefined;
  /** The split view that the tab was a side of, which ended with it. */
  readonly pair: SplitPair | undefined;
}

/**
 * The tabs of a window in their order, its active tab, the pairs of tabs that it shows side by
 * side and the tabs that closed lately. Pinned tabs come first. Tabs move in units: a tab
 * alone, or the two tabs of a pair, which nothing comes between. The strip knows of a tab only
 * what {@link StripTab} names, and `TabService` tells the views of the window what changed.
 * Groups of tabs follow the rules of `GroupedTabStrip` in `tab-groups.ts`, which takes the
 * place of this strip with the first group, so that a window without groups never loads them.
 * The strip holds the tabs of one workspace; a window with several workspaces gets a strip for
 * each of them in `WorkspaceStrips` of `workspace-strips.ts`, which takes the place of this
 * strip with the window's second workspace.
 */
export class TabStrip<T extends StripTab> {
  /**
   * The workspace whose tabs the strip holds; for the strips of several workspaces, the one
   * that the window shows.
   */
  workspace: string;
  protected readonly tabs: T[] = [];
  protected activeId: string | undefined;
  /** The pairs of tabs that the window shows side by side. */
  protected pairs: SplitPair[] = [];
  /** Tabs opened in the background since the active tab became active. */
  protected readonly openedInBackground = new Set<string>();
  /** The tabs that closed, the most recent last. */
  protected readonly closed: KeptTab[] = [];

  /** @param workspace - The workspace whose tabs the strip holds. */
  constructor(workspace: string = defaultWorkspaceId) {
    this.workspace = workspace;
  }

  /** All tabs in display order. */
  get all(): readonly T[] {
    return this.tabs;
  }

  /** The strips of the workspaces that this strip holds, in their order: this strip alone. */
  get strips(): readonly WorkspaceTabs<T>[] {
    return [this];
  }

  /**
   * Lets another kind of strip take the place of the strip of the tabs that the window shows,
   * such as one with groups: of this strip, or of the shown strip among those of several
   * workspaces.
   * @param make - Makes the new strip from the shown one.
   * @returns The strip that the window keeps.
   */
  withShown(make: (strip: TabStrip<T>) => TabStrip<T>): TabStrip<T> {
    return make(this);
  }

  /** The active tab, if any. */
  get active(): T | undefined {
    return this.activeId === undefined ? undefined : this.get(this.activeId);
  }

  /**
   * The tabs whose pages the content area of the window shows, from left to right: the active
   * tab, and the other tab of its split view.
   */
  get shown(): readonly string[] {
    return this.activeId === undefined ? [] : this.unitOf(this.activeId);
  }

  /** The pairs of tabs that the window shows side by side, in the order of the strip. */
  get splits(): readonly SplitPair[] {
    return this.pairs.toSorted((a, b) => this.indexOf(a.start) - this.indexOf(b.start));
  }

  /**
   * The split view that a tab is a side of.
   * @param id - The tab.
   * @returns The pair, or `undefined` when the tab is in none.
   */
  splitOf(id: string): SplitPair | undefined {
    return this.pairs.find((pair) => pair.start === id || pair.end === id);
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
   * The tabs that move together with a tab, in their order: the two tabs of its split view,
   * or the tab alone.
   * @param id - The tab.
   * @returns The tabs, or none when the tab is not in the strip.
   */
  unitOf(id: string): readonly string[] {
    if (!this.has(id)) return [];
    const pair = this.splitOf(id);
    return pair === undefined ? [id] : [pair.start, pair.end];
  }

  /**
   * Shows a tab beside another one in a split view. The tab that is added leaves a split view
   * that it was a side of and moves next to the tab that stays, which keeps its place. Without
   * a split view, it goes on the right. When the tab that stays has a partner already, the new
   * tab takes the partner's side and share, and the partner stays open next to the pair.
   * @param keep - The tab that stays where it is.
   * @param add - The tab that joins it.
   * @param ratio - The share of the left side of a new split view.
   * @returns Whether the pair formed; not for a pinned tab, a tab with itself or a tab that the
   *   strip does not have.
   */
  split(keep: string, add: string, ratio: number = splitRatio.even): boolean {
    const kept = this.get(keep);
    const added = this.get(add);
    if (keep === add || kept === undefined || added === undefined) return false;
    if (kept.pinned || added.pinned) return false;
    const before = this.splitOf(keep);
    // Two tabs that are a pair already stay as they are.
    if (before !== undefined && before === this.splitOf(add)) return false;
    this.pairs = this.pairs.filter((pair) => pair.start !== add && pair.end !== add);
    // The tab that joins leaves its place, and the tab that stays keeps its own.
    this.tabs.splice(this.indexOf(add), 1);
    const place = this.indexOf(keep);
    if (before === undefined) {
      this.tabs.splice(place + 1, 0, added);
      this.pairs.push({ start: keep, end: add, ratio: clampRatio(ratio) });
      return true;
    }
    this.pairs = this.pairs.filter((pair) => pair !== before);
    // The new tab takes the side of the partner, which stays open beside the pair.
    if (before.start === keep) {
      this.tabs.splice(place + 1, 0, added);
      this.pairs.push({ start: keep, end: add, ratio: before.ratio });
    } else {
      this.tabs.splice(place, 0, added);
      this.pairs.push({ start: add, end: keep, ratio: before.ratio });
    }
    return true;
  }

  /**
   * Ends the split view that a tab is a side of; both tabs stay where they are.
   * @param id - The tab.
   * @returns Whether a split view ended.
   */
  unsplit(id: string): boolean {
    const pair = this.splitOf(id);
    if (pair === undefined) return false;
    this.pairs = this.pairs.filter((other) => other !== pair);
    return true;
  }

  /**
   * Swaps the sides of the split view that a tab is a side of: the two tabs change their
   * places, and each page keeps its width.
   * @param id - The tab.
   * @returns Whether the sides changed.
   */
  swapSplit(id: string): boolean {
    const pair = this.splitOf(id);
    if (pair === undefined) return false;
    const place = this.indexOf(pair.start);
    const [start, end] = this.tabs.slice(place, place + 2);
    if (start === undefined || end === undefined) return false;
    this.tabs.splice(place, 2, end, start);
    this.replacePair(pair, { start: pair.end, end: pair.start, ratio: clampRatio(1 - pair.ratio) });
    return true;
  }

  /**
   * Gives the left side of the split view that a tab is a side of another share of the width.
   * @param id - The tab.
   * @param ratio - The share, which stays within its limits.
   * @returns Whether the share changed.
   */
  resizeSplit(id: string, ratio: number): boolean {
    const pair = this.splitOf(id);
    const next = clampRatio(ratio);
    if (pair === undefined || pair.ratio === next) return false;
    this.replacePair(pair, { ...pair, ratio: next });
    return true;
  }

  /**
   * Puts a new tab in its place: a pinned tab at the end of the pinned tabs, another tab
   * after a given tab or after the active one. Tabs opened in the background line up after
   * the active tab in the order they open, until another tab becomes active, as in Chromium.
   * @param tab - The new tab.
   * @param options - Whether the tab becomes the active tab right after, and the tab of the
   *   strip that it follows instead of the active tab.
   */
  insert(tab: T, options: StripPlace): void {
    const { activate, after } = options;
    // A new tab never comes between the two tabs of a split view: it follows the pair.
    const index = tab.pinned
      ? this.pinnedCount
      : after === undefined
        ? this.insertionIndex(activate)
        : this.endOfUnit(after);
    const place = Math.max(index, tab.pinned ? 0 : this.pinnedCount);
    this.tabs.splice(tab.pinned ? place : this.outsidePairs(place), 0, tab);
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
   * Takes a tab out of the strip and keeps its address and its history, so that it can be opened
   * again as it was.
   * @param id - The tab.
   * @param keep - Whether the tab can be opened again; not for a tab that moves elsewhere.
   * @param history - The history of the tab as it closes.
   * @returns The tab, and the one to activate in its place, or `undefined` when the tab is
   *   not in the strip.
   */
  close(id: string, keep = true, history?: TabHistory): ClosedTab<T> | undefined {
    const index = this.indexOf(id);
    const [tab] = index === -1 ? [] : this.tabs.splice(index, 1);
    if (tab === undefined) return undefined;
    if (keep) this.closed.push({ url: tab.url, history });
    if (this.closed.length > closedTabLimit) {
      this.closed.shift();
    }
    this.openedInBackground.delete(id);
    // The split view ends with either of its tabs; the other one shows alone.
    const pair = this.splitOf(id);
    if (pair !== undefined) this.pairs = this.pairs.filter((other) => other !== pair);
    if (this.activeId !== id) return { tab, active: false, next: undefined, pair };
    this.activeId = undefined;
    const partner =
      pair === undefined ? undefined : this.get(pair.start === id ? pair.end : pair.start);
    return { tab, active: true, next: partner ?? this.tabs[index] ?? this.tabs[index - 1], pair };
  }

  /**
   * Opens the tab that closed last again, which leaves the list of closed tabs.
   * @param open - Opens a tab with an address in the place that it names, and gives its id.
   * @returns The id of the tab that opened, or `undefined` when no tab closed.
   */
  reopenWith(open: (url: string, place: ReopenPlace) => string): string | undefined {
    const kept = this.closed.pop();
    return kept === undefined ? undefined : open(kept.url, { history: kept.history });
  }

  /** Forgets the histories of the tabs that closed, as when the whole history is cleared. */
  forgetHistories(): void {
    for (const kept of this.closed) kept.history = undefined;
  }

  /**
   * Moves a tab, with the other tab of its split view, to another place in the order of the
   * tabs. Pinned tabs stay among the pinned tabs, the others after them, and a place between
   * the two tabs of another split view moves after that pair.
   * @param id - The tab.
   * @param index - The new index of the first tab of its unit, counted without the unit;
   *   clamped to the tabs.
   */
  move(id: string, index: number): void {
    const unit = this.unitOf(id);
    const from = this.indexOf(unit[0] ?? id);
    const moving = from === -1 ? [] : this.tabs.splice(from, unit.length);
    const [head] = moving;
    if (head === undefined) return;
    const pinned = this.pinnedCount;
    const [first, last] = head.pinned ? [0, pinned] : [pinned, this.tabs.length];
    const place = Math.max(first, Math.min(index, last));
    this.tabs.splice(head.pinned ? place : this.outsidePairs(place), 0, ...moving);
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
    // A pinned tab is never a side of a split view.
    if (pinned) this.unsplit(id);
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
    this.pairs = [];
    return this.tabs.splice(0);
  }

  /** Puts a newer state of a pair in the place of the pair. */
  protected replacePair(pair: SplitPair, next: SplitPair): void {
    this.pairs = this.pairs.map((other) => (other === pair ? next : other));
  }

  /** The index right after the unit of a tab, such as after both tabs of a split view. */
  protected endOfUnit(id: string): number {
    const unit = this.unitOf(id);
    return this.indexOf(unit.at(-1) ?? id) + 1;
  }

  /**
   * A place in the strip that does not lie between the two tabs of a split view: a place
   * between them moves after the pair.
   * @param index - The place, as an index of the tabs.
   */
  protected outsidePairs(index: number): number {
    const before = this.tabs[index - 1];
    return before !== undefined && this.splitOf(before.id)?.start === before.id ? index + 1 : index;
  }

  /** Where a new tab goes: after the active tab and, in the background, its earlier tabs. */
  protected insertionIndex(activate: boolean): number {
    if (this.activeId === undefined) {
      return this.tabs.length;
    }
    // A tab that is not pinned goes after the pinned tabs, also when a pinned tab is active,
    // so the tabs opened in the background before it come first. The active tab counts with
    // the other tab of its split view.
    const next = Math.max(this.endOfUnit(this.activeId), this.pinnedCount);
    if (activate) {
      return next;
    }
    const end = this.tabs.findIndex(
      (tab, index) => index >= next && !this.openedInBackground.has(tab.id),
    );
    return end === -1 ? this.tabs.length : end;
  }
}
