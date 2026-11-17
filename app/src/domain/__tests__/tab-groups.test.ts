import { describe, expect, it } from 'vitest';
import type { WindowCommand } from '../../shared/shortcuts.ts';
import { swatches } from '../../shared/swatches.ts';
import { canRun, type CommandContext } from '../commands/availability.ts';
import {
  closeGroup,
  editGroups,
  GroupedTabStrip,
  groupName,
  groupsOf,
  pickSwatch,
  restoreGroups,
  type GroupedTab,
  type TabGroup,
} from '../tabs/tab-groups.ts';
import { TabService, type SplitPair, type Tab, type TabViewPort } from '../tabs/tab-service.ts';
import { TabStrip } from '../tabs/tab-strip.ts';

const tab = (id: string, pinned = false): GroupedTab => ({
  id,
  url: `https://${id}.example/`,
  title: id.toUpperCase(),
  pinned,
  group: null,
});

/** A strip with groups and tabs in this order, the first one active. */
function stripOf(...names: string[]): GroupedTabStrip<GroupedTab> {
  const strip = new GroupedTabStrip<GroupedTab>();
  for (const name of names) strip.insert(tab(name), { activate: false });
  const [first] = names;
  if (first !== undefined) strip.activate(first);
  return strip;
}

/**
 * The tabs of a strip as text: `[a b]` is a group that shows its tabs, `{a b}` one that hides
 * them, `*` marks the active tab and `^` a pinned one.
 */
function layout(
  tabs: readonly {
    readonly id: string;
    readonly pinned: boolean;
    readonly group: TabGroup | null;
  }[],
  active?: string,
): string {
  const parts: string[] = [];
  let open: TabGroup | null = null;
  for (const each of tabs) {
    if (open !== null && each.group?.id !== open.id) {
      parts.push(open.collapsed ? '}' : ']');
      open = null;
    }
    if (each.group !== null && open === null) {
      open = each.group;
      parts.push(open.collapsed ? '{' : '[');
    }
    parts.push(`${each.pinned ? '^' : ''}${each.id}${each.id === active ? '*' : ''}`);
  }
  if (open !== null) parts.push(open.collapsed ? '}' : ']');
  return parts
    .join(' ')
    .replaceAll('[ ', '[')
    .replaceAll('{ ', '{')
    .replaceAll(' ]', ']')
    .replaceAll(' }', '}');
}

const shape = (strip: GroupedTabStrip<GroupedTab>): string => layout(strip.all, strip.active?.id);

/** Every rule that a strip with groups keeps, as the problems it finds. */
function problems(
  tabs: readonly {
    readonly id: string;
    readonly pinned: boolean;
    readonly group: TabGroup | null;
  }[],
  active: string | undefined,
  splits: readonly SplitPair[],
): string[] {
  const found: string[] = [];
  const firstUnpinned = tabs.findIndex((each) => !each.pinned);
  if (firstUnpinned !== -1 && tabs.slice(firstUnpinned).some((each) => each.pinned)) {
    found.push('a pinned tab after a tab that is not pinned');
  }
  if (tabs.some((each) => each.pinned && each.group !== null))
    found.push('a pinned tab in a group');
  const seen = new Map<string, TabGroup>();
  tabs.forEach((each, at) => {
    const group = each.group;
    if (group === null) return;
    const known = seen.get(group.id);
    if (known !== undefined && tabs[at - 1]?.group?.id !== group.id) {
      found.push(`group ${group.id} does not stand together`);
    }
    if (known !== undefined && JSON.stringify(known) !== JSON.stringify(group)) {
      found.push(`group ${group.id} differs between its tabs`);
    }
    seen.set(group.id, group);
  });
  const shown = tabs.find((each) => each.id === active);
  if (shown?.group?.collapsed === true) found.push('the active tab is in a collapsed group');
  for (const pair of splits) {
    const start = tabs.findIndex((each) => each.id === pair.start);
    const end = tabs.findIndex((each) => each.id === pair.end);
    if (end !== start + 1) found.push(`pair ${pair.start}|${pair.end} apart`);
    if (tabs[start]?.group?.id !== tabs[end]?.group?.id) {
      found.push(`pair ${pair.start}|${pair.end} in two groups`);
    }
  }
  return found;
}

/** Views that record what the tabs show. */
class FakeViews implements TabViewPort {
  readonly log: string[] = [];
  readonly live = new Set<string>();
  create(id: string, _url: string, lazy?: boolean): void {
    this.live.add(id);
    this.log.push(lazy === true ? `create ${id} lazy` : `create ${id}`);
  }
  show(id: string, split?: SplitPair): void {
    if (!this.live.has(id)) throw new Error(`show of ${id}, which has no view`);
    this.log.push(split === undefined ? `show ${id}` : `show ${id} ${split.start}|${split.end}`);
  }
  destroy(id: string): void {
    this.live.delete(id);
    this.log.push(`destroy ${id}`);
  }
  load(): void {}
  run(): void {}
  sleep(): boolean {
    return true;
  }
}

/** A window with tabs a to e, the first one active, and what its views were asked. */
function windowWith(
  names = ['a', 'b', 'c', 'd', 'e'],
  onLastClosed?: () => void,
): { tabs: TabService; views: FakeViews; id: (name: string) => string } {
  const views = new FakeViews();
  const tabs = new TabService(views, 'about:blank', onLastClosed);
  const opened = new Map(
    names.map((name) => [name, tabs.open(`https://${name}.example/`, { activate: false })]),
  );
  tabs.activate(opened.get(names[0] ?? '') ?? '');
  views.log.length = 0;
  return { tabs, views, id: (name) => opened.get(name) ?? name };
}

/** The tabs of a window as text, with their names instead of their ids. */
function shapeOf(tabs: TabService): string {
  const named = tabs.all.map((each) => ({ ...each, id: nameOf(each) }));
  const active = tabs.active;
  return layout(named, active === undefined ? undefined : nameOf(active));
}

function nameOf(each: Tab): string {
  return /^https:\/\/([a-z]+)\.example\/$/.exec(each.url)?.[1] ?? each.url;
}

describe('groups of tabs', () => {
  it('names groups within their limit and picks the color that the groups use least', () => {
    expect(groupName('  Work  ')).toBe('Work');
    expect(groupName('x'.repeat(60))).toHaveLength(50);
    expect(groupName(`${'x'.repeat(49)}  y`)).toBe('x'.repeat(49));
    expect(pickSwatch([])).toBe('blue');
    expect(pickSwatch(['blue'])).toBe('teal');
    expect(pickSwatch([...swatches])).toBe('blue');
    expect(pickSwatch([...swatches, 'blue', 'teal', 'red'])).toBe('green');
    const a: TabGroup = { id: 'g1', name: 'A', color: 'red', collapsed: false };
    const b: TabGroup = { id: 'g2', name: 'B', color: 'teal', collapsed: true };
    expect(groupsOf([{ group: a }, { group: null }, { group: a }, { group: b }])).toEqual([a, b]);
  });

  it('puts a tab in a new group in its place, with the least used color', () => {
    const strip = stripOf('a', 'b', 'c', 'd');
    const first = strip.createGroup('b');
    expect(first).toEqual({ id: 'g1', name: '', color: 'blue', collapsed: false });
    expect(shape(strip)).toBe('a* [b] c d');
    expect(strip.createGroup('d', { name: ' Work ' })).toMatchObject({
      name: 'Work',
      color: 'teal',
    });
    expect(shape(strip)).toBe('a* [b] c [d]');
    expect(strip.createGroup('c', { color: 'red' })?.color).toBe('red');
    expect(strip.groups.map((group) => group.color)).toEqual(['blue', 'red', 'teal']);
    // Pinned tabs and tabs that are not there form no group.
    strip.pin('a', true);
    expect(strip.createGroup('a')).toBeUndefined();
    expect(strip.createGroup('z')).toBeUndefined();
  });

  it('takes a tab between two tabs of a group out after that group for a new group', () => {
    const strip = stripOf('a', 'b', 'c', 'd');
    const group = strip.createGroup('a');
    strip.addToGroup('b', group?.id ?? '');
    strip.addToGroup('c', group?.id ?? '');
    expect(shape(strip)).toBe('[a* b c] d');
    strip.createGroup('b');
    expect(shape(strip)).toBe('[a* c] [b] d');
    // At an edge of its group, the tab stays where it is.
    strip.createGroup('c');
    expect(shape(strip)).toBe('[a*] [c] [b] d');
  });

  it('adds tabs at the end of a group, takes them out after it and ends groups in place', () => {
    const strip = stripOf('a', 'b', 'c', 'd', 'e');
    const group = strip.createGroup('b')?.id ?? '';
    expect(strip.addToGroup('e', group)).toBe(true);
    expect(shape(strip)).toBe('a* [b e] c d');
    expect(strip.addToGroup('a', group)).toBe(true);
    expect(shape(strip)).toBe('[b e a*] c d');
    // A tab in the group, a pinned tab and an unknown group change nothing.
    expect(strip.addToGroup('a', group)).toBe(false);
    expect(strip.addToGroup('c', 'g9')).toBe(false);
    strip.pin('d', true);
    expect(strip.addToGroup('d', group)).toBe(false);
    expect(strip.removeFromGroup('b')).toBe(true);
    expect(shape(strip)).toBe('^d [e a*] b c');
    expect(strip.removeFromGroup('b')).toBe(false);
    expect(strip.ungroup(group)).toBe(true);
    expect(strip.ungroup(group)).toBe(false);
    expect(shape(strip)).toBe('^d e a* b c');
    // A group that hides its tabs shows them again for the tab that joins it.
    const hidden = strip.createGroup('b')?.id ?? '';
    strip.setCollapsed(hidden, true);
    expect(strip.addToGroup('a', hidden)).toBe(true);
    expect(shape(strip)).toBe('^d e [b a*] c');
  });

  it('renames and recolors a group on every one of its tabs', () => {
    const strip = stripOf('a', 'b', 'c');
    const group = strip.createGroup('a')?.id ?? '';
    strip.addToGroup('b', group);
    expect(strip.updateGroup(group, { name: '  News ' })).toBe(true);
    expect(strip.updateGroup(group, { name: 'News' })).toBe(false);
    expect(strip.updateGroup(group, { color: 'green' })).toBe(true);
    expect(strip.updateGroup('g9', { color: 'green' })).toBe(false);
    expect(strip.all.map((each) => each.group)).toEqual([
      { id: group, name: 'News', color: 'green', collapsed: false },
      { id: group, name: 'News', color: 'green', collapsed: false },
      null,
    ]);
  });

  it('places new tabs in the group of the tab they follow or that opened them, and new tabs in front after the group', () => {
    const strip = stripOf('a', 'b', 'c');
    const group = strip.createGroup('a')?.id ?? '';
    strip.addToGroup('b', group);
    expect(shape(strip)).toBe('[a* b] c');
    // New tab to the right of a tab, and its duplicate, stay in its group.
    strip.insert(tab('d'), { activate: false, after: 'a' });
    expect(shape(strip)).toBe('[a* d b] c');
    // A link of the active tab in the background, and one that names no opener, line up after
    // the tabs that it opened in the background before.
    strip.insert(tab('e'), { activate: false, opener: 'a' });
    strip.insert(tab('f'), { activate: false });
    expect(shape(strip)).toBe('[a* d e f b] c');
    // A link in front from a tab of the group.
    strip.insert(tab('g'), { activate: true, opener: 'b' });
    expect(shape(strip)).toBe('[a* d e f b g] c');
    // The New tab button, Ctrl+T and links from other apps open after the group, outside it.
    strip.insert(tab('h'), { activate: true });
    expect(shape(strip)).toBe('[a* d e f b g] h c');
    // A tab that a tab outside every group opens goes where it goes without groups.
    strip.activate('c');
    strip.insert(tab('i'), { activate: false, opener: 'c' });
    strip.insert(tab('j'), { activate: false, opener: 'h' });
    expect(shape(strip)).toBe('[a d e f b g] h c* i j');
    // A group named for the new tab takes it at its end; a pinned tab never joins one.
    strip.insert(tab('k'), { activate: false, group: strip.group(group) });
    strip.insert(tab('p', true), { activate: false, after: 'a' });
    expect(shape(strip)).toBe('^p [a d e f b g k] h c* i j');
  });

  it('opens a new tab in front between groups, never inside one', () => {
    const strip = stripOf('a', 'b', 'c', 'd');
    const first = strip.createGroup('a')?.id ?? '';
    strip.addToGroup('b', first);
    const second = strip.createGroup('c')?.id ?? '';
    strip.addToGroup('d', second);
    strip.activate('b');
    strip.insert(tab('e'), { activate: true });
    expect(shape(strip)).toBe('[a b*] e [c d]');
    // A group that the strip does not have yet forms where a new tab in front goes.
    strip.insert(tab('f'), {
      activate: true,
      group: { id: 'g9', name: 'New', color: 'red', collapsed: false },
    });
    expect(shape(strip)).toBe('[a b*] [f] e [c d]');
  });

  it('closes the active tab for the nearest tab that the strip shows, to the right first', () => {
    const strip = stripOf('a', 'b', 'c', 'd');
    const group = strip.createGroup('c')?.id ?? '';
    strip.addToGroup('d', group);
    strip.activate('b');
    strip.setCollapsed(group, true);
    expect(shape(strip)).toBe('a b* {c d}');
    expect(strip.close('b')).toMatchObject({ active: true, next: { id: 'a' } });
    strip.activate('a');
    expect(strip.close('a')).toMatchObject({ active: true, next: undefined });
    // A tab that is not active, and one that is not there.
    expect(strip.close('c')).toMatchObject({ active: false });
    expect(strip.close('z')).toBeUndefined();
  });

  it('keeps a closed group as one entry, which opens again with its name and color', () => {
    const { tabs, views, id } = windowWith();
    tabs.update(id('c'), { title: 'C' });
    editGroups(tabs, (strip) => {
      const group = strip.createGroup(id('b'), { name: 'Work', color: 'green' })?.id ?? '';
      strip.addToGroup(id('c'), group);
    });
    tabs.activate(id('c'));
    expect(shapeOf(tabs)).toBe('a [b c*] d e');
    views.log.length = 0;
    closeGroup(tabs, tabs.active?.group?.id ?? '');
    expect(shapeOf(tabs)).toBe('a d* e');
    expect(views.log).toEqual([`destroy ${id('b')}`, `destroy ${id('c')}`, `show ${id('d')}`]);
    expect(tabs.canReopen).toBe(true);
    views.log.length = 0;
    const reopened = tabs.reopenClosed();
    expect(shapeOf(tabs)).toBe('a d [b* c] e');
    expect(tabs.active?.id).toBe(reopened);
    expect(tabs.active?.group).toMatchObject({ name: 'Work', color: 'green', collapsed: false });
    // The other tabs of the group load once they are shown, with their titles until then.
    const others = tabs.all.filter((each) => each.group !== null && each.id !== reopened);
    expect(others.map((each) => [each.sleeping, each.title])).toEqual([[true, 'C']]);
    expect(views.log.filter((entry) => entry.startsWith('create'))).toEqual([
      `create ${reopened ?? ''}`,
      `create ${others[0]?.id ?? ''} lazy`,
    ]);
  });

  it('opens a closed tab again in its group while the group is there, and else outside groups', () => {
    const { tabs, id } = windowWith(['a', 'b', 'c', 'd']);
    editGroups(tabs, (strip) => {
      const group = strip.createGroup(id('b'))?.id ?? '';
      strip.addToGroup(id('c'), group);
    });
    tabs.close(id('b'));
    tabs.reopenClosed();
    expect(shapeOf(tabs)).toBe('a [c b*] d');
    tabs.close(id('c'));
    const group = tabs.active?.group?.id ?? '';
    closeGroup(tabs, group);
    // The group closed after the tab: first the group comes back after the active tab, as a
    // new tab does, then the tab outside it, as its group is gone.
    tabs.reopenClosed();
    expect(shapeOf(tabs)).toBe('a d [b*]');
    tabs.activate(id('a'));
    tabs.reopenClosed();
    expect(shapeOf(tabs)).toBe('a c* d [b]');
    expect(tabs.reopenClosed()).toBeUndefined();
  });

  it('takes over the closed tabs of the strip that had no groups', () => {
    const { tabs, id } = windowWith(['a', 'b']);
    tabs.close(id('b'));
    editGroups(tabs, (strip) => strip.createGroup(id('a')));
    expect(tabs.canReopen).toBe(true);
    tabs.reopenClosed();
    expect(shapeOf(tabs)).toBe('[a] b*');
  });

  it('closes a group of a popup with the popup, and gives a window without shown tabs a new tab', () => {
    let closedWindow = 0;
    const popup = windowWith(['a'], () => (closedWindow += 1));
    closeGroup(
      popup.tabs,
      editGroups(popup.tabs, (strip) => strip.createGroup(popup.id('a')))?.id ?? '',
    );
    expect(closedWindow).toBe(1);
    expect(popup.tabs.all).toEqual([]);
    const window = windowWith(['a', 'b']);
    editGroups(window.tabs, (strip) => {
      const first = strip.createGroup(window.id('a'))?.id ?? '';
      const second = strip.createGroup(window.id('b'))?.id ?? '';
      strip.setCollapsed(second, true);
      closeGroup(window.tabs, first);
    });
    expect(shapeOf(window.tabs)).toBe('about:blank* {b}');
    expect(window.tabs.active?.group).toBeNull();
  });

  it('hides the tabs of a collapsed group from the shortcuts and moves the active tab out of it', () => {
    const { tabs, views, id } = windowWith(['a', 'b', 'c', 'd']);
    const group =
      editGroups(tabs, (strip) => {
        const created = strip.createGroup(id('b'))?.id ?? '';
        strip.addToGroup(id('c'), created);
        return created;
      }) ?? '';
    tabs.activate(id('c'));
    views.log.length = 0;
    expect(editGroups(tabs, (strip) => strip.setCollapsed(group, true))).toBe(true);
    expect(editGroups(tabs, (strip) => strip.setCollapsed(group, true))).toBe(false);
    expect(shapeOf(tabs)).toBe('a {b c} d*');
    expect(views.log).toEqual([`show ${id('d')}`]);
    expect(tabs.listed.map(nameOf)).toEqual(['a', 'd']);
    expect(tabs.unitOf(id('b'))).toEqual([id('b'), id('c')]);
    // Without a tab after it, the tab before the group becomes active.
    tabs.close(id('d'));
    expect(shapeOf(tabs)).toBe('a* {b c}');
    // Showing a tab of a collapsed group opens the group.
    tabs.activate(id('c'));
    expect(shapeOf(tabs)).toBe('a [b c*]');
    expect(tabs.listed.map(nameOf)).toEqual(['a', 'b', 'c']);
    expect(editGroups(tabs, (strip) => strip.setCollapsed('g9', true))).toBe(false);
  });

  it('opens a new tab right after a collapsed group when it hid every tab', () => {
    const { tabs, id } = windowWith(['a', 'b', 'c']);
    editGroups(tabs, (strip) => {
      const first = strip.createGroup(id('a'))?.id ?? '';
      strip.addToGroup(id('b'), first);
      const second = strip.createGroup(id('c'))?.id ?? '';
      strip.setCollapsed(second, true);
      strip.setCollapsed(first, true);
    });
    expect(shapeOf(tabs)).toBe('{a b} about:blank* {c}');
  });

  it('pins a tab out of its group and keeps both tabs of a split view in one group', () => {
    const strip = stripOf('a', 'b', 'c', 'd');
    const group = strip.createGroup('b')?.id ?? '';
    strip.addToGroup('c', group);
    strip.pin('c', true);
    expect(shape(strip)).toBe('^c a* [b] d');
    // The tab that joins a split view takes the group of the tab that stays.
    expect(strip.split('b', 'd')).toBe(true);
    expect(shape(strip)).toBe('^c a* [b d]');
    expect(strip.split('a', 'b')).toBe(true);
    expect(shape(strip)).toBe('^c a* b [d]');
    expect(strip.split('c', 'a')).toBe(false);
  });

  it('moves tabs into, out of and past groups with an explicit, a missing or no group', () => {
    const strip = stripOf('a', 'b', 'c', 'd', 'e');
    const group = strip.createGroup('b')?.id ?? '';
    strip.addToGroup('c', group);
    strip.addToGroup('d', group);
    expect(shape(strip)).toBe('a* [b c d] e');
    // Between two tabs of the group, a tab joins it.
    strip.move('a', 1);
    expect(shape(strip)).toBe('[b a* c d] e');
    // An explicit group takes the place into its tabs, and no group takes it out after them.
    strip.move('e', 0, group);
    expect(shape(strip)).toBe('[e b a* c d]');
    strip.move('a', 2, null);
    expect(shape(strip)).toBe('[e b c d] a*');
    // At an edge of its group, a tab keeps it without a group named; away from it, it leaves.
    strip.move('d', 0);
    expect(shape(strip)).toBe('[d e b c] a*');
    strip.move('e', 4);
    expect(shape(strip)).toBe('[d b c] a* e');
    // The only tab of a group keeps it wherever it goes outside other groups, and joins the
    // group whose tabs stand on both sides of its new place.
    const alone = strip.createGroup('e')?.id ?? '';
    strip.move('e', 3);
    expect(shape(strip)).toBe('[d b c] [e] a*');
    strip.move('e', 0, alone);
    expect(shape(strip)).toBe('[e] [d b c] a*');
    strip.move('e', 2);
    expect(shape(strip)).toBe('[d b e c] a*');
    // A pinned tab stays among the pinned tabs.
    strip.pin('a', true);
    strip.move('a', 3);
    expect(shape(strip)).toBe('^a* [d b e c]');
  });

  it('moves a collapsed group as a whole and lets no tab join it by a move', () => {
    const strip = stripOf('a', 'b', 'c', 'd', 'e');
    const group = strip.createGroup('b')?.id ?? '';
    strip.addToGroup('c', group);
    strip.setCollapsed(group, true);
    expect(shape(strip)).toBe('a* {b c} d e');
    strip.move('c', 2);
    expect(shape(strip)).toBe('a* d {b c} e');
    strip.move('e', 3);
    expect(shape(strip)).toBe('a* d {b c} e');
    strip.move('e', 3, group);
    expect(shape(strip)).toBe('a* d {b c} e');
    strip.move('a', 2, null);
    expect(shape(strip)).toBe('d {b c} a* e');
    // Another group's middle moves a collapsed group after that group.
    const other = strip.createGroup('a')?.id ?? '';
    strip.addToGroup('e', other);
    strip.move('b', 3);
    expect(shape(strip)).toBe('d [a* e] {b c}');
    strip.move('b', 1, other);
    expect(shape(strip)).toBe('d {b c} [a* e]');
  });

  it('steps a tab out of its group at the edge, into a group next to it, and past a collapsed group', () => {
    const strip = stripOf('a', 'b', 'c', 'd', 'e');
    const group = strip.createGroup('b')?.id ?? '';
    strip.addToGroup('c', group);
    expect(shape(strip)).toBe('a* [b c] d e');
    // A tab at the edge of its group leaves it in place, then moves on.
    expect(strip.step('c', 1)).toBe(true);
    expect(shape(strip)).toBe('a* [b] c d e');
    expect(strip.step('c', 1)).toBe(true);
    expect(shape(strip)).toBe('a* [b] d c e');
    // A tab next to a group joins it at that edge, then moves inside it.
    expect(strip.step('a', 1)).toBe(true);
    expect(shape(strip)).toBe('[a* b] d c e');
    expect(strip.step('a', 1)).toBe(true);
    expect(shape(strip)).toBe('[b a*] d c e');
    // A collapsed group is passed as a whole.
    strip.setCollapsed(group, false);
    const other = strip.createGroup('c')?.id ?? '';
    strip.addToGroup('e', other);
    strip.setCollapsed(other, true);
    expect(shape(strip)).toBe('[b a*] d {c e}');
    expect(strip.step('d', 1)).toBe(true);
    expect(shape(strip)).toBe('[b a*] {c e} d');
    // A collapsed group passes a tab, and a group, as a whole.
    expect(strip.step('c', 1)).toBe(true);
    expect(shape(strip)).toBe('[b a*] d {c e}');
    expect(strip.step('e', -1)).toBe(true);
    expect(strip.step('e', -1)).toBe(true);
    expect(shape(strip)).toBe('{c e} [b a*] d');
    expect(strip.step('c', -1)).toBe(false);
    // A tab at the edge of its group leaves it before it passes a collapsed group, and stops at
    // the start and the end of the strip.
    expect(strip.step('b', -1)).toBe(true);
    expect(shape(strip)).toBe('{c e} b [a*] d');
    expect(strip.step('b', -1)).toBe(true);
    expect(shape(strip)).toBe('b {c e} [a*] d');
    expect(strip.step('b', -1)).toBe(false);
    expect(strip.step('d', 1)).toBe(false);
  });

  it('steps pinned tabs among the pinned tabs and never into a group', () => {
    const strip = stripOf('a', 'b', 'c');
    strip.pin('a', true);
    strip.pin('b', true);
    const group = strip.createGroup('c')?.id ?? '';
    expect(group).not.toBe('');
    expect(strip.step('b', 1)).toBe(false);
    expect(strip.step('b', -1)).toBe(true);
    expect(shape(strip)).toBe('^b ^a* [c]');
    // The first tab after the pinned tabs leaves its group, then stays.
    expect(strip.step('c', -1)).toBe(true);
    expect(strip.step('c', -1)).toBe(false);
    expect(shape(strip)).toBe('^b ^a* c');
  });

  it('forms groups of neighbouring tabs again, with the other tab of their split views', () => {
    const strip = stripOf('a', 'b', 'c', 'd');
    strip.split('c', 'd');
    const look = { name: 'News', color: 'orange', collapsed: false } as const;
    expect(strip.formGroup(['b', 'c'], look)).toMatchObject(look);
    expect(shape(strip)).toBe('a* [b c d]');
    expect(strip.formGroup(['a', 'c'], look)).toBeUndefined();
    expect(strip.formGroup(['z'], look)).toBeUndefined();
    strip.pin('a', true);
    expect(strip.formGroup(['a'], look)).toBeUndefined();
  });

  it('brings the groups of a restored window back with new ids', () => {
    const { tabs, id } = windowWith(['a', 'b', 'c', 'd', 'e']);
    tabs.pin(id('e'), true);
    const work: TabGroup = { id: 'g7', name: 'Work', color: 'red', collapsed: true };
    const news: TabGroup = { id: 'g3', name: 'News', color: 'teal', collapsed: false };
    const names = ['a', 'b', 'c', 'd', 'e'];
    restoreGroups(tabs, names.map(id), [work, work, undefined, work, news]);
    expect(shapeOf(tabs)).toBe('^e {a* b} c {d}');
    // The active tab was in a collapsed group, which opened when it showed.
    tabs.activate(id('a'));
    expect(shapeOf(tabs)).toBe('^e [a* b] c {d}');
    const groups = groupsOf(tabs.all);
    expect(groups.map((group) => [group.name, group.color])).toEqual([
      ['Work', 'red'],
      ['Work', 'red'],
    ]);
    expect(new Set(groups.map((group) => group.id)).size).toBe(2);
    // A window whose tabs kept no group stays as it was.
    const plain = windowWith(['a']);
    restoreGroups(plain.tabs, [plain.id('a')], [undefined]);
    expect(shapeOf(plain.tabs)).toBe('a*');
  });

  it('forms the groups of a window that restores before its first tab is active', () => {
    // A restore opens every tab first, forms the groups, then makes a tab active.
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const ids = ['a', 'b', 'c'].map((name) =>
      tabs.open(`https://${name}.example/`, { activate: false, lazy: true }),
    );
    const work: TabGroup = { id: 'g1', name: 'Work', color: 'blue', collapsed: true };
    restoreGroups(tabs, ids, [undefined, work, work]);
    expect(tabs.all).toHaveLength(3);
    expect(tabs.active).toBeUndefined();
    expect(views.log.filter((entry) => entry.startsWith('show'))).toEqual([]);
    tabs.activate(ids[0] ?? '');
    expect(shapeOf(tabs)).toBe('a* {b c}');
  });

  it('places, moves and steps tabs as a strip without groups does while it has none', () => {
    const plain = new TabStrip<GroupedTab>();
    const grouped = new GroupedTabStrip<GroupedTab>();
    const random = seeded(7);
    let next = 0;
    for (let round = 0; round < 400; round += 1) {
      const all = plain.all.map((each) => each.id);
      const any = (): string => all[Math.floor(random() * all.length)] ?? 'none';
      const action = Math.floor(random() * 8);
      const run = (strip: TabStrip<GroupedTab>): unknown => {
        switch (action) {
          case 0:
          case 1: {
            const activate = random() < 0.5;
            const after = random() < 0.3 && all.length > 0 ? any() : undefined;
            const name = `t${next}`;
            return strip.insert(tab(name, random() < 0.1), { activate, after });
          }
          case 2:
            return all.length === 0 ? undefined : strip.activate(any());
          case 3: {
            const closed = strip.close(any());
            if (closed?.next !== undefined) strip.activate(closed.next.id);
            return closed?.next?.id;
          }
          case 4:
            return strip.move(any(), Math.floor(random() * (all.length + 1)));
          case 5:
            return strip.step(any(), random() < 0.5 ? -1 : 1);
          case 6: {
            // The menu and the shortcut pin a tab that is not pinned, and unpin a pinned one.
            const chosen = strip.get(any());
            return chosen === undefined ? undefined : strip.pin(chosen.id, !chosen.pinned);
          }
          default:
            return strip.split(any(), any());
        }
      };
      const state = random.state();
      const fromPlain = run(plain);
      random.reset(state);
      const fromGrouped = run(grouped);
      if (action <= 1) next += 1;
      expect(fromGrouped).toEqual(fromPlain);
      expect(grouped.all.map((each) => each.id)).toEqual(plain.all.map((each) => each.id));
      expect(grouped.active?.id).toBe(plain.active?.id);
      expect(grouped.splits).toEqual(plain.splits);
      expect(grouped.listed.map((each) => each.id)).toEqual(plain.listed.map((each) => each.id));
    }
  });

  it('lets the commands that move the active tab or go to a tab run exactly where they act, through 400 random strips', () => {
    const random = seeded(4711);
    const { tabs } = windowWith(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    const any = (): string => tabs.all[Math.floor(random() * tabs.all.length)]?.id ?? 'none';
    const anyGroup = (): string => {
      const groups = groupsOf(tabs.all);
      return groups[Math.floor(random() * groups.length)]?.id ?? 'g0';
    };
    // What the window tells `canRun`, as `BrowserWindowController.commandContext` does.
    const contextOf = (active: Tab): CommandContext => ({
      tabs: tabs.all.map((each) => {
        const pair = tabs.splitOf(each.id);
        return {
          ...each,
          split: pair === undefined ? null : pair.start === each.id ? 'start' : 'end',
        };
      }),
      activeIndex: tabs.all.indexOf(active),
      canReopen: false,
      finding: false,
      webPage: true,
      privateWindows: true,
      developerTools: true,
      palette: true,
      splitView: true,
      reader: false,
      workspaces: 1,
    });
    for (let round = 0; round < 400; round += 1) {
      const id = any();
      const action = Math.floor(random() * 7);
      if (action === 0) editGroups(tabs, (strip) => strip.createGroup(id));
      else if (action === 1) editGroups(tabs, (strip) => strip.addToGroup(id, anyGroup()));
      else if (action === 2) {
        editGroups(tabs, (strip) => strip.setCollapsed(anyGroup(), random() < 0.6));
      } else if (action === 3) {
        tabs.pin(id, tabs.all.find((each) => each.id === id)?.pinned !== true);
      } else if (action === 4) tabs.activate(id);
      else if (action === 5) editGroups(tabs, (strip) => strip.removeFromGroup(id));
      else if (tabs.active !== undefined) tabs.split(tabs.active.id, id);
      const active = tabs.active;
      if (active === undefined) throw new Error('No active tab');
      const context = contextOf(active);
      const where = `after round ${String(round)}: ${shapeOf(tabs)}`;
      // The shortcuts count the tabs that the strip lists, which hold the active tab.
      const listed = tabs.listed.length;
      expect(tabs.listed.includes(active), `${where} lists the active tab`).toBe(true);
      for (let place = 1; place <= 8; place += 1) {
        const command = `tab.select${String(place)}` as WindowCommand;
        expect(canRun(command, context), `${where} ${command}`).toBe(listed >= place);
      }
      for (const command of ['tab.next', 'tab.previous', 'tab.selectLast'] as const) {
        expect(canRun(command, context), `${where} ${command}`).toBe(listed >= 2);
      }
      // A move can run exactly when it changes the strip.
      const direction = random() < 0.5 ? -1 : 1;
      const command = direction < 0 ? 'tab.moveLeft' : 'tab.moveRight';
      const before = shapeOf(tabs);
      const allowed = canRun(command, context);
      expect(tabs.step(active.id, direction), `${where} ${command}`).toBe(allowed);
      expect(shapeOf(tabs) !== before, `${where} ${command}`).toBe(allowed);
    }
  });

  it('keeps every rule through 500 random changes of tabs and groups', () => {
    const random = seeded(2026);
    const { tabs } = windowWith(['a', 'b', 'c', 'd', 'e', 'f']);
    const any = (): string => {
      const all = tabs.all;
      return all[Math.floor(random() * all.length)]?.id ?? 'none';
    };
    const anyGroup = (): string => {
      const groups = groupsOf(tabs.all);
      return groups[Math.floor(random() * groups.length)]?.id ?? 'g0';
    };
    const has = (id: string): boolean => tabs.all.some((each) => each.id === id);
    for (let round = 0; round < 500; round += 1) {
      const action = Math.floor(random() * 17);
      const id = any();
      switch (action) {
        case 0:
          tabs.open('https://new.example/', {
            activate: random() < 0.5,
            ...(random() < 0.3 && has(id) ? { after: id } : {}),
            ...(random() < 0.3 ? { opener: id } : {}),
          });
          break;
        case 1:
          if (has(id)) tabs.activate(id);
          break;
        case 2:
          if (has(id) && tabs.all.length > 1) tabs.close(id);
          break;
        case 3:
          if (has(id)) tabs.move(id, Math.floor(random() * (tabs.all.length + 1)));
          break;
        case 4:
          if (has(id)) tabs.step(id, random() < 0.5 ? -1 : 1);
          break;
        case 5: {
          // The menu and the shortcut pin a tab that is not pinned, and unpin a pinned one.
          const chosen = tabs.all.find((each) => each.id === id);
          if (chosen !== undefined) tabs.pin(id, !chosen.pinned);
          break;
        }
        case 6:
          if (has(id) && has(tabs.active?.id ?? '')) tabs.split(tabs.active?.id ?? '', id);
          break;
        case 7:
          if (has(id)) tabs.unsplit(id);
          break;
        case 8:
          tabs.reopenClosed();
          break;
        case 9:
          editGroups(tabs, (strip) => strip.createGroup(id));
          break;
        case 10:
          editGroups(tabs, (strip) => strip.addToGroup(id, anyGroup()));
          break;
        case 11:
          editGroups(tabs, (strip) => strip.removeFromGroup(id));
          break;
        case 12:
          editGroups(tabs, (strip) => strip.setCollapsed(anyGroup(), random() < 0.6));
          break;
        case 13:
          if (random() < 0.3) closeGroup(tabs, anyGroup());
          else editGroups(tabs, (strip) => strip.ungroup(anyGroup()));
          break;
        case 14: {
          const choice = random();
          const group = choice < 0.4 ? anyGroup() : choice < 0.7 ? null : undefined;
          if (has(id)) editGroups(tabs, (strip) => strip.move(id, Math.floor(random() * 9), group));
          break;
        }
        case 15:
          editGroups(tabs, (strip) => strip.updateGroup(anyGroup(), { color: 'red', name: 'x' }));
          break;
        default:
          tabs.open('https://new.example/', {
            activate: random() < 0.5,
            group: groupsOf(tabs.all)[0],
          });
      }
      const found = problems(tabs.all, tabs.active?.id, tabs.splits);
      expect(found, `after round ${String(round)}, action ${String(action)}`).toEqual([]);
      expect(tabs.active).toBeDefined();
    }
  });
});

/** A random number generator with a seed, so that a failing run can be repeated. */
function seeded(seed: number): (() => number) & {
  state(): number;
  reset(state: number): void;
} {
  let value = seed;
  const next = (): number => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(next, {
    state: () => value,
    reset: (state: number) => {
      value = state;
    },
  });
}
