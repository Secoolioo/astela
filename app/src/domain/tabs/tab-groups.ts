import { swatches, type Swatch } from '../../shared/swatches.ts';
import type { Tab, TabId, TabService } from './tab-service.ts';
import {
  closedTabLimit,
  TabStrip,
  type ClosedTab,
  type ReopenPlace,
  type StripPlace,
  type StripTab,
  type TabGroup,
} from './tab-strip.ts';

export type { TabGroup } from './tab-strip.ts';

/** The longest name of a group of tabs. */
export const groupNameLimit = 50;

/** A tab of a strip with groups: it carries its group, and a title to reopen it with. */
export interface GroupedTab extends StripTab {
  readonly title: string;
  readonly group: TabGroup | null;
}

/** What a strip with groups keeps of a tab, or of a whole group, that closed. */
type ClosedEntry =
  | {
      readonly kind: 'tab';
      readonly url: string;
      readonly group: TabGroup | null;
    }
  | {
      readonly kind: 'group';
      readonly group: TabGroup;
      readonly tabs: readonly { readonly url: string; readonly title: string }[];
    };

/** What a group of tabs is called and how it looks, without its id. */
export interface GroupLook {
  readonly name?: string | undefined;
  readonly color?: Swatch | undefined;
}

/**
 * The name of a group as the browser keeps it: without spaces at its ends, at most
 * {@link groupNameLimit} characters.
 * @param name - The name that people typed.
 */
export function groupName(name: string): string {
  return name.trim().slice(0, groupNameLimit).trim();
}

/**
 * The color for a new group: the color that the groups of the strip use least, and of those
 * the first in the order of {@link swatches}.
 * @param used - The colors of the groups that the strip has.
 */
export function pickSwatch(used: readonly Swatch[]): Swatch {
  const count = (color: Swatch): number => used.filter((other) => other === color).length;
  return swatches.reduce((best, color) => (count(color) < count(best) ? color : best));
}

/**
 * The groups of some tabs, in the order of their first tabs.
 * @param tabs - Tabs in their order, each with its group.
 */
export function groupsOf(tabs: readonly { readonly group: TabGroup | null }[]): TabGroup[] {
  const groups: TabGroup[] = [];
  for (const { group } of tabs) {
    if (group !== null && !groups.some((other) => other.id === group.id)) groups.push(group);
  }
  return groups;
}

/**
 * The tabs of a window with named, colored groups of neighbouring tabs, which may hide their
 * tabs behind their chip. It keeps every rule of {@link TabStrip} and these:
 * - the tabs of a group stand together, pinned tabs are never in a group, and a group exists
 *   only through its tabs, so the last tab that leaves takes it along;
 * - the active tab is never in a collapsed group, and the two tabs of a split view are in the
 *   same group;
 * - a new tab after a tab, or one that a page of a tab opened, joins the group of that tab; a
 *   new tab in front without an opener, as from the New tab button, goes after the group of the
 *   active tab, outside every group;
 * - the shortcuts that go to the next tab or to a tab by its place skip the tabs of collapsed
 *   groups, and a collapsed group moves as a whole.
 * Without groups, it places and moves tabs as `TabStrip` does.
 */
export class GroupedTabStrip<T extends GroupedTab> extends TabStrip<T> {
  /** The number of the next group. */
  private nextGroup = 1;
  /** The tabs and groups that closed, the most recent last. */
  private readonly reopenable: ClosedEntry[] = [];
  /**
   * Where the next new tab goes while no tab is active, after a collapse hid the active tab
   * with every other one: right after that group.
   */
  private vacated: number | undefined;

  /**
   * @param from - The strip whose tabs, pairs and closed tabs this one takes over, such as the
   *   window's strip before its first group.
   */
  constructor(from?: TabStrip<T>) {
    super();
    if (from !== undefined) Object.assign(this, from);
    for (const url of this.closed.splice(0))
      this.reopenable.push({ kind: 'tab', url, group: null });
  }

  /** The groups of the strip, in the order of their first tabs. */
  get groups(): TabGroup[] {
    return groupsOf(this.tabs);
  }

  override get listed(): readonly T[] {
    return this.tabs.filter((tab) => tab.group?.collapsed !== true);
  }

  override get canReopen(): boolean {
    return this.reopenable.length > 0;
  }

  /**
   * A group of the strip.
   * @param id - The group.
   */
  group(id: string): TabGroup | undefined {
    return this.tabs.find((tab) => tab.group?.id === id)?.group ?? undefined;
  }

  /**
   * The tabs that move together with a tab: all tabs of its group while the group is collapsed,
   * or else those of {@link TabStrip.unitOf}.
   * @param id - The tab.
   */
  override unitOf(id: string): readonly string[] {
    const group = this.get(id)?.group;
    if (group?.collapsed !== true) return super.unitOf(id);
    return this.tabs.filter((tab) => tab.group?.id === group.id).map((tab) => tab.id);
  }

  /** Makes a tab the active tab; a collapsed group opens for it. */
  override activate(id: string): boolean {
    const group = this.get(id)?.group;
    if (group?.collapsed === true) this.restyle({ ...group, collapsed: false });
    this.vacated = undefined;
    return super.activate(id);
  }

  override insert(tab: T, options: StripPlace): void {
    if (tab.pinned) {
      super.insert({ ...tab, group: null }, options);
      return;
    }
    const { index, group } = this.placeFor(options);
    this.tabs.splice(index, 0, { ...tab, group });
    if (!options.activate) this.openedInBackground.add(tab.id);
  }

  override close(id: string, keep = true): ClosedTab<T> | undefined {
    const index = this.indexOf(id);
    // The strip keeps the tab with its group instead of the address alone.
    const closed = super.close(id, false);
    if (closed === undefined) return undefined;
    if (keep) this.remember({ kind: 'tab', url: closed.tab.url, group: closed.tab.group });
    // The other side of a split view shows; else the nearest tab that the strip shows.
    if (!closed.active || closed.pair !== undefined) return closed;
    return { ...closed, next: this.shownFrom(index, 1) ?? this.shownFrom(index - 1, -1) };
  }

  override reopenWith(open: (url: string, place: ReopenPlace) => string): string | undefined {
    const entry = this.reopenable.pop();
    if (entry === undefined) return undefined;
    if (entry.kind === 'tab') {
      // A tab goes back into its group while the group is there.
      const group = entry.group === null ? undefined : this.group(entry.group.id);
      return open(entry.url, group === undefined ? {} : { group });
    }
    // A group comes back with its name and color, its first tab in front and loaded.
    const group = { ...entry.group, id: this.newGroupId(), collapsed: false };
    const [first, ...rest] = entry.tabs;
    if (first === undefined) return undefined;
    const id = open(first.url, { group });
    for (const tab of rest) open(tab.url, { group, activate: false, lazy: true, title: tab.title });
    return id;
  }

  override pin(id: string, pinned: boolean): void {
    // A pinned tab leaves its group.
    if (pinned) this.regroup(this.indexOf(id), 1, null);
    super.pin(id, pinned);
  }

  override split(keep: string, add: string, ratio?: number): boolean {
    if (!super.split(keep, add, ratio)) return false;
    // The tab that joins takes the group of the tab that stays, so the pair is in one group.
    this.regroup(this.indexOf(add), 1, this.get(keep)?.group ?? null);
    return true;
  }

  /**
   * Moves a tab, with the tabs that move with it, to another place, as a drag of the tab strip
   * does. A collapsed group moves as a whole and stays outside other groups.
   * @param id - The tab.
   * @param index - The new index of the first tab of its unit, counted without the unit.
   * @param group - The group that the tab joins, which takes the place into its tabs; `null`
   *   for none. Left out, a place between two tabs of a group that shows its tabs joins that
   *   group, and a place at an edge of the tab's own group keeps it there.
   */
  override move(id: string, index: number, group?: string | null): void {
    const unit = this.unitOf(id);
    const from = this.indexOf(unit[0] ?? id);
    const head = this.tabs[from];
    if (head === undefined || head.pinned) {
      super.move(id, index);
      return;
    }
    const moving = this.tabs.splice(from, unit.length);
    const own = head.group;
    // The group of the tab is gone from the strip while the tab moves when it was its only tab.
    const known = (groupId: string): TabGroup | undefined =>
      this.group(groupId) ?? (own?.id === groupId ? own : undefined);
    let at = Math.max(this.pinnedCount, Math.min(index, this.tabs.length));
    let target: TabGroup | null = null;
    const inside = this.interiorOf(at);
    const wanted = group === undefined || group === null ? undefined : known(group);
    if (own?.collapsed !== true && group === undefined && inside?.collapsed === false) {
      target = inside;
    } else if (own?.collapsed !== true && wanted?.collapsed === false && inside === undefined) {
      target = wanted;
      if (this.group(wanted.id) !== undefined) {
        const [start, end] = this.spanOf(wanted.id);
        at = Math.max(start, Math.min(at, end));
      }
    } else if (own?.collapsed !== true && wanted?.collapsed === false && inside?.id === wanted.id) {
      target = wanted;
    } else {
      // Outside every other group: a place between two tabs of a group goes after the group.
      if (inside !== undefined) at = this.spanOf(inside.id)[1];
      // A collapsed group stays one; without a group named, a tab keeps its own group at its
      // edges, and a tab that was the only one of its group keeps it anywhere.
      const keeps =
        own !== null &&
        (own.collapsed ||
          (group === undefined && (this.group(own.id) === undefined || this.touches(at, own.id))));
      target = keeps ? (this.group(own.id) ?? own) : null;
    }
    const placed = moving.map((tab) => Object.assign({}, tab, { group: target }));
    this.tabs.splice(this.outsidePairs(at), 0, ...placed);
  }

  /**
   * Moves the unit of a tab one step toward the start or the end of the strip, as the keyboard
   * does: a tab at the edge of its group first leaves the group where it is, a tab next to a
   * group that shows its tabs first joins it at that edge, and a collapsed group is passed, or
   * passes, as a whole.
   * @param id - The tab.
   * @param direction - -1 toward the start, 1 toward the end.
   * @returns Whether the strip changed.
   */
  override step(id: string, direction: -1 | 1): boolean {
    const unit = this.unitOf(id);
    const first = this.indexOf(unit[0] ?? id);
    const head = this.tabs[first];
    if (head === undefined || head.pinned) return super.step(id, direction);
    const end = first + unit.length;
    const neighbour = direction < 0 ? this.tabs[first - 1] : this.tabs[end];
    const own = head.group;
    if (own !== null && !own.collapsed) {
      if (neighbour?.group?.id === own.id) return super.step(id, direction);
      this.regroup(first, unit.length, null);
      return true;
    }
    if (neighbour === undefined || neighbour.pinned) return false;
    const next = neighbour.group;
    if (next === null) return super.step(id, direction);
    if (own === null && !next.collapsed) {
      this.regroup(first, unit.length, next);
      return true;
    }
    // A group is passed as a whole.
    const [start, stop] = this.spanOf(next.id);
    const moving = this.tabs.splice(first, unit.length);
    this.tabs.splice(direction < 0 ? start : stop - unit.length, 0, ...moving);
    return true;
  }

  override clear(): T[] {
    this.vacated = undefined;
    return super.clear();
  }

  /**
   * Puts a tab, with the other tab of its split view, in a new group, which keeps its place;
   * a tab between two tabs of another group leaves it after that group first.
   * @param id - The tab.
   * @param look - The name and color of the group; the least used color without one.
   * @returns The group, or `undefined` for a pinned tab or one that the strip does not show.
   */
  createGroup(id: string, look: GroupLook = {}): TabGroup | undefined {
    const tab = this.get(id);
    if (tab === undefined || tab.pinned || tab.group?.collapsed === true) return undefined;
    const group: TabGroup = {
      id: this.newGroupId(),
      name: groupName(look.name ?? ''),
      color: look.color ?? pickSwatch(this.groups.map((other) => other.color)),
      collapsed: false,
    };
    const unit = this.unitOf(id);
    const first = this.indexOf(unit[0] ?? id);
    const old = tab.group;
    if (old !== null && this.inside(first, unit.length, old.id)) {
      this.place(first, unit.length, this.spanOf(old.id)[1] - unit.length, group);
    } else {
      this.regroup(first, unit.length, group);
    }
    return group;
  }

  /**
   * Moves a tab, with the other tab of its split view, to the end of a group, which shows its
   * tabs again if it hid them, as the tab may be the active one.
   * @param id - The tab.
   * @param groupId - The group.
   * @returns Whether the tab joined the group.
   */
  addToGroup(id: string, groupId: string): boolean {
    const tab = this.get(id);
    const known = this.group(groupId);
    if (tab === undefined || tab.pinned || known === undefined) return false;
    if (tab.group?.id === groupId) return false;
    const group = known.collapsed ? { ...known, collapsed: false } : known;
    if (group !== known) this.restyle(group);
    const unit = this.unitOf(id);
    const first = this.indexOf(unit[0] ?? id);
    const [, end] = this.spanOf(groupId);
    this.place(first, unit.length, end > first ? end - unit.length : end, group);
    return true;
  }

  /**
   * Takes a tab, with the other tab of its split view, out of its group, right after the group.
   * @param id - The tab.
   * @returns Whether the tab left a group.
   */
  removeFromGroup(id: string): boolean {
    const group = this.get(id)?.group;
    if (group === null || group === undefined) return false;
    const unit = this.unitOf(id);
    const first = this.indexOf(unit[0] ?? id);
    this.place(first, unit.length, this.spanOf(group.id)[1] - unit.length, null);
    return true;
  }

  /**
   * Ends a group; its tabs stay where they are and show.
   * @param groupId - The group.
   * @returns Whether the group was there.
   */
  ungroup(groupId: string): boolean {
    const [start, end] = this.spanOf(groupId);
    if (start === end) return false;
    this.regroup(start, end - start, null);
    return true;
  }

  /**
   * Names or colors a group.
   * @param groupId - The group.
   * @param look - Its new name, which is trimmed and cut to its limit, and its new color.
   * @returns Whether the group changed.
   */
  updateGroup(groupId: string, look: GroupLook): boolean {
    const group = this.group(groupId);
    if (group === undefined) return false;
    const next = {
      ...group,
      ...(look.name === undefined ? {} : { name: groupName(look.name) }),
      ...(look.color === undefined ? {} : { color: look.color }),
    };
    if (next.name === group.name && next.color === group.color) return false;
    this.restyle(next);
    return true;
  }

  /**
   * Hides the tabs of a group behind its chip, or shows them again. Hiding the group of the
   * active tab makes the nearest tab after the group active, or else the one before it; with no
   * tab left to show, the strip has no active tab, and the next new tab goes after the group.
   * @param groupId - The group.
   * @param collapsed - Whether the tabs are hidden.
   * @returns Whether the group changed.
   */
  setCollapsed(groupId: string, collapsed: boolean): boolean {
    const group = this.group(groupId);
    if (group === undefined || group.collapsed === collapsed) return false;
    this.restyle({ ...group, collapsed });
    if (!collapsed || this.active?.group?.id !== groupId) return true;
    const [start, end] = this.spanOf(groupId);
    const next = this.shownFrom(end, 1) ?? this.shownFrom(start - 1, -1);
    this.activeId = undefined;
    if (next === undefined) this.vacated = end;
    else super.activate(next.id);
    return true;
  }

  /**
   * Closes the tabs of a group, which the strip keeps as one closed entry, so that the group
   * opens again with its name and color. The active tab in the group makes way for the nearest
   * tab after the group, or else the one before it.
   * @param groupId - The group.
   * @returns The tabs that closed.
   */
  closeGroup(groupId: string): T[] {
    const [start, end] = this.spanOf(groupId);
    const members = this.tabs.slice(start, end);
    const group = members[0]?.group;
    if (group === undefined || group === null) return [];
    if (members.some((tab) => tab.id === this.activeId)) {
      const next = this.shownFrom(end, 1) ?? this.shownFrom(start - 1, -1);
      this.activeId = undefined;
      if (next === undefined) this.vacated = start;
      else super.activate(next.id);
    }
    this.tabs.splice(start, end - start);
    const gone = new Set(members.map((tab) => tab.id));
    this.pairs = this.pairs.filter((pair) => !gone.has(pair.start) && !gone.has(pair.end));
    for (const id of gone) this.openedInBackground.delete(id);
    this.remember({
      kind: 'group',
      group,
      tabs: members.map(({ url, title }) => ({ url, title })),
    });
    return members;
  }

  /**
   * Makes neighbouring tabs a group again, such as those of a restored window.
   * @param ids - The tabs, which must stand together in this order and not be pinned.
   * @param look - The name, color and collapse of the group.
   * @returns The group, or `undefined` when the tabs cannot form one.
   */
  formGroup(ids: readonly string[], look: Omit<TabGroup, 'id'>): TabGroup | undefined {
    const first = this.indexOf(ids[0] ?? '');
    const together = ids.every((id, at) => this.tabs[first + at]?.id === id);
    if (first === -1 || !together || this.tabs[first]?.pinned !== false) return undefined;
    const group: TabGroup = {
      id: this.newGroupId(),
      name: groupName(look.name),
      color: look.color,
      collapsed: look.collapsed,
    };
    // The other tab of a split view, which stands next to them, joins as well.
    const [start, count] = this.widenToPairs(first, ids.length);
    this.regroup(start, count, group);
    return group;
  }

  /** The id of a new group. */
  private newGroupId(): string {
    return `g${(this.nextGroup++).toString(36)}`;
  }

  /** Keeps a tab or a group that closed, as many as the strip keeps. */
  private remember(entry: ClosedEntry): void {
    this.reopenable.push(entry);
    if (this.reopenable.length > closedTabLimit) this.reopenable.shift();
  }

  /**
   * Where a new tab goes, and in which group: see the rules of the class.
   * @param options - What the new tab follows, opened it or joins.
   */
  private placeFor(options: StripPlace): { index: number; group: TabGroup | null } {
    const pinned = this.pinnedCount;
    const result = (
      index: number,
      group: TabGroup | null,
    ): { index: number; group: TabGroup | null } => {
      let at = Math.max(pinned, Math.min(index, this.tabs.length));
      if (group !== null && this.group(group.id) !== undefined) {
        const [start, end] = this.spanOf(group.id);
        at = Math.max(start, Math.min(at, end));
      } else {
        const inside = this.interiorOf(at);
        if (inside !== undefined) at = this.spanOf(inside.id)[1];
      }
      return { index: this.outsidePairs(at), group };
    };
    const active = this.active;
    const front = (): number =>
      active === undefined
        ? (this.vacated ?? this.tabs.length)
        : active.group === null
          ? this.insertionIndex(true)
          : this.spanOf(active.group.id)[1];
    if (options.group !== undefined) {
      const known = this.group(options.group.id);
      return known === undefined
        ? result(front(), options.group)
        : result(this.spanOf(known.id)[1], known);
    }
    if (options.after !== undefined) {
      return result(this.endOfUnit(options.after), this.get(options.after)?.group ?? null);
    }
    // A tab in the background that nothing names comes from the active tab, as from a link. A
    // tab from a tab outside every group goes where it goes without groups.
    const opener = options.opener ?? (options.activate ? undefined : this.activeId);
    const from = opener === undefined ? undefined : this.get(opener);
    if (from?.group === null || from?.group === undefined) {
      return result(options.activate ? front() : this.insertionIndex(false), null);
    }
    const index =
      from.id === this.activeId ? this.insertionIndex(options.activate) : this.endOfUnit(from.id);
    return result(index, from.group);
  }

  /**
   * The first tab from an index on, toward the start or the end, whose group shows its tabs.
   * @param index - Where to start.
   * @param direction - -1 toward the start, 1 toward the end.
   */
  private shownFrom(index: number, direction: -1 | 1): T | undefined {
    for (let at = index; at >= 0 && at < this.tabs.length; at += direction) {
      const tab = this.tabs[at];
      if (tab !== undefined && tab.group?.collapsed !== true) return tab;
    }
    return undefined;
  }

  /**
   * Where a group lies: the index of its first tab and the index after its last; `[0, 0]` for
   * a group that the strip does not have.
   * @param groupId - The group.
   */
  private spanOf(groupId: string): [number, number] {
    const start = this.tabs.findIndex((tab) => tab.group?.id === groupId);
    if (start === -1) return [0, 0];
    let end = start;
    while (this.tabs[end]?.group?.id === groupId) end += 1;
    return [start, end];
  }

  /**
   * The group whose tabs stand on both sides of a place, which a tab there would come between.
   * @param index - The place, as an index of the tabs.
   */
  private interiorOf(index: number): TabGroup | undefined {
    const before = this.tabs[index - 1]?.group;
    const after = this.tabs[index]?.group;
    return before !== null && before !== undefined && before.id === after?.id ? before : undefined;
  }

  /** Whether a place lies next to a tab of a group. */
  private touches(index: number, groupId: string): boolean {
    return this.tabs[index - 1]?.group?.id === groupId || this.tabs[index]?.group?.id === groupId;
  }

  /** Whether some neighbouring tabs have tabs of a group on both sides. */
  private inside(first: number, count: number, groupId: string): boolean {
    return (
      this.tabs[first - 1]?.group?.id === groupId && this.tabs[first + count]?.group?.id === groupId
    );
  }

  /** Widens neighbouring tabs to the other tabs of the split views at their ends. */
  private widenToPairs(first: number, count: number): [number, number] {
    const head = this.tabs[first];
    const tail = this.tabs[first + count - 1];
    const start = head === undefined ? first : this.indexOf(this.unitOf(head.id)[0] ?? head.id);
    const last = tail === undefined ? first : this.indexOf(this.unitOf(tail.id).at(-1) ?? tail.id);
    return [start, last - start + 1];
  }

  /** Gives neighbouring tabs another group, or none, where they stand. */
  private regroup(first: number, count: number, group: TabGroup | null): void {
    for (let at = first; at < first + count; at += 1) {
      const tab = this.tabs[at];
      if (tab !== undefined) this.tabs[at] = { ...tab, group };
    }
  }

  /**
   * Moves neighbouring tabs to another place and gives them a group, or none.
   * @param first - The index of the first of them.
   * @param count - How many they are.
   * @param index - Their new index, counted without them.
   * @param group - Their group.
   */
  private place(first: number, count: number, index: number, group: TabGroup | null): void {
    const moving = this.tabs.splice(first, count);
    this.tabs.splice(index, 0, ...moving.map((tab) => Object.assign({}, tab, { group })));
  }

  /** Gives every tab of a group the group's newer name, color or collapse. */
  private restyle(group: TabGroup): void {
    this.tabs.forEach((tab, at) => {
      if (tab.group?.id === group.id) this.tabs[at] = { ...tab, group };
    });
  }
}

/**
 * The strip of the tabs that a window shows, with groups, which takes over the plain strip the
 * first time; with workspaces, the strip of the workspace that shows.
 */
function groupedStrip(tabs: TabService): GroupedTabStrip<Tab> {
  let grouped: GroupedTabStrip<Tab> | undefined;
  tabs.useStrip((strip) =>
    strip.withShown((shown) => {
      grouped = shown instanceof GroupedTabStrip ? shown : new GroupedTabStrip(shown);
      return grouped;
    }),
  );
  if (grouped === undefined) throw new Error('The strip of the tabs took no groups');
  return grouped;
}

/**
 * Changes the groups of a window's tabs, and tells the window's views and its session what
 * changed, as {@link TabService.edit} does. The first change gives the window a strip with
 * groups, which keeps its tabs.
 * @param tabs - The tabs of the window.
 * @param change - Changes the strip with groups, and gives what the caller wants back.
 * @returns What the change gave.
 */
export function editGroups<R>(
  tabs: TabService,
  change: (strip: GroupedTabStrip<Tab>) => R,
): R | undefined {
  const strip = groupedStrip(tabs);
  let result: R | undefined;
  tabs.edit(() => {
    result = change(strip);
  });
  return result;
}

/**
 * Closes the tabs of a group of a window, which the window can open again as a group.
 * @param tabs - The tabs of the window.
 * @param groupId - The group.
 */
export function closeGroup(tabs: TabService, groupId: string): void {
  const strip = groupedStrip(tabs);
  tabs.edit(() => strip.closeGroup(groupId));
}

/**
 * Brings the groups of a restored window back: neighbouring tabs that kept the same group form
 * it again, with a new id, its name, its color and whether it was collapsed. Tabs of a group
 * that do not stand together form a group each; pinned tabs and tabs without a group stay as
 * they are.
 * @param tabs - The tabs of the window.
 * @param ids - The restored tabs, in the order of the session.
 * @param groups - The group that each of them kept, by its place.
 */
export function restoreGroups(
  tabs: TabService,
  ids: readonly TabId[],
  groups: readonly (TabGroup | undefined)[],
): void {
  const pinned = new Set(tabs.all.filter((tab) => tab.pinned).map((tab) => tab.id));
  const runs: { ids: TabId[]; group: TabGroup }[] = [];
  ids.forEach((id, at) => {
    const group = pinned.has(id) ? undefined : groups[at];
    const last = runs.at(-1);
    if (group === undefined) return;
    if (last !== undefined && ids[at - 1] === last.ids.at(-1) && last.group.id === group.id) {
      last.ids.push(id);
    } else {
      runs.push({ ids: [id], group });
    }
  });
  if (runs.length === 0) return;
  editGroups(tabs, (strip) => {
    for (const run of runs) strip.formGroup(run.ids, run.group);
  });
}
