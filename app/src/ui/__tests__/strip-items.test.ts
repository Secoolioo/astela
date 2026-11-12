import { describe, expect, it } from 'vitest';
import type { TabView } from '../../shared/ipc/shell-contracts.ts';
import { dropPlace, spanOf, stripItems, unitsOf, type Span } from '../shell/strip-items.ts';

const tab = (id: string): TabView => ({
  id,
  title: id,
  url: `https://${id}.example/`,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  blocked: 0,
  blocking: 'on',
  bookmarked: false,
  problem: null,
  certificateException: false,
  zoom: 1,
  favicon: null,
  audible: false,
  muted: false,
  pinned: false,
});

/** Tabs of 100 pixels with 8 pixels between them, from 10 on. */
const spans = (...keys: string[]): Map<string, Span> =>
  new Map(keys.map((key, index) => [key, { start: 10 + index * 108, size: 100 }]));

describe('strip items', () => {
  it('lists one item for each tab, keyed by the tab, and moves each tab on its own', () => {
    const tabs = [tab('a'), tab('b')];
    const items = stripItems({ tabs });
    expect(items).toEqual([
      { kind: 'tab', key: 'a', tab: tabs[0] },
      { kind: 'tab', key: 'b', tab: tabs[1] },
    ]);
    expect(unitsOf(items)).toEqual([['a'], ['b']]);
    expect(unitsOf([])).toEqual([]);
  });

  it('measures an item along a strip at the top, the bottom or a side', () => {
    const rect = { left: 10, top: 20, width: 100, height: 30 };
    expect(spanOf(rect, false)).toEqual({ start: 10, size: 100 });
    expect(spanOf(rect, true)).toEqual({ start: 20, size: 30 });
  });

  it('drops a dragged tab after the tabs whose centers it passed, and moves the others out of its way', () => {
    const units = [['a'], ['b'], ['c'], ['d']];
    const places = spans('a', 'b', 'c', 'd');
    // b's center moves from 168 to 288, past the center of c at 276.
    expect(dropPlace(units, ['b'], 120, places, 8)).toEqual({
      index: 2,
      shifts: new Map([
        ['a', 0],
        ['c', -108],
        ['d', 0],
      ]),
    });
    // Short of the center of a, nothing moves.
    expect(dropPlace(units, ['b'], -100, places, 8)).toEqual({
      index: 1,
      shifts: new Map([
        ['a', 0],
        ['c', 0],
        ['d', 0],
      ]),
    });
    expect(dropPlace(units, ['b'], -120, places, 8)).toEqual({
      index: 0,
      shifts: new Map([
        ['a', 108],
        ['c', 0],
        ['d', 0],
      ]),
    });
    // Past the end, the tab goes last.
    expect(dropPlace(units, ['a'], 1000, places, 8)?.index).toBe(3);
  });

  it('works the same along a strip at a side, with the boxes measured from top to bottom', () => {
    const boxes = ['a', 'b', 'c'].map(
      (key, index) =>
        [key, spanOf({ left: 0, top: 50 + index * 40, width: 200, height: 36 }, true)] as const,
    );
    const place = dropPlace([['a'], ['b'], ['c']], ['c'], -45, new Map(boxes), 4);
    expect(place).toEqual({
      index: 1,
      shifts: new Map([
        ['a', 0],
        ['b', 40],
      ]),
    });
  });

  it('moves units of several items as one, and counts their items in the index', () => {
    const units = [['a'], ['b', 'c'], ['d']];
    const places = spans('a', 'b', 'c', 'd');
    // The unit of b and c is centered at 222 and passes the center of d at 384.
    expect(dropPlace(units, ['b', 'c'], 170, places, 8)).toEqual({
      index: 2,
      shifts: new Map([
        ['a', 0],
        ['d', -216],
      ]),
    });
    // A tab dragged past the unit lands after both of its items.
    expect(dropPlace(units, ['a'], 200, places, 8)).toEqual({
      index: 2,
      shifts: new Map([
        ['b', -108],
        ['c', -108],
        ['d', 0],
      ]),
    });
  });

  it('leaves out units that have no place, and places no unit without one', () => {
    const places = spans('a', 'b');
    expect(dropPlace([['a'], ['x'], ['b']], ['b'], -120, places, 8)).toEqual({
      index: 0,
      shifts: new Map([['a', 108]]),
    });
    expect(dropPlace([['a'], ['b']], ['x'], 10, places, 8)).toBeUndefined();
    expect(dropPlace([['a'], ['b', 'x']], ['b', 'x'], 10, places, 8)).toBeUndefined();
  });
});
