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
  sleeping: false,
  split: null,
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

  it('keeps the two tabs of a split view together as a unit, and a side without its partner alone', () => {
    const side = (id: string, split: 'start' | 'end'): TabView => ({ ...tab(id), split });
    const items = stripItems({
      tabs: [tab('a'), side('b', 'start'), side('c', 'end'), side('d', 'end'), side('e', 'start')],
    });
    expect(unitsOf(items)).toEqual([['a'], ['b', 'c'], ['d'], ['e']]);
    expect(
      unitsOf(stripItems({ tabs: [side('a', 'start'), side('b', 'start'), side('c', 'end')] })),
    ).toEqual([['a'], ['b', 'c']]);
  });

  it('moves the tabs of a split view, which have no space between them, as a whole', () => {
    // a, then the pair b|c without a gap, then d: 100 px tabs, 8 px between units.
    const places = new Map<string, Span>([
      ['a', { start: 10, size: 100 }],
      ['b', { start: 118, size: 100 }],
      ['c', { start: 218, size: 100 }],
      ['d', { start: 326, size: 100 }],
    ]);
    const units = [['a'], ['b', 'c'], ['d']];
    // The pair, centered at 218, passes the center of d at 376.
    expect(dropPlace(units, ['b', 'c'], 160, places, 8)).toEqual({
      index: 2,
      shifts: new Map([
        ['a', 0],
        ['d', -208],
      ]),
    });
    // A tab dragged past the pair moves both of its tabs by the same length.
    expect(dropPlace(units, ['a'], 220, places, 8)).toEqual({
      index: 2,
      shifts: new Map([
        ['b', -108],
        ['c', -108],
        ['d', 0],
      ]),
    });
    // Along a strip at a side, a vertical pair is a unit in the same way.
    const vertical = new Map<string, Span>([
      ['b', spanOf({ left: 0, top: 50, width: 200, height: 36 }, true)],
      ['c', spanOf({ left: 0, top: 86, width: 200, height: 36 }, true)],
      ['d', spanOf({ left: 0, top: 126, width: 200, height: 36 }, true)],
    ]);
    expect(dropPlace([['b', 'c'], ['d']], ['d'], -70, vertical, 4)).toEqual({
      index: 0,
      shifts: new Map([
        ['b', 40],
        ['c', 40],
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
