import { describe, expect, it } from 'vitest';
import { TabService, type SplitPair, type TabViewPort } from '../tabs/tab-service.ts';
import { TabStrip, type StripTab } from '../tabs/tab-strip.ts';

const tab = (id: string, pinned = false): StripTab => ({
  id,
  url: `https://${id}.example/`,
  pinned,
});

/** A strip with tabs in this order, the first one active. */
function stripOf(...tabs: StripTab[]): TabStrip<StripTab> {
  const strip = new TabStrip<StripTab>();
  for (const each of tabs) strip.insert(each, { activate: false });
  const [first] = tabs;
  if (first !== undefined) strip.activate(first.id);
  return strip;
}

const order = (strip: TabStrip<StripTab>): string[] => strip.all.map((each) => each.id);

/** Views that record what the tabs show, with the pair that shows beside the tab. */
class FakeViews implements TabViewPort {
  readonly log: string[] = [];
  create(): void {}
  show(id: string, split?: SplitPair): void {
    this.log.push(split === undefined ? `show ${id}` : `show ${id} ${split.start}|${split.end}`);
  }
  destroy(id: string): void {
    this.log.push(`destroy ${id}`);
  }
  load(): void {}
  run(): void {}
  sleep(): boolean {
    return true;
  }
}

/** A window with tabs a to e, the first one active, and what its views were asked. */
function serviceWith(count = 5): { tabs: TabService; views: FakeViews; ids: string[] } {
  const views = new FakeViews();
  const tabs = new TabService(views, 'about:blank');
  const opened = ['a', 'b', 'c', 'd', 'e']
    .slice(0, count)
    .map((name) => tabs.open(`https://${name}.example/`, { activate: false }));
  tabs.activate(opened[0] ?? '');
  views.log.length = 0;
  return { tabs, views, ids: opened };
}

describe('TabStrip pairs', () => {
  it('moves the added tab right after the tab that stays, which keeps its place', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'), tab('d'));
    expect(strip.split('b', 'd')).toBe(true);
    expect(order(strip)).toEqual(['a', 'b', 'd', 'c']);
    expect(strip.splits).toEqual([{ start: 'b', end: 'd', ratio: 0.5 }]);
    expect(strip.splitOf('d')).toEqual({ start: 'b', end: 'd', ratio: 0.5 });
    expect(strip.splitOf('a')).toBeUndefined();
    expect(strip.unitOf('b')).toEqual(['b', 'd']);
    expect(strip.unitOf('d')).toEqual(['b', 'd']);
    expect(strip.unitOf('a')).toEqual(['a']);
    // A tab from before the one that stays moves after it as well.
    expect(strip.split('c', 'a', 0.3)).toBe(true);
    expect(order(strip)).toEqual(['b', 'd', 'c', 'a']);
    expect(strip.splits).toEqual([
      { start: 'b', end: 'd', ratio: 0.5 },
      { start: 'c', end: 'a', ratio: 0.3 },
    ]);
  });

  it('puts the added tab in the place of a partner, which stays open next to the pair', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'), tab('d'));
    strip.split('a', 'b', 0.3);
    // (keep, P) becomes [keep, add, P].
    expect(strip.split('a', 'd')).toBe(true);
    expect(order(strip)).toEqual(['a', 'd', 'b', 'c']);
    expect(strip.splits).toEqual([{ start: 'a', end: 'd', ratio: 0.3 }]);
    // (P, keep) becomes [P, add, keep].
    expect(strip.split('d', 'c')).toBe(true);
    expect(order(strip)).toEqual(['a', 'c', 'd', 'b']);
    expect(strip.splits).toEqual([{ start: 'c', end: 'd', ratio: 0.3 }]);
    // A tab of another pair leaves it.
    strip.split('a', 'b');
    expect(strip.splits).toEqual([
      { start: 'a', end: 'b', ratio: 0.5 },
      { start: 'c', end: 'd', ratio: 0.3 },
    ]);
    expect(order(strip)).toEqual(['a', 'b', 'c', 'd']);
    // The tab that joins leaves its own pair, whose other tab stays where it is.
    expect(strip.split('b', 'c')).toBe(true);
    expect(order(strip)).toEqual(['a', 'c', 'b', 'd']);
    expect(strip.splits).toEqual([{ start: 'c', end: 'b', ratio: 0.5 }]);
  });

  it('pairs no pinned tab, no tab with itself and no pair again', () => {
    const strip = stripOf(tab('p', true), tab('a'), tab('b'));
    expect(strip.split('p', 'a')).toBe(false);
    expect(strip.split('a', 'p')).toBe(false);
    expect(strip.split('a', 'a')).toBe(false);
    expect(strip.split('a', 'z')).toBe(false);
    expect(strip.split('a', 'b')).toBe(true);
    expect(strip.split('b', 'a')).toBe(false);
    expect(strip.splits).toEqual([{ start: 'a', end: 'b', ratio: 0.5 }]);
    // Pinning a side ends its pair.
    strip.pin('b', true);
    expect(strip.splits).toEqual([]);
    expect(order(strip)).toEqual(['p', 'b', 'a']);
  });

  it('shows the active tab with its partner, left first', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'));
    strip.split('b', 'c');
    expect(strip.shown).toEqual(['a']);
    strip.activate('c');
    expect(strip.shown).toEqual(['b', 'c']);
    strip.activate('b');
    expect(strip.shown).toEqual(['b', 'c']);
  });

  it('swaps the sides with their widths and keeps a share within its limits', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'));
    strip.split('a', 'b', 0.3);
    expect(strip.swapSplit('b')).toBe(true);
    expect(order(strip)).toEqual(['b', 'a', 'c']);
    expect(strip.splits).toEqual([{ start: 'b', end: 'a', ratio: 0.7 }]);
    expect(strip.swapSplit('c')).toBe(false);
    expect(strip.resizeSplit('a', 0.95)).toBe(true);
    expect(strip.splitOf('a')?.ratio).toBe(0.8);
    expect(strip.resizeSplit('a', 0.9)).toBe(false);
    expect(strip.resizeSplit('a', 0.1)).toBe(true);
    expect(strip.splitOf('a')?.ratio).toBe(0.2);
    expect(strip.resizeSplit('c', 0.5)).toBe(false);
    expect(strip.unsplit('a')).toBe(true);
    expect(strip.unsplit('a')).toBe(false);
    expect(strip.splits).toEqual([]);
  });

  it('puts new tabs after a pair, never between its tabs', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'));
    strip.split('a', 'b');
    // After the active start tab, and after a start tab that is named.
    strip.insert(tab('d'), { activate: true });
    expect(order(strip)).toEqual(['a', 'b', 'd', 'c']);
    strip.insert(tab('e'), { activate: false, after: 'a' });
    expect(order(strip)).toEqual(['a', 'b', 'e', 'd', 'c']);
    // Background tabs line up after the pair in the order they open.
    strip.insert(tab('f'), { activate: false });
    strip.insert(tab('g'), { activate: false });
    expect(order(strip)).toEqual(['a', 'b', 'e', 'f', 'g', 'd', 'c']);
    // A pair among the background tabs: the next background tab goes after it.
    strip.split('f', 'c');
    expect(order(strip)).toEqual(['a', 'b', 'e', 'f', 'c', 'g', 'd']);
    strip.insert(tab('h'), { activate: false, after: 'e' });
    expect(order(strip)).toEqual(['a', 'b', 'e', 'h', 'f', 'c', 'g', 'd']);
    strip.activate('e');
    strip.insert(tab('i'), { activate: false });
    expect(order(strip)).toEqual(['a', 'b', 'e', 'i', 'h', 'f', 'c', 'g', 'd']);
  });

  it('moves both tabs of a pair, within the tabs that are not pinned, and never into a pair', () => {
    const strip = stripOf(tab('p', true), tab('a'), tab('b'), tab('c'), tab('d'), tab('e'));
    strip.split('a', 'b');
    strip.split('d', 'e');
    expect(order(strip)).toEqual(['p', 'a', 'b', 'c', 'd', 'e']);
    // Either tab moves the pair, counted without it.
    strip.move('b', 2);
    expect(order(strip)).toEqual(['p', 'c', 'a', 'b', 'd', 'e']);
    strip.move('a', 0);
    expect(order(strip)).toEqual(['p', 'a', 'b', 'c', 'd', 'e']);
    strip.move('a', 99);
    expect(order(strip)).toEqual(['p', 'c', 'd', 'e', 'a', 'b']);
    // A place between the tabs of another pair moves after it.
    strip.move('c', 2);
    expect(order(strip)).toEqual(['p', 'd', 'e', 'c', 'a', 'b']);
    strip.move('c', 5);
    expect(order(strip)).toEqual(['p', 'd', 'e', 'a', 'b', 'c']);
    strip.move('a', 2);
    expect(order(strip)).toEqual(['p', 'd', 'e', 'a', 'b', 'c']);
    expect(strip.splits).toEqual([
      { start: 'd', end: 'e', ratio: 0.5 },
      { start: 'a', end: 'b', ratio: 0.5 },
    ]);
  });

  it('steps a tab or a pair past the tab or the pair next to it, also at the ends and the pinned tabs', () => {
    const strip = stripOf(tab('p', true), tab('a'), tab('b'), tab('c'), tab('d'), tab('e'));
    strip.split('b', 'c');
    strip.split('d', 'e');
    // A tab steps past a pair as a whole.
    expect(strip.step('a', 1)).toBe(true);
    expect(order(strip)).toEqual(['p', 'b', 'c', 'a', 'd', 'e']);
    // A pair steps past a pair, from either of its tabs.
    expect(strip.step('e', -1)).toBe(true);
    expect(order(strip)).toEqual(['p', 'b', 'c', 'd', 'e', 'a']);
    expect(strip.step('c', 1)).toBe(true);
    expect(order(strip)).toEqual(['p', 'd', 'e', 'b', 'c', 'a']);
    // At the end and at the pinned tabs, nothing moves.
    expect(strip.step('d', -1)).toBe(false);
    expect(strip.step('a', 1)).toBe(false);
    expect(order(strip)).toEqual(['p', 'd', 'e', 'b', 'c', 'a']);
  });

  it('ends the pair of a tab that closes, and activates the partner of the active tab', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'), tab('d'));
    strip.split('b', 'c');
    strip.activate('c');
    expect(strip.close('c')).toMatchObject({
      active: true,
      next: tab('b'),
      pair: { start: 'b', end: 'c' },
    });
    expect(strip.splits).toEqual([]);
    strip.split('a', 'b');
    strip.activate('d');
    expect(strip.close('a')).toMatchObject({
      active: false,
      next: undefined,
      pair: { start: 'a' },
    });
    expect(strip.splits).toEqual([]);
    expect(strip.close('d')).toMatchObject({ active: true, next: tab('b'), pair: undefined });
    strip.split('b', 'b');
    expect(strip.clear()).toHaveLength(1);
    expect(strip.splits).toEqual([]);
  });
});

describe('TabService pairs', () => {
  it('shows the pair when the active tab is in it, and the active tab alone without one', () => {
    const { tabs, views, ids } = serviceWith();
    const [a = '', b = '', c = ''] = ids;
    expect(tabs.split(a, c)).toBe(true);
    expect(tabs.all.map((each) => each.id)).toEqual([a, c, b, ids[3], ids[4]]);
    expect(views.log).toEqual([`show ${a} ${a}|${c}`]);
    expect(tabs.shown).toEqual([a, c]);
    tabs.activate(c);
    tabs.activate(b);
    tabs.activate(a);
    expect(views.log.slice(1)).toEqual([`show ${c} ${a}|${c}`, `show ${b}`, `show ${a} ${a}|${c}`]);
    // A pair in the background changes nothing that shows.
    views.log.length = 0;
    tabs.split(ids[3] ?? '', ids[4] ?? '');
    tabs.swapSplit(ids[3] ?? '');
    expect(views.log).toEqual([]);
    tabs.swapSplit(c);
    expect(views.log).toEqual([`show ${a} ${c}|${a}`]);
    tabs.unsplit(a);
    expect(views.log.at(-1)).toBe(`show ${a}`);
    expect(tabs.splits).toEqual([{ start: ids[4], end: ids[3], ratio: 0.5 }]);
    expect(tabs.splitOf(ids[3] ?? '')).toEqual({ start: ids[4], end: ids[3], ratio: 0.5 });
  });

  it('gives the active side the whole area when the other one closes, and the partner the focus when the active side closes', () => {
    const { tabs, views, ids } = serviceWith();
    const [a = '', b = '', c = ''] = ids;
    tabs.split(a, b);
    views.log.length = 0;
    tabs.close(b);
    expect(views.log).toEqual([`destroy ${b}`, `show ${a}`]);
    tabs.split(a, c);
    tabs.activate(c);
    views.log.length = 0;
    tabs.close(c);
    expect(views.log).toEqual([`destroy ${c}`, `show ${a}`]);
    expect(tabs.active?.id).toBe(a);
    // A pair in the background only ends.
    tabs.split(ids[3] ?? '', ids[4] ?? '');
    views.log.length = 0;
    tabs.close(ids[4] ?? '');
    expect(views.log).toEqual([`destroy ${ids[4]}`]);
    expect(tabs.splits).toEqual([]);
  });

  it('ends the pair of a tab that is pinned, and pairs no pinned tab', () => {
    const { tabs, views, ids } = serviceWith();
    const [a = '', b = ''] = ids;
    tabs.split(a, b);
    views.log.length = 0;
    tabs.pin(b, true);
    expect(tabs.splits).toEqual([]);
    expect(views.log).toEqual([`show ${a}`]);
    expect(tabs.split(a, b)).toBe(false);
    expect(tabs.split(b, a)).toBe(false);
  });

  it('opens tabs after the pair of the active tab and after a named start tab', () => {
    const { tabs, ids } = serviceWith(3);
    const [a = '', b = '', c = ''] = ids;
    tabs.split(a, b);
    const opened = tabs.open('https://new.example/');
    expect(tabs.all.map((each) => each.id)).toEqual([a, b, opened, c]);
    tabs.activate(a);
    const after = tabs.open('https://after.example/', { after: a, activate: false });
    expect(tabs.all.map((each) => each.id)).toEqual([a, b, after, opened, c]);
  });

  it('moves and steps a pair as one, and keeps the session up to date', () => {
    const { tabs, ids } = serviceWith(4);
    const [a = '', b = '', c = '', d = ''] = ids;
    let kept = 0;
    tabs.onDidChangeKept(() => (kept += 1));
    tabs.split(b, c);
    expect(kept).toBe(1);
    tabs.move(c, 0);
    expect(tabs.all.map((each) => each.id)).toEqual([b, c, a, d]);
    expect(tabs.step(b, 1)).toBe(true);
    expect(tabs.all.map((each) => each.id)).toEqual([a, b, c, d]);
    expect(tabs.unitOf(c)).toEqual([b, c]);
    expect(tabs.unitOf(a)).toEqual([a]);
    kept = 0;
    tabs.resizeSplit(b, 0.3);
    tabs.resizeSplit(b, 0.3);
    tabs.swapSplit(b);
    tabs.unsplit(c);
    tabs.unsplit(c);
    expect(kept).toBe(3);
  });
});
