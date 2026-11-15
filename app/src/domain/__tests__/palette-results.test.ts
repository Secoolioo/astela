import { describe, expect, it } from 'vitest';
import {
  paletteLimits,
  paletteResults,
  type PalettePage,
  type PaletteResult,
  type PaletteSources,
  type PaletteTab,
} from '../palette/results.ts';

/** A tab of a window. */
const tab = (
  tabId: string,
  title: string,
  place: PaletteTab['place'] = 'window',
  windowId = 1,
): PaletteTab => ({
  windowId,
  tabId,
  title,
  url: `https://${tabId}.example/`,
  favicon: null,
  place,
});

/** A page of the bookmarks or the history. */
const page = (title: string, url: string): PalettePage => ({ title, url });

const sources = (change: Partial<PaletteSources> = {}): PaletteSources => ({
  tabs: [],
  bookmarks: [],
  history: [],
  target: undefined,
  ...change,
});

/** What a list of results shows, in short. */
function shown(results: readonly PaletteResult[]): string[] {
  return results.map((result) => {
    if (result.kind === 'tab') return `tab ${result.tab.tabId}`;
    if (result.kind === 'search') return `search ${result.query}`;
    if (result.kind === 'url') return `url ${result.url}`;
    return `${result.kind} ${result.url}`;
  });
}

describe('paletteResults', () => {
  const tabs = [
    tab('a', 'Fixture home', 'current'),
    tab('b', 'Fixture find'),
    tab('c', 'Other page', 'other', 2),
    tab('d', 'Fixture second', 'other', 2),
  ];

  it('lists every tab without text in tab search, this window first, the active tab too', () => {
    expect(shown(paletteResults('', 'tabs', sources({ tabs })))).toEqual([
      'tab a',
      'tab b',
      'tab c',
      'tab d',
    ]);
    expect(shown(paletteResults('  ', 'tabs', sources({ tabs })))).toHaveLength(4);
  });

  it('finds tabs by every word of their title or address, the best match first', () => {
    const many = [
      tab('x', 'A page about fixtures'),
      tab('y', 'The fixture of home'),
      tab('z', 'Fixture home'),
    ];
    // The title that starts with the text, then each word starting a word, then the rest.
    expect(shown(paletteResults('fixture home', 'tabs', sources({ tabs: many })))).toEqual([
      'tab z',
      'tab y',
    ]);
    // Ties keep the order of the tabs.
    expect(shown(paletteResults('FIXTUR', 'tabs', sources({ tabs: many })))).toEqual([
      'tab z',
      'tab x',
      'tab y',
    ]);
    expect(shown(paletteResults('ixture', 'tabs', sources({ tabs: many })))).toEqual([
      'tab x',
      'tab y',
      'tab z',
    ]);
    expect(shown(paletteResults('y.example', 'tabs', sources({ tabs: many })))).toEqual(['tab y']);
    expect(shown(paletteResults('https', 'tabs', sources({ tabs: many })))).toEqual([]);
  });

  it(`lists at most ${String(paletteLimits.tabs)} tabs`, () => {
    const many = Array.from({ length: 250 }, (_, index) => tab(`t${String(index)}`, 'Tab'));
    expect(paletteResults('', 'tabs', sources({ tabs: many }))).toHaveLength(paletteLimits.tabs);
  });

  it('leaves the active tab out with everything, and lists a few tabs', () => {
    expect(shown(paletteResults('fixture', 'all', sources({ tabs })))).toEqual(['tab b', 'tab d']);
    const many = Array.from({ length: 9 }, (_, index) => tab(`t${String(index)}`, 'Fixture'));
    expect(paletteResults('fixture', 'all', sources({ tabs: many }))).toHaveLength(
      paletteLimits.all.tabs,
    );
  });

  it('shows nothing without text with everything, as the page lists the commands then', () => {
    const all = sources({
      tabs,
      bookmarks: [page('Home', 'https://home.example/')],
      target: { kind: 'search', query: '', url: 'https://search.example/?q=' },
    });
    expect(paletteResults('', 'all', all)).toEqual([]);
  });

  it('shows an address once: a tab before a bookmark, and a bookmark before a visit', () => {
    const results = paletteResults(
      'fixture',
      'all',
      sources({
        tabs: [tab('b', 'Fixture second')],
        bookmarks: [
          page('Fixture home', 'https://home.example/'),
          page('Fixture second', 'https://b.example/'),
          page('Fixture home again', 'https://home.example/'),
        ],
        history: [
          page('Fixture find', 'https://find.example/'),
          page('Fixture second', 'https://b.example/'),
          page('Fixture home', 'https://home.example/'),
        ],
      }),
    );
    expect(shown(results)).toEqual([
      'tab b',
      'bookmark https://home.example/',
      'history https://find.example/',
    ]);
  });

  it('lists a few bookmarks and visits with everything, and more in their own scope', () => {
    const marks = Array.from({ length: 80 }, (_, index) =>
      page(`Fixture ${String(index)}`, `https://mark${String(index)}.example/`),
    );
    const visits = Array.from({ length: 80 }, (_, index) =>
      page(`Fixture ${String(index)}`, `https://visit${String(index)}.example/`),
    );
    const all = paletteResults('fixture', 'all', sources({ bookmarks: marks, history: visits }));
    expect(all.filter((result) => result.kind === 'bookmark')).toHaveLength(
      paletteLimits.all.bookmarks,
    );
    expect(all.filter((result) => result.kind === 'history')).toHaveLength(
      paletteLimits.all.history,
    );
    expect(paletteResults('fixture', 'bookmarks', sources({ bookmarks: marks }))).toHaveLength(
      paletteLimits.bookmarks,
    );
    expect(paletteResults('fixture', 'history', sources({ history: visits }))).toHaveLength(
      paletteLimits.history,
    );
  });

  it('lists the first bookmarks and the newest visits without text in their scopes', () => {
    const marks = [page('One', 'https://one.example/'), page('Two', 'https://two.example/')];
    const visits = [page('New', 'https://new.example/'), page('Old', 'https://old.example/')];
    const all = sources({ tabs, bookmarks: marks, history: visits });
    expect(shown(paletteResults('', 'bookmarks', all))).toEqual([
      'bookmark https://one.example/',
      'bookmark https://two.example/',
    ]);
    expect(shown(paletteResults('', 'history', all))).toEqual([
      'history https://new.example/',
      'history https://old.example/',
    ]);
    // A scope leaves the other kinds out.
    expect(shown(paletteResults('o', 'bookmarks', all))).toEqual([
      'bookmark https://one.example/',
      'bookmark https://two.example/',
    ]);
  });

  it('ignores case, accents and ß', () => {
    const marks = [page('Straßenkarte Übersicht', 'https://map.example/')];
    expect(
      paletteResults('strassen ubersicht', 'bookmarks', sources({ bookmarks: marks })),
    ).toHaveLength(1);
  });

  it('puts what the address bar would do last, with text and everything only', () => {
    const search = sources({
      tabs,
      target: { kind: 'search', query: 'fixture', url: 'https://search.example/?q=fixture' },
    });
    expect(shown(paletteResults('fixture', 'all', search))).toEqual([
      'tab b',
      'tab d',
      'search fixture',
    ]);
    expect(shown(paletteResults('fixture', 'tabs', search))).not.toContain('search fixture');
    const address = sources({ target: { kind: 'url', url: 'https://new.example/' } });
    expect(shown(paletteResults('new.example', 'all', address))).toEqual([
      'url https://new.example/',
    ]);
  });

  it('leaves the address out when a tab or a bookmark shows it already', () => {
    const open = sources({
      tabs: [tab('b', 'B page')],
      target: { kind: 'url', url: 'https://b.example/' },
    });
    expect(shown(paletteResults('b.example', 'all', open))).toEqual(['tab b']);
  });
});
