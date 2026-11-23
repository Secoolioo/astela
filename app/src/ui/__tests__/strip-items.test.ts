import { describe, expect, it } from 'vitest';
import type { TabView } from '../../shared/ipc/shell-contracts.ts';
import {
  chipKey,
  dropGroup,
  dropPlace,
  inside,
  spanning,
  spanOf,
  stripItems,
  tabCounts,
  unitsOf,
  workspaceDrops,
  workspaceTarget,
  type Span,
} from '../shell/strip-items.ts';

const tab = (id: string): TabView => ({
  id,
  title: id,
  url: `https://${id}.example/`,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  blocked: 0,
  popups: 0,
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
  group: null,
  reader: 'none',
  pictureInPicture: 'none',
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

describe('strip items of groups of tabs', () => {
  const work = { id: 'g1', name: 'Work', color: 'blue', collapsed: false } as const;
  const hidden = { id: 'g2', name: '', color: 'red', collapsed: true } as const;
  const grouped = (id: string, group: TabView['group']): TabView => ({ ...tab(id), group });

  it('puts the chip of each group before its first tab, and leaves out the tabs that a group hides', () => {
    const tabs = [
      tab('a'),
      grouped('b', work),
      grouped('c', work),
      grouped('d', hidden),
      grouped('e', hidden),
      tab('f'),
    ];
    const items = stripItems({ tabs });
    expect(items.map((item) => item.key)).toEqual(['a', 'group:g1', 'b', 'c', 'group:g2', 'f']);
    expect(items[1]).toEqual({
      kind: 'group',
      key: chipKey('g1'),
      group: work,
      tabs: tabs.slice(1, 3),
    });
    expect(items[4]).toMatchObject({ kind: 'group', tabs: tabs.slice(3, 5) });
    // A chip moves on its own and stands for the tabs that its group hides.
    expect(unitsOf(items)).toEqual([['a'], ['group:g1'], ['b'], ['c'], ['group:g2'], ['f']]);
    expect(tabCounts(items)).toEqual(
      new Map([
        ['a', 1],
        ['group:g1', 0],
        ['b', 1],
        ['c', 1],
        ['group:g2', 2],
        ['f', 1],
      ]),
    );
  });

  // a, the chip of b and c, b, c, the chip of the hidden d and e, f: 100 px each, 8 px apart.
  const tabs = [
    tab('a'),
    grouped('b', work),
    grouped('c', work),
    grouped('d', hidden),
    grouped('e', hidden),
    tab('f'),
  ];
  const items = stripItems({ tabs });
  const units = unitsOf(items);
  const places = spans('a', 'group:g1', 'b', 'c', 'group:g2', 'f');
  const counts = tabCounts(items);

  it('counts the tabs of the strip in the place of a drop, also those that a group hides', () => {
    // f passes the hidden group and c: two hidden tabs and c come after it.
    expect(dropPlace(units, ['f'], -250, places, 8, counts)?.index).toBe(2);
    // a passes the chip of the group and b: only b counts.
    expect(dropPlace(units, ['a'], 250, places, 8, counts)?.index).toBe(1);
    // Past everything, a lands after the five tabs of the others.
    expect(dropPlace(units, ['a'], 1000, places, 8, counts)?.index).toBe(5);
    // The chips make room like tabs.
    expect(dropPlace(units, ['a'], 250, places, 8, counts)?.shifts.get('group:g1')).toBe(-108);
  });

  it('joins a group between two of its tabs or over its chip, and leaves it more than half a tab past its end', () => {
    // a from 10-110, the chip from 118, b from 226, c from 334 to 434.
    expect(dropGroup(items, ['a'], 280, places)).toBe('g1');
    expect(dropGroup(items, ['a'], 110, places)).toBe('g1');
    expect(dropGroup(items, ['a'], 50, places)).toBeNull();
    // c leaves its group once its middle passes the end of the group, its own place included.
    expect(dropGroup(items, ['c'], 40, places)).toBe('g1');
    expect(dropGroup(items, ['c'], 60, places)).toBeNull();
    // b leaves it past the start of the chip.
    expect(dropGroup(items, ['b'], -150, places)).toBe('g1');
    expect(dropGroup(items, ['b'], -170, places)).toBeNull();
    // A hidden group takes no tab, also over its chip.
    expect(dropGroup(items, ['f'], -108, places)).toBeNull();
  });

  it('joins no group with a pinned tab or a tab without a place, and works along a strip at a side', () => {
    const pinned = { ...tab('p'), pinned: true };
    const withPin = stripItems({ tabs: [pinned, grouped('b', work), grouped('c', work)] });
    const pinPlaces = spans('p', 'group:g1', 'b', 'c');
    expect(dropGroup(withPin, ['p'], 250, pinPlaces)).toBeNull();
    expect(dropGroup(items, ['x'], 0, places)).toBeNull();
    const vertical = new Map<string, Span>([
      ['a', spanOf({ left: 0, top: 50, width: 200, height: 36 }, true)],
      ['group:g1', spanOf({ left: 0, top: 90, width: 200, height: 28 }, true)],
      ['b', spanOf({ left: 12, top: 122, width: 188, height: 36 }, true)],
      ['c', spanOf({ left: 12, top: 162, width: 188, height: 36 }, true)],
    ]);
    const column = stripItems({ tabs: [tab('a'), grouped('b', work), grouped('c', work)] });
    expect(dropGroup(column, ['a'], 90, vertical)).toBe('g1');
    expect(dropGroup(column, ['c'], 27, vertical)).toBeNull();
    expect(dropGroup(column, ['c'], 17, vertical)).toBe('g1');
  });
});

describe('drop targets of the workspaces', () => {
  const home = { id: 'default', name: '', icon: 'home', color: 'blue', isolated: false } as const;
  const work = {
    id: 'w1',
    name: 'Work',
    icon: 'briefcase',
    color: 'teal',
    isolated: false,
  } as const;
  const bank = { id: 'w2', name: 'Bank', icon: 'heart', color: 'red', isolated: true } as const;

  it('offers every workspace but the one that shows, and tells where the tab loads again', () => {
    const workspaces = [home, work, bank];
    expect(workspaceDrops({ workspace: home, workspaces })).toEqual([
      { workspace: work, reload: false },
      { workspace: bank, reload: true },
    ]);
    expect(workspaceDrops({ workspace: bank, workspaces })).toEqual([
      { workspace: home, reload: true },
      { workspace: work, reload: true },
    ]);
    expect(workspaceDrops({ workspace: home, workspaces: [home] })).toEqual([]);
    // A private window, a popup or a window while workspaces are off has none.
    expect(workspaceDrops({ workspace: null, workspaces })).toEqual([]);
  });

  it('finds the target under the pointer by the rectangles, edges included', () => {
    const targets = new Map([
      ['w1', { left: 40, top: 4, width: 100, height: 28 }],
      ['w2', { left: 144, top: 4, width: 100, height: 28 }],
    ]);
    expect(workspaceTarget(targets, { x: 40, y: 4 })).toBe('w1');
    expect(workspaceTarget(targets, { x: 140, y: 32 })).toBe('w1');
    expect(workspaceTarget(targets, { x: 200, y: 20 })).toBe('w2');
    expect(workspaceTarget(targets, { x: 142, y: 20 })).toBeUndefined();
    expect(workspaceTarget(targets, { x: 100, y: 33 })).toBeUndefined();
    expect(inside({ left: 0, top: 0, width: 10, height: 10 }, { x: 10, y: 10 })).toBe(true);
    expect(inside({ left: 0, top: 0, width: 10, height: 10 }, { x: -1, y: 5 })).toBe(false);
  });

  it('spans the button and the targets, so the gap between them counts as theirs', () => {
    const button = { left: 8, top: 6, width: 28, height: 28 };
    const targets = { left: 40, top: 4, width: 204, height: 32 };
    expect(spanning([button, targets])).toEqual({ left: 8, top: 4, width: 236, height: 32 });
    expect(spanning([button])).toEqual(button);
    expect(inside(spanning([button, targets]), { x: 38, y: 20 })).toBe(true);
  });
});
