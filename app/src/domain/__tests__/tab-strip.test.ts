import { describe, expect, it } from 'vitest';
import { TabService, type TabViewPort } from '../tabs/tab-service.ts';
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

const ids = (strip: TabStrip<StripTab>): string[] => strip.all.map((each) => each.id);

describe('TabStrip', () => {
  it('lists every tab, shows the active one, and moves each tab as a unit of its own', () => {
    const strip = new TabStrip<StripTab>();
    expect(strip.shown).toEqual([]);
    expect(strip.active).toBeUndefined();
    strip.insert(tab('a'), { activate: true });
    strip.insert(tab('b'), { activate: true });
    expect(strip.shown).toEqual([]);
    expect(strip.activate('b')).toBe(true);
    expect(strip.activate('b')).toBe(false);
    expect(strip.shown).toEqual(['b']);
    expect(strip.active?.id).toBe('b');
    expect(strip.listed.map((each) => each.id)).toEqual(['a', 'b']);
    expect(strip.listed).toBe(strip.all);
    expect(strip.unitOf('a')).toEqual(['a']);
    expect(strip.unitOf('z')).toEqual([]);
    expect([strip.has('a'), strip.has('z'), strip.indexOf('b'), strip.indexOf('z')]).toEqual([
      true,
      false,
      1,
      -1,
    ]);
    expect(strip.get('a')).toEqual(tab('a'));
  });

  it('puts new tabs after the active one, background tabs in the order they open, and pinned tabs last among the pinned', () => {
    const strip = stripOf(tab('p', true), tab('a'), tab('b'));
    expect(ids(strip)).toEqual(['p', 'a', 'b']);
    // The active tab is pinned: new tabs come right after the pinned tabs.
    strip.insert(tab('c'), { activate: true });
    expect(ids(strip)).toEqual(['p', 'c', 'a', 'b']);
    strip.activate('a');
    strip.insert(tab('d'), { activate: false });
    strip.insert(tab('e'), { activate: false });
    expect(ids(strip)).toEqual(['p', 'c', 'a', 'd', 'e', 'b']);
    // Another active tab ends the line of background tabs.
    strip.activate('d');
    strip.activate('a');
    strip.insert(tab('f'), { activate: false });
    expect(ids(strip)).toEqual(['p', 'c', 'a', 'f', 'd', 'e', 'b']);
    strip.insert(tab('q', true), { activate: false });
    strip.insert(tab('g'), { activate: false, after: 'b' });
    expect(ids(strip)).toEqual(['p', 'q', 'c', 'a', 'f', 'd', 'e', 'b', 'g']);
    expect(strip.pinnedCount).toBe(2);
  });

  it('adds tabs at the end while none is active', () => {
    const strip = new TabStrip<StripTab>();
    strip.insert(tab('a'), { activate: false });
    strip.insert(tab('b'), { activate: true });
    expect(ids(strip)).toEqual(['a', 'b']);
  });

  it('steps a tab past the one next to it, and keeps pinned tabs among the pinned tabs', () => {
    const strip = stripOf(tab('p', true), tab('q', true), tab('a'), tab('b'), tab('c'));
    expect(strip.step('b', -1)).toBe(true);
    expect(ids(strip)).toEqual(['p', 'q', 'b', 'a', 'c']);
    expect(strip.step('b', 1)).toBe(true);
    expect(strip.step('b', 1)).toBe(true);
    expect(ids(strip)).toEqual(['p', 'q', 'a', 'c', 'b']);
    // At the ends of their tabs, tabs stay where they are.
    expect(strip.step('b', 1)).toBe(false);
    expect(strip.step('a', -1)).toBe(false);
    expect(strip.step('q', 1)).toBe(false);
    expect(strip.step('p', -1)).toBe(false);
    expect(ids(strip)).toEqual(['p', 'q', 'a', 'c', 'b']);
    expect(strip.step('q', -1)).toBe(true);
    expect(ids(strip)).toEqual(['q', 'p', 'a', 'c', 'b']);
    expect(strip.step('z', 1)).toBe(false);
  });

  it('closes a tab and names the tab that becomes active in place of the active one', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'));
    expect(strip.close('b')).toEqual({ tab: tab('b'), active: false, next: undefined });
    expect(strip.active?.id).toBe('a');
    expect(strip.close('a')).toEqual({ tab: tab('a'), active: true, next: tab('c') });
    expect(strip.active).toBeUndefined();
    expect(strip.shown).toEqual([]);
    strip.insert(tab('d'), { activate: false });
    strip.activate('d');
    // At the end, the left neighbour takes the place of the active tab.
    expect(strip.close('d')).toEqual({ tab: tab('d'), active: true, next: tab('c') });
    strip.activate('c');
    expect(strip.close('c')).toEqual({ tab: tab('c'), active: true, next: undefined });
    expect(strip.close('z')).toBeUndefined();
  });

  it('keeps the addresses of the last 25 closed tabs to open them again, the latest first', () => {
    const strip = stripOf(tab('keep'));
    expect(strip.canReopen).toBe(false);
    for (let index = 0; index < 30; index += 1) {
      strip.insert(tab(`t${index}`), { activate: false });
      strip.close(`t${index}`);
    }
    expect(strip.canReopen).toBe(true);
    const reopened: string[] = [];
    for (let url = strip.reopen(); url !== undefined; url = strip.reopen()) reopened.push(url);
    expect(reopened).toHaveLength(25);
    expect(reopened[0]).toBe('https://t29.example/');
    expect(reopened.at(-1)).toBe('https://t5.example/');
    expect(strip.canReopen).toBe(false);
  });

  it('moves and pins tabs, keeping the pinned tabs first', () => {
    const strip = stripOf(tab('a'), tab('b'), tab('c'));
    strip.move('a', 99);
    expect(ids(strip)).toEqual(['b', 'c', 'a']);
    strip.pin('a', true);
    expect(ids(strip)).toEqual(['a', 'b', 'c']);
    expect(strip.get('a')?.pinned).toBe(true);
    // A tab that is not pinned stays after the pinned tabs, and a pinned one among them.
    strip.move('c', 0);
    expect(ids(strip)).toEqual(['a', 'c', 'b']);
    strip.move('a', 2);
    expect(ids(strip)).toEqual(['a', 'c', 'b']);
    strip.pin('a', false);
    expect(ids(strip)).toEqual(['a', 'c', 'b']);
    expect(strip.pinnedCount).toBe(0);
    strip.move('z', 0);
    strip.pin('z', true);
    expect(ids(strip)).toEqual(['a', 'c', 'b']);
  });

  it('takes a newer state of a tab in its place, and clears every tab', () => {
    const strip = stripOf(tab('a'), tab('b'));
    strip.replace({ ...tab('b'), url: 'https://b.example/next' });
    strip.replace(tab('z'));
    expect(strip.all.map((each) => each.url)).toEqual([
      'https://a.example/',
      'https://b.example/next',
    ]);
    expect(strip.clear().map((each) => each.id)).toEqual(['a', 'b']);
    expect([strip.all.length, strip.active, strip.shown.length]).toEqual([0, undefined, 0]);
  });
});

class Views implements TabViewPort {
  readonly shown: string[] = [];
  create(): void {}
  show(id: string): void {
    this.shown.push(id);
  }
  destroy(): void {}
  load(): void {}
  run(): void {}
}

describe('TabService and its strip', () => {
  it('tells which tabs the content area shows and the strip lists, and moves a tab as a unit', () => {
    const views = new Views();
    const tabs = new TabService(views, 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    expect(tabs.shown).toEqual([b]);
    expect(tabs.listed.map((each) => each.id)).toEqual([a, b]);
    expect(tabs.unitOf(a)).toEqual([a]);
    expect(tabs.unitOf('t999')).toEqual([]);
    expect(views.shown).toEqual([a, b]);
  });

  it('steps a tab with a change only when it moved, and refuses a tab it does not have', () => {
    const tabs = new TabService(new Views(), 'about:blank');
    const a = tabs.open('https://a.example/');
    const b = tabs.open('https://b.example/');
    let changes = 0;
    let kept = 0;
    tabs.onDidChange(() => (changes += 1));
    tabs.onDidChangeKept(() => (kept += 1));
    expect(tabs.step(b, -1)).toBe(true);
    expect(tabs.all.map((each) => each.id)).toEqual([b, a]);
    expect(tabs.step(b, -1)).toBe(false);
    expect([changes, kept]).toEqual([1, 1]);
    expect(() => tabs.step('t999', 1)).toThrow('Unknown tab t999');
    expect(() => tabs.open('https://c.example/', { after: 't999' })).toThrow('Unknown tab t999');
  });
});
