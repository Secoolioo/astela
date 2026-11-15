import { describe, expect, it } from 'vitest';
import type { PaletteItem } from '../../shared/ipc/overlay-contracts.ts';
import { windowCommands, type WindowCommand } from '../../shared/shortcuts.ts';
import { Translator, type MessageKey } from '../i18n/i18n.ts';
import {
  keptSelection,
  localGroups,
  localLimits,
  mergeGroups,
  moveSelection,
  pageRows,
  parseQuery,
  remoteScope,
  type LocalContent,
  type PaletteGroup,
} from '../overlay/palette-model.ts';
import { settingsIndex } from '../ui-kit/settings-index.ts';

const english = new Translator('en');
const german = new Translator('de');
const t =
  (i18n: Translator) =>
  (key: MessageKey, params?: Readonly<Record<string, string>>): string =>
    i18n.t(key, params);

/** A palette in which every command but its own can run. */
const content = (change: Partial<LocalContent> = {}): LocalContent => ({
  commands: windowCommands
    .filter((id) => id !== 'palette.open')
    .map((id) => ({ id, shortcuts: id === 'zoom.in' ? ['Ctrl++', 'Ctrl+='] : [] })),
  recent: [],
  vertical: false,
  absent: [],
  ...change,
});

/** The labels of the rows of a group. */
function labels(groups: readonly PaletteGroup[], id: PaletteGroup['id']): string[] {
  return (groups.find((group) => group.id === id)?.rows ?? []).map((row) =>
    row.kind === 'item' ? row.key : row.label,
  );
}

/** The ids of the commands of a group. */
function commands(groups: readonly PaletteGroup[], id: PaletteGroup['id']): WindowCommand[] {
  return (groups.find((group) => group.id === id)?.rows ?? []).flatMap((row) =>
    row.kind === 'command' ? [row.id] : [],
  );
}

describe('parseQuery', () => {
  it('narrows the search with a prefix followed by a space', () => {
    expect(parseQuery('> zoom')).toEqual({ scope: 'commands', text: 'zoom' });
    expect(parseQuery('% fixture home')).toEqual({ scope: 'tabs', text: 'fixture home' });
    expect(parseQuery('* ')).toEqual({ scope: 'bookmarks', text: '' });
    expect(parseQuery('# dichte')).toEqual({ scope: 'settings', text: 'dichte' });
    // German layouts type ^ with its dead key and a space; the next space follows it.
    expect(parseQuery('^ ')).toEqual({ scope: 'history', text: '' });
  });

  it('reads no prefix without its space, in the middle of the text or twice', () => {
    expect(parseQuery('>')).toEqual({ scope: undefined, text: '>' });
    expect(parseQuery('>zoom')).toEqual({ scope: undefined, text: '>zoom' });
    expect(parseQuery('zoom > in')).toEqual({ scope: undefined, text: 'zoom > in' });
    expect(parseQuery('^')).toEqual({ scope: undefined, text: '^' });
    expect(parseQuery('> > x')).toEqual({ scope: 'commands', text: '> x' });
  });
});

describe('remoteScope', () => {
  it('asks the browser process only for what it has, and nothing for everything without text', () => {
    expect(remoteScope('all', '')).toBeUndefined();
    expect(remoteScope('all', '  ')).toBeUndefined();
    expect(remoteScope('all', 'fixture')).toBe('all');
    expect(remoteScope('tabs', '')).toBe('tabs');
    expect(remoteScope('bookmarks', '')).toBe('bookmarks');
    expect(remoteScope('history', 'x')).toBe('history');
    expect(remoteScope('commands', 'zoom')).toBeUndefined();
    expect(remoteScope('settings', 'dichte')).toBeUndefined();
  });
});

describe('localGroups', () => {
  it('lists the commands that ran last and then every command without text', () => {
    const groups = localGroups(
      '',
      'all',
      content({ recent: ['zoom.in', 'tab.new', 'page.back'] }),
      t(english),
    );
    expect(groups.map((group) => group.id)).toEqual(['recent', 'commands']);
    // Only commands that can run now show as recently used.
    const runnable = content().commands.filter((command) => command.id !== 'page.back');
    const now = localGroups(
      '',
      'all',
      content({ commands: runnable, recent: ['zoom.in', 'tab.new', 'page.back'] }),
      t(english),
    );
    expect(commands(now, 'recent')).toEqual(['zoom.in', 'tab.new']);
    expect(commands(now, 'commands')).toEqual(runnable.map((command) => command.id));
    expect(
      commands(localGroups('zoom', 'all', content({ recent: ['zoom.in'] }), t(english)), 'recent'),
    ).toEqual([]);
  });

  it('finds commands by their names in English and German and by their keywords', () => {
    const first = (text: string, i18n = english): WindowCommand | undefined =>
      commands(localGroups(text, 'all', content(), t(i18n)), 'commands')[0];
    expect(first('zoom in')).toBe('zoom.in');
    expect(first('vergrößern')).toBe('zoom.in');
    expect(first('VERGROSSERN')).toBe('zoom.in');
    expect(first('incognito')).toBe('window.newPrivate');
    expect(first('inkognito')).toBe('window.newPrivate');
    expect(first('console')).toBe('devtools.toggle');
    expect(first('Zoom in', german)).toBe('zoom.in');
    expect(localGroups('vergrößern', 'all', content(), t(english))[0]?.rows[0]).toMatchObject({
      label: 'Zoom in',
      shortcut: 'Ctrl++',
    });
  });

  it('puts a name that starts with the text first, then one whose words start with it', () => {
    // Reopen the closed tab and Quit, by its keywords, follow in the order of the catalog.
    expect(commands(localGroups('close', 'commands', content(), t(english)), 'commands')).toEqual([
      'tab.close',
      'tab.closeOthers',
      'tab.closeRight',
      'tab.reopen',
      'app.quit',
    ]);
    expect(commands(localGroups('oth tab', 'commands', content(), t(english)), 'commands')).toEqual(
      ['tab.closeOthers'],
    );
  });

  it('shows a few commands with everything, and every match in their own scope', () => {
    const all = localGroups('tab', 'all', content(), t(english));
    expect(commands(all, 'commands')).toHaveLength(localLimits.commands);
    const own = localGroups('tab', 'commands', content(), t(english));
    expect(commands(own, 'commands').length).toBeGreaterThan(localLimits.commands);
    expect(own.map((group) => group.id)).toEqual(['commands']);
    expect(commands(localGroups('', 'commands', content(), t(english)), 'commands')).toHaveLength(
      content().commands.length,
    );
  });

  it('names closing the tabs to the right after the tabs below with the tab strip at a side', () => {
    const side = localGroups('close the', 'commands', content({ vertical: true }), t(english));
    expect(labels(side, 'commands')).toContain('Close the tabs below');
    expect(labels(side, 'commands')).not.toContain('Close the tabs to the right');
  });

  it('finds settings by their texts in English and German, in their section', () => {
    const density = localGroups('dichte', 'all', content(), t(english));
    expect(density.find((group) => group.id === 'settings')?.rows[0]).toMatchObject({
      kind: 'setting',
      id: 'appearance.density',
      label: 'Density',
      section: 'Appearance',
    });
    const inGerman = localGroups('dichte', 'settings', content(), t(german));
    expect(labels(inGerman, 'settings')[0]).toBe('Dichte');
  });

  it('lists the rows of a section whose name matches', () => {
    const rows = localGroups('darstellung', 'settings', content(), t(english));
    const appearance = settingsIndex.find((section) => section.id === 'appearance')?.rows ?? [];
    expect(labels(rows, 'settings')).toEqual(
      appearance.map((row) => english.t(row.keys[0] ?? 'settings.appearance')),
    );
  });

  it('leaves out the rows of shortcuts, rows that another setting shows and settings that are not offered', () => {
    const all = localGroups('', 'settings', content(), t(english));
    const ids = (all[0]?.rows ?? []).flatMap((row) => (row.kind === 'setting' ? [row.id] : []));
    expect(ids.filter((id) => id.startsWith('shortcut-'))).toEqual([]);
    expect(ids).toContain('shortcuts-reset');
    expect(ids).toContain('commandPalette.enabled');
    expect(ids).not.toContain('startup.urls');
    const offered = settingsIndex
      .flatMap((section) => section.rows)
      .filter((row) => !row.id.startsWith('shortcut-') && row.when === undefined);
    expect(ids).toEqual(offered.map((row) => row.id).slice(0, localLimits.settingsScope));
    const alt = (absent: string[]): string[] =>
      (localGroups('alt', 'settings', content({ absent }), t(english))[0]?.rows ?? []).flatMap(
        (row) => (row.kind === 'setting' ? [row.id] : []),
      );
    expect(alt([])).toContain('keys.altOpensMenu');
    expect(alt(['keys.altOpensMenu'])).not.toContain('keys.altOpensMenu');
  });

  it('shows a few settings with everything and text, and none without text', () => {
    const many = localGroups('tab', 'all', content(), t(english));
    expect(labels(many, 'settings').length).toBeLessThanOrEqual(localLimits.settings);
    expect(localGroups('', 'all', content(), t(english)).map((group) => group.id)).not.toContain(
      'settings',
    );
    expect(localGroups('fixture', 'tabs', content(), t(english))).toEqual([]);
  });
});

/** An open tab as the browser process answers it. */
const tab = (title: string, place: 'current' | 'window' | 'other'): PaletteItem => ({
  kind: 'tab',
  title,
  url: `https://${title}.example/`,
  favicon: null,
  place,
});

describe('mergeGroups', () => {
  const items: PaletteItem[] = [
    tab('a', 'current'),
    tab('b', 'window'),
    tab('c', 'other'),
    { kind: 'bookmark', title: 'Home', url: 'https://home.example/' },
    { kind: 'history', title: 'Find', url: 'https://find.example/' },
    { kind: 'search', query: 'fixture', host: 'search.example' },
  ];

  it('orders the groups: commands, open tabs, settings, bookmarks, history and the web', () => {
    const groups = mergeGroups(
      [
        {
          id: 'settings',
          rows: [{ kind: 'setting', key: 's', id: 'x', label: 'X', section: 'Y' }],
        },
        {
          id: 'commands',
          rows: [{ kind: 'command', key: 'c', id: 'tab.new', label: 'N', shortcut: undefined }],
        },
      ],
      { answer: 3, items: items.slice(1) },
      'all',
    );
    expect(groups.map((group) => group.id)).toEqual([
      'commands',
      'tabs',
      'settings',
      'bookmarks',
      'history',
      'web',
    ]);
    expect(groups[1]?.rows[0]).toMatchObject({ kind: 'item', answer: 3, index: 0 });
    expect(groups.at(-1)?.rows[0]).toMatchObject({ key: 'search:fixture', index: 4 });
  });

  it('splits tab search into this window and other windows', () => {
    const groups = mergeGroups([], { answer: 1, items: items.slice(0, 3) }, 'tabs');
    expect(groups.map((group) => [group.id, group.rows.length])).toEqual([
      ['thisWindow', 2],
      ['otherWindows', 1],
    ]);
  });

  it('gives rows of the same page their own keys, and leaves out empty groups', () => {
    const twice = [tab('a', 'window'), tab('a', 'window')];
    const groups = mergeGroups([{ id: 'recent', rows: [] }], { answer: 1, items: twice }, 'all');
    expect(groups.map((group) => group.id)).toEqual(['tabs']);
    expect(groups[0]?.rows.map((row) => row.key)).toEqual([
      'tab:https://a.example/',
      'tab:https://a.example/#1',
    ]);
    expect(mergeGroups([], undefined, 'all')).toEqual([]);
  });
});

describe('moveSelection', () => {
  const keys = Array.from({ length: 12 }, (_, index) => `k${String(index)}`);

  it('moves by one and goes round at the ends', () => {
    expect(moveSelection(keys, 'k0', 'next')).toBe('k1');
    expect(moveSelection(keys, 'k11', 'next')).toBe('k0');
    expect(moveSelection(keys, 'k0', 'previous')).toBe('k11');
    expect(moveSelection(keys, undefined, 'next')).toBe('k0');
    expect(moveSelection(keys, 'gone', 'previous')).toBe('k11');
    expect(moveSelection([], 'k0', 'next')).toBeUndefined();
  });

  it(`moves by a page of ${String(pageRows)} rows and stops at the ends`, () => {
    expect(moveSelection(keys, 'k0', 'pageDown')).toBe('k8');
    expect(moveSelection(keys, 'k8', 'pageDown')).toBe('k11');
    expect(moveSelection(keys, 'k9', 'pageUp')).toBe('k1');
    expect(moveSelection(keys, 'k3', 'pageUp')).toBe('k0');
  });

  it('keeps the row that the keys marked when an answer arrives, and follows the first row before', () => {
    expect(keptSelection(['a', 'b', 'c'], 'b', true)).toBe('b');
    expect(keptSelection(['x', 'a', 'b'], 'b', true)).toBe('b');
    expect(keptSelection(['a', 'c'], 'b', true)).toBe('a');
    expect(keptSelection(['x', 'a', 'b'], 'a', false)).toBe('x');
    expect(keptSelection([], 'a', true)).toBeUndefined();
  });
});
