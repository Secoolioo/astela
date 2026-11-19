import { describe, expect, it } from 'vitest';
import {
  peekTime,
  rowsHiding,
  sameHiding,
  siteOfPage,
  type RowHolds,
  type TopRowsInput,
} from '../windows/top-rows.ts';

/** Nothing holds the rows open. */
const none: RowHolds = {
  pointer: false,
  focus: false,
  find: false,
  popover: false,
  menu: false,
  peek: false,
};

/** A window on Linux with the browser's title bar, whose rows hide, with a page that covers. */
const input = (change: Partial<TopRowsInput> = {}): TopRowsInput => ({
  platform: 'linux',
  density: 'normal',
  tabStrip: 'top',
  placement: 'tab-row',
  autoHide: true,
  popup: false,
  integrated: true,
  windowFullScreen: false,
  pageFullScreen: false,
  pageCovers: true,
  holds: none,
  ...change,
});

/** The heights of what stays of the rows at the three densities, with the toolbar in a row. */
const heights = (placement: 'own-row' | 'tab-row'): (number | undefined)[] =>
  (['compact', 'normal', 'comfortable'] as const).map(
    (density) => rowsHiding(input({ density, placement }))?.height,
  );

/** The heights of the edge that stays of the rows at the three densities, or none. */
const edges = (change: Partial<TopRowsInput>): (number | undefined)[] =>
  (['compact', 'normal', 'comfortable'] as const).map((density) => {
    const hiding = rowsHiding(input({ density, ...change }));
    return hiding?.rest === 'edge' ? hiding.height : undefined;
  });

describe('rowsHiding', () => {
  it('lets the rows hide only with the setting, the tabs at the top and outside popups', () => {
    expect(rowsHiding(input())).toEqual({ shown: false, rest: 'title', height: 40 });
    expect(rowsHiding(input({ autoHide: false }))).toBe(null);
    for (const tabStrip of ['bottom', 'left', 'right'] as const) {
      expect(rowsHiding(input({ tabStrip }))).toBe(null);
    }
    // A popup shows its address all the time, as its page expects.
    expect(rowsHiding(input({ popup: true }))).toBe(null);
  });

  it('keeps a title row where Chromium draws the window controls, as high as the top row', () => {
    for (const platform of ['linux', 'win32']) {
      expect(rowsHiding(input({ platform }))?.rest).toBe('title');
    }
    // One row of the toolbar's height, or the row of the tabs.
    expect(heights('tab-row')).toEqual([32, 40, 48]);
    expect(heights('own-row')).toEqual([30, 36, 44]);
  });

  it('keeps an edge on macOS, with the title bar of the system and in full screen', () => {
    expect(edges({ platform: 'darwin' })).toEqual([2, 4, 4]);
    expect(edges({ integrated: false })).toEqual([2, 4, 4]);
    expect(edges({ windowFullScreen: true })).toEqual([2, 4, 4]);
    expect(edges({ platform: 'darwin', placement: 'own-row' })).toEqual([2, 4, 4]);
  });

  it('shows the rows for every hold, and while no page covers the content area', () => {
    const holds = Object.keys(none) as (keyof RowHolds)[];
    expect(
      holds.filter(
        (hold) => rowsHiding(input({ holds: { ...none, [hold]: true } }))?.shown !== true,
      ),
    ).toEqual([]);
    // A problem of the tab, or a tab without a view, shows its rows.
    expect(rowsHiding(input({ pageCovers: false }))?.shown).toBe(true);
  });

  it('never shows the rows over a page in full screen', () => {
    const holds = { ...none, pointer: true, focus: true, peek: true };
    expect(rowsHiding(input({ pageFullScreen: true, holds }))?.shown).toBe(false);
    expect(rowsHiding(input({ pageFullScreen: true, pageCovers: false }))?.shown).toBe(false);
  });

  it('tells two states of the rows apart', () => {
    const shown = { shown: true, rest: 'edge', height: 4 } as const;
    expect(sameHiding(null, null)).toBe(true);
    expect(sameHiding(shown, { ...shown })).toBe(true);
    expect(sameHiding(shown, null)).toBe(false);
    expect(sameHiding(null, shown)).toBe(false);
    expect(sameHiding(shown, { ...shown, shown: false })).toBe(false);
    expect(sameHiding(shown, { ...shown, rest: 'title' })).toBe(false);
    expect(sameHiding(shown, { ...shown, height: 2 })).toBe(false);
  });

  it('shows the rows for a moment of one and a half seconds', () => {
    expect(peekTime).toBe(1500);
  });
});

describe('siteOfPage', () => {
  it('names the site of a page by its scheme, host and port', () => {
    expect(siteOfPage('https://Example.com/path?query#part')).toBe('https://example.com');
    expect(siteOfPage('http://127.0.0.1:8080/a')).toBe('http://127.0.0.1:8080');
    expect(siteOfPage('https://user@example.com/')).toBe('https://user@example.com');
    expect(siteOfPage('app://settings/#tabs.position')).toBe('app://settings');
    expect(siteOfPage('about:blank')).toBe('about:');
    expect(siteOfPage('')).toBe('');
  });

  it('tells pages of the same site apart from those of another', () => {
    expect(siteOfPage('https://a.example/one')).toBe(siteOfPage('https://a.example/two'));
    expect(siteOfPage('https://a.example/')).not.toBe(siteOfPage('https://b.example/'));
    expect(siteOfPage('https://a.example/')).not.toBe(siteOfPage('http://a.example/'));
  });
});
