import type { ShellState, TabView } from '../../shared/ipc/shell-contracts.ts';

/** A group of tabs as the shell draws it. */
type TabGroupView = NonNullable<TabView['group']>;

/**
 * An item of the tab strip: a tab, which may be a side of a split view, or the chip of a group
 * of tabs, which comes before the group's first tab. The key of an item, which its element
 * carries as `data-id`, is the id of the tab, or `group:` and the id of the group.
 */
export type StripItem =
  | { readonly kind: 'tab'; readonly key: string; readonly tab: TabView }
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly group: TabGroupView;
      /** The tabs of the group, also while it hides them. */
      readonly tabs: readonly TabView[];
    };

/**
 * The key of the chip of a group of tabs.
 * @param id - The group.
 */
export function chipKey(id: string): string {
  return `group:${id}`;
}

/** The keys of the items of the tab strip that move together when one of them is dragged. */
export type StripUnit = readonly string[];

/** Where an item of the tab strip lies along the strip: where it starts, and its size. */
export interface Span {
  readonly start: number;
  readonly size: number;
}

/** Where a dragged unit of the tab strip lands, and where the other items go meanwhile. */
export interface DropPlace {
  /**
   * How many items come before the dragged unit at the place where it lands, without the
   * unit itself, as the browser counts when it moves a tab.
   */
  readonly index: number;
  /** How far each item that is not dragged moves out of the way, by its key. */
  readonly shifts: ReadonlyMap<string, number>;
}

/**
 * The items of the tab strip, in their order: one for each tab, and the chip of each group of
 * tabs before its first tab. The tabs of a collapsed group are not items; its chip stands for
 * them.
 * @param state - The state of the shell.
 */
export function stripItems(state: Pick<ShellState, 'tabs'>): StripItem[] {
  const items: StripItem[] = [];
  let open: string | undefined;
  for (const tab of state.tabs) {
    const group = tab.group;
    if (group !== null && group.id !== open) {
      const tabs = state.tabs.filter((other) => other.group?.id === group.id);
      items.push({ kind: 'group', key: chipKey(group.id), group, tabs });
    }
    open = group?.id;
    if (group?.collapsed !== true) items.push({ kind: 'tab', key: tab.id, tab });
  }
  return items;
}

/**
 * The units of the tab strip, in their order: the two tabs of a split view move together, as
 * a left tab with the right tab right after it; every other tab moves on its own, also a side
 * whose other side is not next to it, and so does the chip of a group, which stands for all
 * tabs of a collapsed group.
 * @param items - The items of the strip, in their order.
 */
export function unitsOf(items: readonly StripItem[]): StripUnit[] {
  const units: StripUnit[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const next = items[index + 1];
    if (item === undefined) continue;
    if (
      item.kind === 'tab' &&
      item.tab.split === 'start' &&
      next?.kind === 'tab' &&
      next.tab.split === 'end'
    ) {
      units.push([item.key, next.key]);
      index += 1;
    } else {
      units.push([item.key]);
    }
  }
  return units;
}

/**
 * Where an element lies along the tab strip: from left to right, or from top to bottom in a
 * strip at a side of the window.
 * @param rect - The box of the element.
 * @param vertical - Whether the strip runs from top to bottom.
 */
export function spanOf(
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  vertical: boolean,
): Span {
  return vertical ? { start: rect.top, size: rect.height } : { start: rect.left, size: rect.width };
}

/**
 * How many tabs the items of the strip stand for, by key: a tab one, the chip of a group that
 * shows its tabs none, and the chip of a collapsed group the tabs that it hides.
 * @param items - The items of the strip.
 */
export function tabCounts(items: readonly StripItem[]): Map<string, number> {
  return new Map(
    items.map((item) => [
      item.key,
      item.kind === 'tab' ? 1 : item.group.collapsed ? item.tabs.length : 0,
    ]),
  );
}

/**
 * Where a dragged unit lands: after every other unit whose center lies before the center of
 * the dragged unit. The other units close up where it was and make room where it lands, each
 * as a whole, with the space between units and none between the items of a unit.
 * @param units - The units of the strip, in their order when the drag started.
 * @param dragged - The dragged unit.
 * @param offset - How far the pointer moved the dragged unit along the strip.
 * @param spans - Where each item was when the drag started, by its key; a unit without a
 *   place counts as no part of the strip.
 * @param gap - The space between two items.
 * @param counts - How many tabs each item stands for, by key; one without it.
 * @returns The place, or `undefined` when the dragged unit has no place in the strip.
 */
export function dropPlace(
  units: readonly StripUnit[],
  dragged: StripUnit,
  offset: number,
  spans: ReadonlyMap<string, Span>,
  gap = 0,
  counts: ReadonlyMap<string, number> = new Map(),
): DropPlace | undefined {
  const own = spanOfUnit(dragged, spans);
  if (own === undefined) return undefined;
  const center = own.start + own.size / 2 + offset;
  const placed = units.flatMap((unit) => {
    const span = spanOfUnit(unit, spans);
    return span === undefined ? [] : [{ unit, span }];
  });
  const others = placed.filter(({ unit }) => unit[0] !== dragged[0]);
  const before = others.filter(({ span }) => span.start + span.size / 2 < center).length;
  // Where each item goes in the new order, from the start of the first item.
  const order = [
    ...others.slice(0, before).map(({ unit }) => unit),
    dragged,
    ...others.slice(before).map(({ unit }) => unit),
  ];
  let position = placed[0]?.span.start ?? own.start;
  const shifts = new Map<string, number>();
  for (const unit of order) {
    const span = spanOfUnit(unit, spans);
    if (span === undefined) continue;
    if (unit[0] !== dragged[0]) for (const key of unit) shifts.set(key, position - span.start);
    position += span.size + gap;
  }
  const index = others
    .slice(0, before)
    .reduce(
      (count, { unit }) => count + unit.reduce((sum, key) => sum + (counts.get(key) ?? 1), 0),
      0,
    );
  return { index, shifts };
}

/**
 * The group that a dragged tab joins where it is dropped: the group that shows its tabs over
 * whose span, from the start of its chip to the end of its last tab, the center of the tab
 * lies, the tab's own place included. A tab of a group that is dragged more than half its
 * width past the first or the last tab of its group leaves it; collapsed groups take no tab.
 * @param items - The items of the strip when the drag started.
 * @param dragged - The dragged unit.
 * @param offset - How far the pointer moved the dragged unit along the strip.
 * @param spans - Where each item was when the drag started, by its key.
 * @returns The id of the group, or `null` for none.
 */
export function dropGroup(
  items: readonly StripItem[],
  dragged: StripUnit,
  offset: number,
  spans: ReadonlyMap<string, Span>,
): string | null {
  const own = spanOfUnit(dragged, spans);
  const head = items.find((item) => item.key === dragged[0]);
  if (own === undefined || head?.kind !== 'tab' || head.tab.pinned) return null;
  const center = own.start + own.size / 2 + offset;
  for (const item of items) {
    if (item.kind !== 'group' || item.group.collapsed) continue;
    const keys = [item.key, ...item.tabs.map((tab) => tab.id)];
    const placed = keys.flatMap((key) => spans.get(key) ?? []);
    const first = placed[0];
    const last = placed.at(-1);
    if (first === undefined || last === undefined) continue;
    if (center >= first.start && center <= last.start + last.size) return item.group.id;
  }
  return null;
}

/** Where a unit lies along the strip, from the start of its first item to the end of its last. */
function spanOfUnit(unit: StripUnit, spans: ReadonlyMap<string, Span>): Span | undefined {
  const items = unit.flatMap((key) => spans.get(key) ?? []);
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined || items.length !== unit.length) return undefined;
  return { start: first.start, size: last.start + last.size - first.start };
}
