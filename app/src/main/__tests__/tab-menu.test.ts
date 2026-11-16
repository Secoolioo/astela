import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { editGroups } from '../../domain/tabs/tab-groups.ts';
import { TabService, type TabViewPort } from '../../domain/tabs/tab-service.ts';
import type { TabStripPosition } from '../../shared/layout.ts';
import { shortcutTable } from '../../shared/shortcuts.ts';
import { translatorFor } from '../i18n/i18n.ts';
import { tabMenuTemplate, type TabMenuWindow } from '../tab-menu.ts';
import { accessKeyProblems } from './access-keys.ts';

// The items of the menu need nothing of Electron; showing the menu does.
vi.mock('electron', () => ({ app: {}, Menu: {} }));

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Views that only record what the tabs ask of them. */
class FakeViews implements TabViewPort {
  readonly log: string[] = [];
  create(): void {}
  show(): void {}
  destroy(id: string): void {
    this.log.push(`destroy ${id}`);
  }
  load(): void {}
  run(id: string, action: string): void {
    this.log.push(`${action} ${id}`);
  }
  sleep(id: string, mode: string): boolean {
    this.log.push(`sleep ${id} ${mode}`);
    return true;
  }
}

/** The state of the second of three tabs of a window, whose menu the tests open. */
interface MenuState {
  readonly pinned?: boolean;
  readonly muted?: boolean;
  readonly busy?: boolean;
  /** Whether the tab is the active one; the last tab is active otherwise. */
  readonly active?: boolean;
  /** The side of a split view that the tab is: with the third tab, or with the first one. */
  readonly split?: 'start' | 'end';
  /**
   * The groups of the window: the tab in a group of its own, the first tab in a group named
   * `R&D`, or both.
   */
  readonly groups?: 'own' | 'other' | 'both';
}

/**
 * A window with three tabs, the second of them pinned, muted, active or a side of a split
 * view when asked, and its tab strip. The tabs that the window does not show may sleep, unless
 * the second one is busy.
 */
function windowWith(
  position: TabStripPosition,
  tab: MenuState = {},
): { window: Mutable<TabMenuWindow>; views: FakeViews; ids: string[] } {
  const views = new FakeViews();
  const tabs = new TabService(views, 'about:blank');
  const ids = ['a', 'b', 'c'].map((name) => tabs.open(`https://${name}.example/`));
  const [first = '', middle = '', last = ''] = ids;
  if (tab.pinned === true) tabs.pin(middle, true);
  if (tab.muted === true) tabs.update(middle, { muted: true });
  if (tab.split === 'start') tabs.split(middle, last);
  if (tab.split === 'end') tabs.split(first, middle);
  if (tab.active === true) tabs.activate(middle);
  if (tab.groups === 'own' || tab.groups === 'both') {
    editGroups(tabs, (strip) => strip.createGroup(middle));
  }
  if (tab.groups === 'other' || tab.groups === 'both') {
    editGroups(tabs, (strip) => strip.createGroup(first, { name: 'R&D' }));
  }
  const window: Mutable<TabMenuWindow> = {
    tabs,
    tabAction: vi.fn(),
    setMuted: vi.fn(),
    canSleep: (id) => id !== tabs.active?.id && !(tab.busy === true && id === middle),
    shortcuts: () => shortcutTable('linux'),
    tabStripPosition: () => position,
    splitView: () => true,
  };
  return { window, views, ids };
}

/** The texts of the items of a menu template. */
function labels(template: readonly MenuItemConstructorOptions[] | undefined): string[] {
  return (template ?? []).flatMap((item) => (item.label === undefined ? [] : [item.label]));
}

/** Chooses an item of a menu template, as a click on it does. */
function choose(item: MenuItemConstructorOptions): void {
  (item.click as (() => void) | undefined)?.();
}

/** The texts without access keys of the menu of the second of three tabs. */
function texts(position: TabStripPosition, locale: string, platform: string): string[] {
  const { window, ids } = windowWith(position);
  return labels(tabMenuTemplate(window, ids[1] ?? '', translatorFor(locale, platform))).map(
    (label) => label.replaceAll('&', ''),
  );
}

/** The items of the menu of the second of three tabs, `-` for separators, in English. */
function menuItems(state: MenuState): string[] {
  const { window, ids } = windowWith('top', state);
  return (tabMenuTemplate(window, ids[1] ?? '', translatorFor('en-US', 'linux')) ?? []).map(
    (item) => (item.type === 'separator' ? '-' : (item.label ?? '')),
  );
}

/**
 * The items of the tab menu with the texts of Pin and Mute for the state of the tab, and the
 * items of split view and of groups.
 */
function around(
  pin: string,
  mute: string,
  split: readonly string[] = ['Open in split v&iew'],
  groups: readonly string[] = ['Add to new &group'],
): string[] {
  return [
    '&New tab to the right',
    ...split,
    ...groups,
    '-',
    '&Reload',
    '&Duplicate',
    pin,
    mute,
    'Put tab to &sleep',
    '-',
    '&Close',
    'Close &other tabs',
    'Close tabs to the righ&t',
    '-',
    'R&eopen closed tab',
  ];
}

/** The item of the menu of a tab that puts the tab to sleep. */
function sleepItem(window: TabMenuWindow, id: string): MenuItemConstructorOptions {
  const found = (tabMenuTemplate(window, id, translatorFor('en-US', 'linux')) ?? []).find(
    (item) => item.label === 'Put tab to &sleep',
  );
  if (found === undefined) throw new Error('No sleep item');
  return found;
}

describe('tabMenuTemplate', () => {
  it.each(['en-US', 'de'])(
    'gives every item of the tab menu in %s its own access key on Windows and Linux',
    (locale) => {
      for (const platform of ['win32', 'linux']) {
        const i18n = translatorFor(locale, platform);
        for (const position of ['top', 'left'] as const) {
          const states: readonly (readonly [MenuState, number])[] = [
            [{}, 12],
            [{ pinned: true }, 11],
            [{ muted: true }, 12],
            [{ active: true }, 12],
            [{ split: 'start' }, 13],
            [{ split: 'end', active: true }, 13],
            [{ split: 'end', muted: true }, 13],
            [{ groups: 'own' }, 13],
            [{ groups: 'other' }, 12],
            [{ groups: 'both', split: 'start' }, 14],
          ];
          for (const [state, count] of states) {
            const { window, ids } = windowWith(position, state);
            const items = labels(tabMenuTemplate(window, ids[1] ?? '', i18n));
            const name = `${platform} ${position} ${JSON.stringify(state)}`;
            expect(items).toHaveLength(count);
            expect(items).toContain(locale === 'de' ? 'Tab schla&fen legen' : 'Put tab to &sleep');
            expect([name, ...accessKeyProblems(items)]).toEqual([name]);
            // The submenu of the groups has static items with access keys of their own.
            const submenu = tabMenuTemplate(window, ids[1] ?? '', i18n)?.find((item) =>
              Array.isArray(item.submenu),
            )?.submenu;
            const statics = Array.isArray(submenu) ? labels(submenu).slice(0, 1) : [];
            expect([name, ...accessKeyProblems(statics)]).toEqual([name]);
          }
        }
      }
    },
  );

  it('lists its items in their order for a plain, a pinned, a muted and a grouped tab', () => {
    expect(menuItems({})).toEqual(around('&Pin', '&Mute tab'));
    expect(menuItems({ pinned: true })).toEqual(around('Un&pin', '&Mute tab', undefined, []));
    expect(menuItems({ groups: 'own' })).toEqual(
      around('&Pin', '&Mute tab', undefined, ['Add to new &group', 'Remo&ve from group']),
    );
    expect(menuItems({ groups: 'other' })).toEqual(
      around('&Pin', '&Mute tab', undefined, ['Add to &group']),
    );
    expect(menuItems({ muted: true })).toEqual(around('&Pin', 'Un&mute tab'));
    expect(menuItems({ active: true })).toEqual(
      around('&Pin', '&Mute tab', ['New tab in split v&iew']),
    );
    expect(menuItems({ split: 'start' })).toEqual(
      around('&Pin', '&Mute tab', ['End split v&iew', 'Sw&ap sides']),
    );
    expect(texts('top', 'en-US', 'darwin')).toContain('Put Tab to Sleep');
  });

  it('offers sleep only for a tab that may sleep, and puts it to sleep while it is open', () => {
    const { window, views, ids } = windowWith('top');
    const [first = '', middle = '', last = ''] = ids;
    // The last tab that opened is the active one, which the window shows.
    expect(sleepItem(window, last).enabled).toBe(false);
    expect(sleepItem(window, middle).enabled).toBe(true);
    const busy = windowWith('top', { busy: true });
    expect(sleepItem(busy.window, busy.ids[1] ?? '').enabled).toBe(false);
    expect(sleepItem(busy.window, busy.ids[0] ?? '').enabled).toBe(true);
    const item = sleepItem(window, middle);
    choose(item);
    expect(views.log).toEqual([`sleep ${middle} manual`]);
    // A tab that closed while its menu was open does not sleep.
    const closing = sleepItem(window, first);
    window.tabs.close(first);
    choose(closing);
    expect(views.log).toEqual([`sleep ${middle} manual`, `destroy ${first}`]);
  });

  it('names the tabs below a tab in a tab strip at a side, and to its right otherwise', () => {
    for (const position of ['top', 'bottom'] as const) {
      expect(texts(position, 'en-US', 'linux')).toEqual(
        expect.arrayContaining(['New tab to the right', 'Close tabs to the right']),
      );
      expect(texts(position, 'de', 'win32')).toEqual(
        expect.arrayContaining(['Neuer Tab rechts', 'Tabs rechts schließen']),
      );
    }
    for (const position of ['left', 'right'] as const) {
      const english = texts(position, 'en-US', 'linux');
      expect(english).toEqual(expect.arrayContaining(['New tab below', 'Close tabs below']));
      expect(english.join()).not.toMatch(/right/i);
      const german = texts(position, 'de', 'win32');
      expect(german).toEqual(
        expect.arrayContaining(['Neuer Tab darunter', 'Tabs darunter schließen']),
      );
      expect(german.join()).not.toMatch(/rechts/i);
      expect(texts(position, 'en-US', 'darwin')).toEqual(
        expect.arrayContaining(['New Tab Below', 'Close Tabs Below']),
      );
    }
  });

  it('does nothing for a tab that closed while its menu was open', () => {
    const { window, views, ids } = windowWith('top');
    const [first = '', middle = '', last = ''] = ids;
    const template = tabMenuTemplate(window, middle, translatorFor('en-US', 'linux')) ?? [];
    // A page closes its own tab, such as a sign-in page after its redirect.
    window.tabs.close(middle);
    const kept = window.tabs.all.map((tab) => tab.id);
    for (const item of template) {
      if (item.type === 'separator' || item.label === 'R&eopen closed tab') continue;
      expect(() => choose(item)).not.toThrow();
    }
    expect(window.tabs.all.map((tab) => tab.id)).toEqual(kept);
    expect(kept).toEqual([first, last]);
    expect(views.log).toEqual([`destroy ${middle}`]);
    expect(tabMenuTemplate(window, middle, translatorFor('en-US', 'linux'))).toBeUndefined();
  });

  it('shows the shortcuts that people gave the commands of a tab in the menu of the active tab', () => {
    const { window, ids } = windowWith('top');
    const [first = '', , last = ''] = ids;
    window.shortcuts = () =>
      shortcutTable('linux', {
        'tab.duplicate': ['Ctrl+Shift+Y'],
        'tab.pin': ['Alt+P'],
        'tab.mute': ['Alt+M'],
        'tab.closeOthers': ['Ctrl+Shift+O'],
        'tab.closeRight': ['Ctrl+Shift+K'],
      });
    const accelerators = (tabId: string): Record<string, string> =>
      Object.fromEntries(
        (tabMenuTemplate(window, tabId, translatorFor('en-US', 'linux')) ?? []).flatMap((item) =>
          item.label === undefined || item.accelerator === undefined
            ? []
            : [[item.label.replaceAll('&', ''), item.accelerator]],
        ),
      );
    // The last tab that opened is the active one.
    expect(window.tabs.active?.id).toBe(last);
    expect(accelerators(last)).toEqual({
      'New tab in split view': 'Ctrl+Shift+S',
      Duplicate: 'Ctrl+Shift+Y',
      Pin: 'Alt+P',
      'Mute tab': 'Alt+M',
      Close: 'Ctrl+W',
      'Close other tabs': 'Ctrl+Shift+O',
      'Close tabs to the right': 'Ctrl+Shift+K',
      'Reopen closed tab': 'Ctrl+Shift+T',
    });
    expect(accelerators(first)).toEqual({ 'Reopen closed tab': 'Ctrl+Shift+T' });
  });

  it('runs its items on the tab while it is open', () => {
    const { window, views, ids } = windowWith('top');
    const [, middle = ''] = ids;
    const template = tabMenuTemplate(window, middle, translatorFor('en-US', 'linux')) ?? [];
    const item = (label: string): MenuItemConstructorOptions => {
      const found = template.find((candidate) => candidate.label === label);
      if (found === undefined) throw new Error(`No item ${label}`);
      return found;
    };
    choose(item('&Reload'));
    expect(views.log).toEqual([`reload ${middle}`]);
    choose(item('&Pin'));
    expect(window.tabs.all.find((tab) => tab.id === middle)?.pinned).toBe(true);
    choose(item('&Close'));
    expect(window.tabs.all.some((tab) => tab.id === middle)).toBe(false);
  });
});

/** The items of split view in the menu of the second tab, as they show, with whether each is enabled. */
function splitEntries(
  state: MenuState,
  locale = 'en-US',
  platform = 'linux',
  change: Partial<TabMenuWindow> = {},
): [string, boolean][] {
  const { window, ids } = windowWith('top', state);
  Object.assign(window, change);
  const split = ['split', 'Split', 'geteilte', 'Geteilte', 'Seiten', 'Sides', 'sides'];
  return (tabMenuTemplate(window, ids[1] ?? '', translatorFor(locale, platform)) ?? []).flatMap(
    (item) =>
      item.label !== undefined && split.some((word) => item.label?.includes(word) === true)
        ? [[item.label.replaceAll('&', ''), item.enabled !== false]]
        : [],
  );
}

describe('the items of split view in the tab menu', () => {
  it('offers to open a tab beside the active tab, a new tab beside the active tab itself, and to swap or end a split view', () => {
    expect(splitEntries({})).toEqual([['Open in split view', true]]);
    expect(splitEntries({ active: true })).toEqual([['New tab in split view', true]]);
    expect(splitEntries({ split: 'start' })).toEqual([
      ['End split view', true],
      ['Swap sides', true],
    ]);
    expect(splitEntries({ split: 'end' }, 'de', 'win32')).toEqual([
      ['Geteilte Ansicht beenden', true],
      ['Seiten tauschen', true],
    ]);
    expect(splitEntries({}, 'de', 'linux')).toEqual([['In geteilter Ansicht öffnen', true]]);
    expect(splitEntries({ active: true }, 'de', 'linux')).toEqual([
      ['Neuer Tab in geteilter Ansicht', true],
    ]);
    // macOS writes them in title case.
    expect(splitEntries({}, 'en-US', 'darwin')).toEqual([['Open in Split View', true]]);
    expect(splitEntries({ active: true }, 'en-US', 'darwin')).toEqual([
      ['New Tab in Split View', true],
    ]);
    expect(splitEntries({ split: 'start' }, 'en-US', 'darwin')).toEqual([
      ['End Split View', true],
      ['Swap Sides', true],
    ]);
  });

  it('offers nothing for a pinned tab or beside a pinned active tab, and nothing while split view is off', () => {
    expect(splitEntries({ pinned: true })).toEqual([['Open in split view', false]]);
    expect(splitEntries({ pinned: true, active: true })).toEqual([
      ['New tab in split view', false],
    ]);
    const { window, ids } = windowWith('top');
    window.tabs.pin(ids[2] ?? '', true);
    expect(
      (tabMenuTemplate(window, ids[1] ?? '', translatorFor('en-US', 'linux')) ?? []).find(
        (item) => item.label === 'Open in split v&iew',
      )?.enabled,
    ).toBe(false);
    expect(splitEntries({}, 'en-US', 'linux', { splitView: () => false })).toEqual([]);
    expect(splitEntries({ split: 'start' }, 'en-US', 'linux', { splitView: () => false })).toEqual(
      [],
    );
  });

  it('runs its items on the tab, and nothing for a tab that closed while the menu was open', () => {
    const { window, ids } = windowWith('top', { split: 'start' });
    const [, middle = ''] = ids;
    const template = tabMenuTemplate(window, middle, translatorFor('en-US', 'linux')) ?? [];
    const item = (label: string): MenuItemConstructorOptions => {
      const found = template.find((candidate) => candidate.label === label);
      if (found === undefined) throw new Error(`No item ${label}`);
      return found;
    };
    choose(item('Sw&ap sides'));
    choose(item('End split v&iew'));
    expect(window.tabAction).toHaveBeenCalledWith(middle, 'swapSplit');
    expect(window.tabAction).toHaveBeenCalledWith(middle, 'endSplit');
    const other = windowWith('top');
    const open = (
      tabMenuTemplate(other.window, other.ids[1] ?? '', translatorFor('en-US', 'linux')) ?? []
    ).find((candidate) => candidate.label === 'Open in split v&iew');
    other.window.tabs.close(other.ids[1] ?? '');
    if (open !== undefined) choose(open);
    expect(other.window.tabAction).not.toHaveBeenCalled();
  });

  it('keeps the other tab of a split view out of closing the other tabs and the tabs to the right', () => {
    const { window, ids } = windowWith('top', { split: 'end' });
    const [first = '', middle = ''] = ids;
    const enabled = (id: string, label: string): boolean | undefined =>
      (tabMenuTemplate(window, id, translatorFor('en-US', 'linux')) ?? []).find(
        (item) => item.label === label,
      )?.enabled;
    // The pair a|b and c: the tabs to the right of a start after b.
    expect(enabled(first, 'Close tabs to the righ&t')).toBe(true);
    expect(enabled(first, 'Close &other tabs')).toBe(true);
    window.tabs.close(ids[2] ?? '');
    expect(enabled(first, 'Close tabs to the righ&t')).toBe(false);
    expect(enabled(middle, 'Close &other tabs')).toBe(false);
  });
});

/** A text of x as long as asked. */
const x = (count: number): string => 'x'.repeat(count);

/** Runs code as on another system, with `process.platform` set to it. */
function onPlatform<T>(platform: string, run: () => T): T {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return run();
  } finally {
    if (real !== undefined) Object.defineProperty(process, 'platform', real);
  }
}

/**
 * The items of groups in the menu of the second tab, with the items of their submenu, as the
 * menu is made on a system.
 */
function groupEntries(state: MenuState, locale = 'en-US', platform = 'linux'): unknown[] {
  const { window, ids } = windowWith('top', state);
  const words = ['group', 'Group', 'Gruppe'];
  const template = onPlatform(platform, () =>
    tabMenuTemplate(window, ids[1] ?? '', translatorFor(locale, platform)),
  );
  return (template ?? []).flatMap((item) =>
    item.label !== undefined && words.some((word) => item.label?.includes(word) === true)
      ? [
          Array.isArray(item.submenu)
            ? [item.label, item.submenu.map((entry) => entry.label ?? '-')]
            : item.label,
        ]
      : [],
  );
}

describe('the items of groups in the tab menu', () => {
  it('puts a tab in a new group, in another group of the window, or out of its group', () => {
    expect(groupEntries({})).toEqual(['Add to new &group']);
    expect(groupEntries({ groups: 'own' })).toEqual(['Add to new &group', 'Remo&ve from group']);
    // The name of a group is no access key; a group without a name shows its first tab.
    expect(groupEntries({ groups: 'both' })).toEqual([
      ['Add to &group', ['&New group', '-', 'R&&D']],
      'Remo&ve from group',
    ]);
    const { window, ids } = windowWith('top', { groups: 'own' });
    window.tabs.update(ids[1] ?? '', { title: 'Mail & more' });
    const third = windowWith('top');
    editGroups(third.window.tabs, (strip) => strip.createGroup(third.ids[0] ?? ''));
    third.window.tabs.update(third.ids[0] ?? '', { title: 'Q&A' });
    const submenu = (
      tabMenuTemplate(third.window, third.ids[2] ?? '', translatorFor('en-US', 'linux')) ?? []
    ).find((item) => Array.isArray(item.submenu))?.submenu;
    expect(Array.isArray(submenu) ? labels(submenu) : []).toEqual([
      '&New group',
      'Group with “Q&&A”',
    ]);
    expect(groupEntries({ groups: 'both' }, 'de', 'win32')).toEqual([
      ['Zu Gruppe hin&zufügen', ['&Neue Gruppe', '-', 'R&&D']],
      'Aus Gruppe &entfernen',
    ]);
    expect(groupEntries({}, 'de', 'linux')).toEqual(['Zu neuer Gruppe hin&zufügen']);
    // macOS writes them in title case. Its native menus hide an & as well and show && as one.
    expect(groupEntries({ groups: 'both' }, 'en-US', 'darwin')).toEqual([
      ['Add to Group', ['New Group', '-', 'R&&D']],
      'Remove from Group',
    ]);
    expect(groupEntries({ groups: 'both' }, 'de', 'darwin')).toEqual([
      ['Zu Gruppe hin&zufügen', ['&Neue Gruppe', '-', 'R&&D']],
      'Aus Gruppe &entfernen',
    ]);
    // Pinned tabs are never in a group.
    expect(groupEntries({ pinned: true })).toEqual([]);
  });

  it('cuts the title or the address that names a group without a name where the menus of bookmarks cut titles', () => {
    const { window, ids } = windowWith('top');
    const [first = '', , last = ''] = ids;
    editGroups(window.tabs, (strip) => strip.createGroup(first));
    // The item of the group in the menu of the last tab, on a system.
    const named = (update: { title?: string; url?: string }, platform = 'linux'): string => {
      window.tabs.update(first, update);
      const template = onPlatform(platform, () =>
        tabMenuTemplate(window, last, translatorFor('en-US', platform)),
      );
      const submenu = (template ?? []).find((item) => Array.isArray(item.submenu))?.submenu;
      return Array.isArray(submenu) ? (submenu.at(-1)?.label ?? '') : '';
    };
    expect(named({ title: x(300) })).toBe(`Group with “${x(300)}”`);
    expect(named({ title: x(4000) })).toBe(`Group with “${x(300)}…”`);
    // A character of several code points stays whole, and spaces before the cut go.
    const thumb = '👍🏽';
    expect(named({ title: `${x(299)}${thumb}${'y'.repeat(9)}` })).toBe(
      `Group with “${x(299)}${thumb}…”`,
    );
    expect(named({ title: thumb.repeat(300) })).toBe(`Group with “${thumb.repeat(300)}”`);
    expect(named({ title: `${x(298)}  ${'y'.repeat(9)}` })).toBe(`Group with “${x(298)}…”`);
    // An & at the cut stays one & that marks no access key, also on macOS.
    expect(named({ title: `${x(299)}&${'y'.repeat(9)}` })).toBe(`Group with “${x(299)}&&…”`);
    expect(named({ title: `Q&A ${x(400)}` }, 'darwin')).toBe(`Group with “Q&&A ${x(296)}…”`);
    // A page without a title shows its address, cut as well, however long it is.
    const address = `https://a.example/${'p'.repeat(2_000_000)}`;
    expect(named({ title: '', url: address })).toBe(`Group with “${address.slice(0, 300)}…”`);
  });

  it('runs its items on the tab, opens the popover of a new group, and does nothing for a closed tab', () => {
    const { window, ids } = windowWith('top', { groups: 'other' });
    const [first = '', middle = ''] = ids;
    const edited: string[] = [];
    const template = (id: string): MenuItemConstructorOptions[] =>
      tabMenuTemplate(window, id, translatorFor('en-US', 'linux'), {
        editGroup: (groupId) => edited.push(groupId),
      }) ?? [];
    const submenu = template(middle).find((item) => Array.isArray(item.submenu))?.submenu;
    const entries = Array.isArray(submenu) ? submenu : [];
    const into = entries.find((entry) => entry.label === 'R&&D');
    if (into === undefined) throw new Error('No item of the group');
    choose(into);
    const groupOf = (id: string): string | undefined =>
      window.tabs.all.find((tab) => tab.id === id)?.group?.id;
    expect(groupOf(middle)).toBe(groupOf(first));
    const remove = template(middle).find((item) => item.label === 'Remo&ve from group');
    if (remove === undefined) throw new Error('No item that takes the tab out');
    choose(remove);
    expect(groupOf(middle)).toBeUndefined();
    const fresh = entries.find((entry) => entry.label === '&New group');
    if (fresh === undefined) throw new Error('No item for a new group');
    choose(fresh);
    const made = groupOf(middle);
    expect(made).toBeDefined();
    expect(made).not.toBe(groupOf(first));
    expect(edited).toEqual([made]);
    // A tab that closed while its menu was open joins and leaves nothing.
    const closing = template(middle);
    window.tabs.close(middle);
    for (const item of closing) {
      if (Array.isArray(item.submenu)) item.submenu.forEach(choose);
      else if (/group/.test(item.label ?? '')) choose(item);
    }
    expect(edited).toEqual([made]);
  });
});
