import type { ShellState, TabView } from '../../shared/ipc/shell-contracts.ts';

/** An item of the tab strip: a tab, for now. */
export interface StripItem {
  readonly kind: 'tab';
  /** The key of the item, which its element carries as `data-id`: the id of the tab. */
  readonly key: string;
  readonly tab: TabView;
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
 * The items of the tab strip, in their order: one for each tab.
 * @param state - The state of the shell.
 */
export function stripItems(state: Pick<ShellState, 'tabs'>): StripItem[] {
  return state.tabs.map((tab) => ({ kind: 'tab', key: tab.id, tab }));
}

/**
 * The units of the tab strip, in their order: each tab moves on its own.
 * @param items - The items of the strip, in their order.
 */
export function unitsOf(items: readonly StripItem[]): StripUnit[] {
  return items.map((item) => [item.key]);
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
 * Where a dragged unit lands: after every other unit whose center lies before the center of
 * the dragged unit. The other units close up where it was and make room where it lands.
 * @param units - The units of the strip, in their order when the drag started.
 * @param dragged - The dragged unit.
 * @param offset - How far the pointer moved the dragged unit along the strip.
 * @param spans - Where each item was when the drag started, by its key; a unit without a
 *   place counts as no part of the strip.
 * @param gap - The space between two items.
 * @returns The place, or `undefined` when the dragged unit has no place in the strip.
 */
export function dropPlace(
  units: readonly StripUnit[],
  dragged: StripUnit,
  offset: number,
  spans: ReadonlyMap<string, Span>,
  gap = 0,
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
  for (const key of order.flat()) {
    const span = spans.get(key);
    if (span === undefined) continue;
    if (!dragged.includes(key)) shifts.set(key, position - span.start);
    position += span.size + gap;
  }
  const index = others.slice(0, before).reduce((count, { unit }) => count + unit.length, 0);
  return { index, shifts };
}

/** Where a unit lies along the strip, from the start of its first item to the end of its last. */
function spanOfUnit(unit: StripUnit, spans: ReadonlyMap<string, Span>): Span | undefined {
  const items = unit.flatMap((key) => spans.get(key) ?? []);
  const first = items[0];
  const last = items.at(-1);
  if (first === undefined || last === undefined || items.length !== unit.length) return undefined;
  return { start: first.start, size: last.start + last.size - first.start };
}
