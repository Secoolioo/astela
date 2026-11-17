import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  defaultWorkspaces,
  WorkspaceList,
  workspacePartition,
  type Workspace,
} from '../../shared/workspaces.ts';
import type { RestoredWindow } from '../session/session.ts';
import { showTab } from '../tabs/show-tab.ts';
import { editGroups, GroupedTabStrip, restoreGroups } from '../tabs/tab-groups.ts';
import { TabService, type SplitPair, type Tab, type TabViewPort } from '../tabs/tab-service.ts';
import {
  mergeWorkspaces,
  moveToWorkspace,
  removeWorkspace,
  restoreWorkspaceTabs,
  revealTab,
  switchWorkspace,
  workspaceRestore,
  workspaceStrips,
} from '../tabs/workspace-strips.ts';
import {
  addWorkspace,
  moveWorkspace,
  newWorkspaceId,
  partitionFolder,
  partitionOf,
  removeWorkspace as removeFromList,
  stepWorkspace,
  updateWorkspace,
  workspaceAt,
  workspaceName,
} from '../workspaces/workspaces.ts';

const work: Workspace = {
  id: 'w1',
  name: 'Work',
  icon: 'briefcase',
  color: 'teal',
  isolated: false,
};
const bank: Workspace = { id: 'w2', name: 'Bank', icon: 'heart', color: 'red', isolated: true };
const list: readonly Workspace[] = [...defaultWorkspaces, work, bank];
const valid = (value: unknown): boolean => v.safeParse(WorkspaceList, value).success;

describe('the list of workspaces', () => {
  it('accepts the default workspace alone and refuses lists that break its rules', () => {
    expect(valid(defaultWorkspaces)).toBe(true);
    expect(valid(list)).toBe(true);
    expect(valid([])).toBe(false);
    expect(valid([work])).toBe(false);
    expect(valid([...defaultWorkspaces, work, work])).toBe(false);
    expect(valid([{ ...defaultWorkspaces[0], isolated: true }])).toBe(false);
    expect(valid([...defaultWorkspaces, { ...work, name: '  ' }])).toBe(false);
    expect(valid([...defaultWorkspaces, { ...work, id: '../x' }])).toBe(false);
    expect(valid([...defaultWorkspaces, { ...work, icon: 'rocket' }])).toBe(false);
    const many = Array.from({ length: 20 }, (_, at) => ({ ...work, id: `w${String(at + 1)}` }));
    expect(valid([...defaultWorkspaces, ...many.slice(0, 19)])).toBe(true);
    expect(valid([...defaultWorkspaces, ...many])).toBe(false);
  });

  it('adds, renames, moves and removes workspaces, and keeps the default one', () => {
    const look = { name: '  Study  ', icon: 'book', color: 'green' } as const;
    const added = addWorkspace(list, look, 'w3', true);
    expect(added?.at(-1)).toEqual({
      id: 'w3',
      name: 'Study',
      icon: 'book',
      color: 'green',
      isolated: true,
    });
    expect(addWorkspace(list, { ...look, name: ' ' }, 'w3', false)).toBeUndefined();
    expect(addWorkspace(list, look, 'w1', false)).toBeUndefined();
    expect(addWorkspace(list, look, 'default', false)).toBeUndefined();
    const full = Array.from({ length: 20 }, (_, at) => ({ ...work, id: `w${String(at + 1)}` }));
    expect(addWorkspace(full, look, 'w99', false)).toBeUndefined();

    const renamed = updateWorkspace(list, 'w2', { name: 'Money', icon: 'star', color: 'orange' });
    // Whether a workspace keeps its data apart never changes after it was made.
    expect(renamed?.[2]).toEqual({ ...bank, name: 'Money', icon: 'star', color: 'orange' });
    expect(updateWorkspace(list, 'w2', { name: '', icon: 'star', color: 'red' })).toBeUndefined();
    expect(updateWorkspace(list, 'default', { name: '', icon: 'user', color: 'red' })?.[0]).toEqual(
      {
        ...defaultWorkspaces[0],
        icon: 'user',
        color: 'red',
      },
    );
    expect(updateWorkspace(list, 'w9', look)).toBeUndefined();
    expect(workspaceName(`${'x'.repeat(39)}   y`)).toBe('x'.repeat(39));

    expect(moveWorkspace(list, 'w2', 0)?.map(({ id }) => id)).toEqual(['w2', 'default', 'w1']);
    expect(moveWorkspace(list, 'default', 9)?.map(({ id }) => id)).toEqual(['w1', 'w2', 'default']);
    expect(moveWorkspace(list, 'w1', 1)).toBeUndefined();
    expect(moveWorkspace(list, 'w9', 0)).toBeUndefined();

    expect(removeFromList(list, 'w1')?.map(({ id }) => id)).toEqual(['default', 'w2']);
    expect(removeFromList(list, 'default')).toBeUndefined();
    expect(removeFromList(list, 'w9')).toBeUndefined();
  });

  it('finds workspaces by their place and goes round the list', () => {
    expect(workspaceAt(list, 1)?.id).toBe('default');
    expect(workspaceAt(list, 3)?.id).toBe('w2');
    expect(workspaceAt(list, 4)).toBeUndefined();
    expect(workspaceAt(list, 0)).toBeUndefined();
    expect(stepWorkspace(list, 'default', 1)?.id).toBe('w1');
    expect(stepWorkspace(list, 'w2', 1)?.id).toBe('default');
    expect(stepWorkspace(list, 'default', -1)?.id).toBe('w2');
    expect(stepWorkspace(defaultWorkspaces, 'default', 1)).toBeUndefined();
  });

  it('makes ids that no workspace has, also from numbers that repeat', () => {
    expect(newWorkspaceId([], () => 0.5)).toMatch(/^w[0-9a-z]{1,15}$/);
    expect(newWorkspaceId(['default'], () => 0)).toBe('w0');
    // Thirty-two tries that all give a taken id fall back to the next free number.
    expect(newWorkspaceId(['default', 'w0', 'w3'], () => 0)).toBe('w4');
  });

  it('gives isolated workspaces a partition and a folder of their own', () => {
    expect(partitionOf(bank, 'persist:web')).toBe('persist:ws-w2');
    expect(partitionOf(work, 'persist:web')).toBe('persist:web');
    expect(partitionOf(undefined, 'persist:web')).toBe('persist:web');
    expect(workspacePartition(list, 'w2', 'persist:web')).toBe('persist:ws-w2');
    expect(workspacePartition(list, 'w1', 'persist:web')).toBe('persist:web');
    expect(workspacePartition(list, 'w7', 'persist:web')).toBe('persist:web');
    expect(workspacePartition(list, undefined, 'persist:web')).toBe('persist:web');
    expect(partitionFolder('w2')).toBe('ws-w2');
    expect(partitionFolder('default')).toBeUndefined();
    expect(partitionFolder('../x')).toBeUndefined();
    expect(partitionFolder('w2/../../x')).toBeUndefined();
  });
});

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
  load(id: string, url: string): void {
    this.log.push(`load ${id} ${url}`);
  }
  run(): void {}
  sleep(): boolean {
    return true;
  }
}

/** A window with tabs a to c in the default workspace, the first one active. */
function windowWith(names = ['a', 'b', 'c']): {
  tabs: TabService;
  views: FakeViews;
  id: (name: string) => string;
} {
  const views = new FakeViews();
  const tabs = new TabService(views, 'about:blank');
  const opened = new Map(
    names.map((name) => [name, tabs.open(`https://${name}.example/`, { activate: false })]),
  );
  tabs.activate(opened.get(names[0] ?? '') ?? '');
  views.log.length = 0;
  return { tabs, views, id: (name) => opened.get(name) ?? name };
}

function nameOf(each: Tab): string {
  return /^https:\/\/([a-z]+)\.example\/$/.exec(each.url)?.[1] ?? each.url;
}

/** A tab of a restored window, in a workspace and maybe its active tab. */
function restored(
  name: string,
  workspace?: string,
  current?: boolean,
): RestoredWindow['tabs'][number] {
  return {
    url: `https://${name}.example/`,
    title: name,
    ...(workspace === undefined ? {} : { workspace }),
    ...(current === undefined ? {} : { current }),
  };
}

/** The names of the tabs that a window shows, and of its active tab. */
function shown(tabs: TabService): {
  workspace: string;
  tabs: string[];
  active: string | undefined;
} {
  const active = tabs.active;
  return {
    workspace: tabs.workspace,
    tabs: tabs.all.map(nameOf),
    active: active === undefined ? undefined : nameOf(active),
  };
}

describe('the tabs of the workspaces of a window', () => {
  it('shows one workspace at a time and keeps the pages of the others alive', () => {
    const { tabs, views, id } = windowWith();
    expect(switchWorkspace(tabs, 'w1')).toBe(true);
    const blank = tabs.active?.id ?? '';
    expect(shown(tabs)).toEqual({ workspace: 'w1', tabs: ['about:blank'], active: 'about:blank' });
    expect(views.log).toEqual([`create ${blank}`, `show ${blank}`]);
    expect([...views.live]).toEqual([id('a'), id('b'), id('c'), blank]);

    views.log.length = 0;
    expect(switchWorkspace(tabs, 'default')).toBe(true);
    expect(switchWorkspace(tabs, 'default')).toBe(false);
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c'], active: 'a' });
    expect(views.log).toEqual([`show ${id('a')}`]);
    expect(tabs.allTabs.map(nameOf)).toEqual(['a', 'b', 'c', 'about:blank']);
    expect(tabs.workspaceOf(blank)).toBe('w1');
    expect(tabs.workspaceOf(id('b'))).toBe('default');
    expect(tabs.workspaceOf('t-none')).toBeUndefined();
    expect(new Set(tabs.allTabs.map((tab) => tab.id)).size).toBe(4);
  });

  it('keeps the tabs of a hidden workspace up to date without showing them', () => {
    const { tabs, views, id } = windowWith();
    tabs.activate(id('b'));
    switchWorkspace(tabs, 'w1');
    views.log.length = 0;

    const hidden = (): string | undefined =>
      tabs.strips.find((strip) => strip.workspace === 'default')?.active?.id;
    tabs.update(id('b'), { title: 'B again' });
    expect(tabs.get(id('b'))?.title).toBe('B again');
    tabs.navigate(id('c'), 'https://d.example/');
    // A page of a hidden tab opens a tab in its own workspace, which stays hidden.
    const opened = tabs.open('https://e.example/', { opener: id('c') });
    expect(tabs.workspaceOf(opened)).toBe('default');
    expect(hidden()).toBe(opened);
    tabs.close(opened);
    tabs.close(id('a'));
    expect(views.log).toEqual([
      `load ${id('c')} https://d.example/`,
      `create ${opened}`,
      `destroy ${opened}`,
      `destroy ${id('a')}`,
    ]);
    expect(shown(tabs).workspace).toBe('w1');
    expect(hidden()).toBe(id('c'));
  });

  it('shows a tab of another workspace that is revealed, and nothing else on the way', () => {
    const { tabs, views, id } = windowWith();
    switchWorkspace(tabs, 'w1');
    views.log.length = 0;
    revealTab(tabs, id('c'));
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c'], active: 'c' });
    expect(views.log).toEqual([`show ${id('c')}`]);
  });

  it('shows a tab that was found in the workspace that shows, or in another one with it', async () => {
    const { tabs, views, id } = windowWith();
    // A tab of the workspace that shows becomes active at once, without the strips of others.
    void showTab(tabs, id('b'));
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c'], active: 'b' });
    expect(tabs.strips).toHaveLength(1);
    switchWorkspace(tabs, 'w1');
    views.log.length = 0;
    await showTab(tabs, id('c'));
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c'], active: 'c' });
    expect(views.log).toEqual([`show ${id('c')}`]);
    // A tab that the window does not have shows nothing.
    await showTab(tabs, 't-none');
    expect(shown(tabs).active).toBe('c');
  });

  it('moves a tab into another workspace out of its group and its split view', () => {
    const { tabs, views, id } = windowWith(['a', 'b', 'c', 'd']);
    tabs.split(id('a'), id('b'));
    editGroups(tabs, (strip) => strip.createGroup(id('c'), { name: 'Shop' }));
    editGroups(tabs, (strip) => strip.move(id('d'), 3, strip.get(id('c'))?.group?.id));
    views.log.length = 0;

    expect(moveToWorkspace(tabs, id('a'), 'w1')).toBe(true);
    expect(tabs.splits).toEqual([]);
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['b', 'c', 'd'], active: 'b' });
    expect(views.log).toEqual([`show ${id('b')}`]);
    expect(views.live.has(id('a'))).toBe(true);

    expect(moveToWorkspace(tabs, id('d'), 'w1')).toBe(true);
    expect(tabs.get(id('d'))?.group).toBeNull();
    expect(tabs.get(id('c'))?.group?.name).toBe('Shop');
    expect(moveToWorkspace(tabs, id('d'), 'w1')).toBe(false);

    views.log.length = 0;
    switchWorkspace(tabs, 'w1');
    // A workspace that tabs moved into before it showed shows the first of them.
    expect(shown(tabs)).toEqual({ workspace: 'w1', tabs: ['a', 'd'], active: 'a' });
    expect(views.log).toEqual([`show ${id('a')}`]);
  });

  it('keeps a pinned tab pinned when it moves, at the end of the pinned tabs there', () => {
    const { tabs, id } = windowWith(['a', 'b', 'c']);
    switchWorkspace(tabs, 'w1');
    const blank = tabs.active?.id ?? '';
    tabs.open('https://e.example/', { pinned: true, activate: false });
    switchWorkspace(tabs, 'default');
    tabs.pin(id('b'), true);
    expect(moveToWorkspace(tabs, id('b'), 'w1')).toBe(true);
    switchWorkspace(tabs, 'w1');
    expect(shown(tabs)).toEqual({
      workspace: 'w1',
      tabs: ['e', 'b', 'about:blank'],
      active: 'about:blank',
    });
    expect(tabs.get(id('b'))?.pinned).toBe(true);
    expect(tabs.active?.id).toBe(blank);
  });

  it('gives the workspace that shows a new tab once its last tab moves away', () => {
    const { tabs, id } = windowWith(['a']);
    moveToWorkspace(tabs, id('a'), 'w1');
    expect(shown(tabs)).toEqual({
      workspace: 'default',
      tabs: ['about:blank'],
      active: 'about:blank',
    });
  });

  it('starts a group in the workspace that shows and leaves the others plain', () => {
    const { tabs } = windowWith();
    switchWorkspace(tabs, 'w1');
    const blank = tabs.active?.id ?? '';
    editGroups(tabs, (strip) => strip.createGroup(blank, { name: 'New' }));
    const strips = workspaceStrips(tabs);
    expect(strips.strip('w1')).toBeInstanceOf(GroupedTabStrip);
    expect(strips.strip('default')).not.toBeInstanceOf(GroupedTabStrip);
    expect(tabs.get(blank)?.group?.name).toBe('New');
  });

  it('closes the tabs of a deleted workspace, after showing another one', () => {
    const { tabs, views, id } = windowWith();
    switchWorkspace(tabs, 'w1');
    const blank = tabs.active?.id ?? '';
    views.log.length = 0;
    removeWorkspace(tabs, 'w1', 'default');
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c'], active: 'a' });
    expect(views.log).toEqual([`show ${id('a')}`, `destroy ${blank}`]);
    expect(tabs.workspaceOf(blank)).toBeUndefined();
    expect(workspaceStrips(tabs).workspaces).toEqual(['default']);
  });

  it('puts the tabs of every workspace together, with the groups and split views of each', () => {
    const { tabs, id } = windowWith(['a', 'b']);
    editGroups(tabs, (strip) => strip.createGroup(id('b'), { name: 'Work', color: 'teal' }));
    switchWorkspace(tabs, 'w1');
    const blank = tabs.active?.id ?? '';
    const c = tabs.open('https://c.example/');
    const d = tabs.open('https://d.example/', { activate: false });
    tabs.close(blank);
    // The same name and the same id within its own strip: the groups still stay apart.
    editGroups(tabs, (strip) => strip.createGroup(c, { name: 'Work', color: 'teal' }));
    editGroups(tabs, (strip) => strip.move(d, 2, strip.get(c)?.group?.id));
    tabs.split(c, d, 0.4);
    tabs.activate(d);

    mergeWorkspaces(tabs, 'default', ['default', 'w1']);
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c', 'd'], active: 'd' });
    const groups = tabs.all.map((tab) => tab.group?.id);
    expect(groups[0]).toBeUndefined();
    expect(groups[1]).not.toBe(groups[2]);
    expect(groups[2]).toBe(groups[3]);
    expect(tabs.splits).toEqual([{ start: c, end: d, ratio: 0.4 }]);
    expect(workspaceStrips(tabs).workspaces).toEqual(['default']);
  });

  it('acts on the tabs of a hidden workspace in their own strip, and keeps the window to the shown one', () => {
    const { tabs, views, id } = windowWith(['a', 'b', 'c', 'd']);
    tabs.split(id('b'), id('c'), 0.5);
    switchWorkspace(tabs, 'w1');
    const blank = tabs.active?.id ?? '';
    views.log.length = 0;
    const strips = workspaceStrips(tabs);
    const hidden = strips.strip('default');
    // A split view, a move, a step and a pin of a hidden tab change only its own strip.
    expect(tabs.unitOf(id('b'))).toEqual([id('b'), id('c')]);
    tabs.swapSplit(id('b'));
    tabs.resizeSplit(id('b'), 0.3);
    expect(tabs.splitOf(id('b'))).toEqual({ start: id('c'), end: id('b'), ratio: 0.3 });
    tabs.unsplit(id('b'));
    expect(tabs.splitOf(id('b'))).toBeUndefined();
    tabs.move(id('d'), 0);
    expect(tabs.step(id('a'), -1)).toBe(true);
    tabs.pin(id('c'), true);
    expect(hidden.all.map(nameOf)).toEqual(['c', 'a', 'd', 'b']);
    expect(strips.indexOf(id('d'))).toBe(2);
    expect(strips.indexOf('t-none')).toBe(-1);
    expect(strips.unitOf('t-none')).toEqual([]);
    expect(strips.pinnedCount).toBe(0);
    expect(hidden.pinnedCount).toBe(1);
    // What concerns the window is the shown strip's: its tabs, its pinned tabs and its closed ones.
    expect(tabs.listed.map((tab) => tab.id)).toEqual([blank]);
    tabs.close(id('d'));
    expect(tabs.canReopen).toBe(false);
    const opened = tabs.open('https://e.example/');
    tabs.close(opened);
    expect(tabs.canReopen).toBe(true);
    const reopened = tabs.reopenClosed();
    expect(reopened === undefined ? undefined : tabs.workspaceOf(reopened)).toBe('w1');
    expect(views.log.filter((entry) => entry.startsWith('show'))).toEqual([
      `show ${opened}`,
      `show ${blank}`,
      `show ${reopened ?? ''}`,
    ]);
    // The strip of the shown workspace stays; one that is not there gives nothing to close.
    expect(strips.drop('w1')).toEqual([]);
    expect(strips.drop('w9')).toEqual([]);
    // The window lets go of the tabs of every workspace.
    views.log.length = 0;
    tabs.dispose();
    expect(views.log.toSorted()).toEqual(
      [id('a'), id('b'), id('c'), blank, reopened ?? ''].map((tab) => `destroy ${tab}`).toSorted(),
    );
  });

  it('orders the strips by the workspaces, and leaves alone what is not there', () => {
    const { tabs, views, id } = windowWith(['a']);
    switchWorkspace(tabs, 'w2');
    switchWorkspace(tabs, 'w1');
    const strips = workspaceStrips(tabs);
    strips.order(['w1', 'w2']);
    expect(strips.workspaces).toEqual(['w1', 'w2', 'default']);
    views.log.length = 0;
    removeWorkspace(tabs, 'w9', 'default');
    revealTab(tabs, 't-none');
    expect(moveToWorkspace(tabs, 't-none', 'w2')).toBe(false);
    expect(views.log).toEqual([]);
    expect(tabs.workspaceOf(id('a'))).toBe('default');
    // A window that never had another workspace merges nothing.
    const plain = windowWith(['a']);
    mergeWorkspaces(plain.tabs, 'default', ['default']);
    expect(plain.views.log).toEqual([]);
    expect(plain.tabs.strips.length).toBe(1);
  });

  it('gives a plain strip the groups of the workspaces that it takes in', () => {
    const { tabs, id } = windowWith(['a']);
    switchWorkspace(tabs, 'w1');
    const blank = tabs.active?.id ?? '';
    editGroups(tabs, (strip) => strip.createGroup(blank, { name: 'Read', color: 'green' }));
    mergeWorkspaces(tabs, 'default', ['default', 'w1']);
    expect(workspaceStrips(tabs).strip('default')).toBeInstanceOf(GroupedTabStrip);
    expect(tabs.all.map((tab) => tab.group?.name)).toEqual([undefined, 'Read']);
    expect(tabs.active?.id).toBe(blank);
    expect(tabs.get(id('a'))?.group).toBeNull();
  });

  it('restores each workspace with its tabs, loading only the active tab that shows', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const window: RestoredWindow = {
      tabs: [
        restored('a'),
        restored('b', 'w1'),
        restored('c', 'w1'),
        restored('d', 'gone'),
        restored('e'),
        restored('f', 'w2', true),
        restored('g', 'w2'),
      ],
      active: 2,
      place: {},
      splits: [{ start: 1, ratio: 0.5 }],
      workspace: 'w1',
    };
    restoreWorkspaceTabs(tabs, window, { order: ['default', 'w1', 'w2'], splitView: true });

    expect(shown(tabs)).toEqual({ workspace: 'w1', tabs: ['b', 'c'], active: 'c' });
    expect(tabs.splits.length).toBe(1);
    const strip = (workspace: string) => tabs.strips.find((each) => each.workspace === workspace);
    // A tab of a workspace that the profile no longer has comes back in the default one.
    expect(strip('default')?.all.map(nameOf)).toEqual(['a', 'e', 'd']);
    expect(strip('default')?.active?.url).toBe('https://a.example/');
    expect(strip('w2')?.all.map(nameOf)).toEqual(['f', 'g']);
    expect(strip('w2')?.active?.url).toBe('https://f.example/');
    expect(
      views.log.filter((entry) => !entry.endsWith('lazy') && entry.startsWith('create')),
    ).toEqual([`create ${tabs.active?.id ?? ''}`]);
  });

  it('restores split views only within a workspace, and a window without tabs with a new one', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const window: RestoredWindow = {
      tabs: [restored('a'), restored('b', 'w1'), restored('c', 'w1'), restored('d', 'w1')],
      active: 9,
      place: {},
      splits: [
        { start: 0, ratio: 0.5 },
        { start: 1, ratio: 0.5 },
      ],
      workspace: 'w1',
    };
    workspaceRestore(['default', 'w1'])(tabs, window, true);
    // An active tab out of range is the first one of the window, which is in another workspace.
    expect(shown(tabs)).toEqual({ workspace: 'w1', tabs: ['b', 'c', 'd'], active: 'b' });
    expect(tabs.splits.map(({ ratio }) => ratio)).toEqual([0.5]);
    expect(tabs.strips.find((strip) => strip.workspace === 'default')?.splits).toEqual([]);
    // While split view is off, the pairs of the session show their tabs one by one.
    const without = new TabService(new FakeViews(), 'about:blank');
    restoreWorkspaceTabs(without, window, { order: ['default', 'w1'], splitView: false });
    expect(without.splits).toEqual([]);
    const empty = new TabService(new FakeViews(), 'about:blank');
    restoreWorkspaceTabs(
      empty,
      { tabs: [], active: 0, place: {}, workspace: 'w1' },
      { order: ['default', 'w1'], splitView: true },
    );
    expect(shown(empty)).toEqual({ workspace: 'w1', tabs: ['about:blank'], active: 'about:blank' });
  });

  it('restores every tab in the default workspace while workspaces are off', () => {
    const views = new FakeViews();
    const tabs = new TabService(views, 'about:blank');
    const window: RestoredWindow = {
      tabs: [
        {
          url: 'https://a.example/',
          title: 'a',
          group: { id: 'g1', name: 'A', color: 'blue', collapsed: false },
        },
        {
          url: 'https://b.example/',
          title: 'b',
          workspace: 'w1',
          group: { id: 'g1', name: 'B', color: 'red', collapsed: false },
        },
        { url: 'https://c.example/', title: 'c', workspace: 'w1', current: true },
      ],
      active: 1,
      place: {},
      workspace: 'w1',
    };
    restoreWorkspaceTabs(tabs, window, { order: [], splitView: true, regroup: restoreGroups });
    expect(shown(tabs)).toEqual({ workspace: 'default', tabs: ['a', 'b', 'c'], active: 'b' });
    // The two groups had the same id in their own workspaces, and stay two groups.
    expect(tabs.all.map((each) => each.group?.name)).toEqual(['A', 'B', undefined]);
    expect(tabs.all[0]?.group?.id).not.toBe(tabs.all[1]?.group?.id);
    expect(tabs.strips.length).toBe(1);
  });
});
