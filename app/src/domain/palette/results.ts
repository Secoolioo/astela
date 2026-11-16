import { matchRank, searchWords } from '../../shared/search-text.ts';
import type { OmniboxTarget } from '../navigation/omnibox.ts';

/**
 * What the command palette searches in the browser process: everything, which its page adds
 * the commands and the settings to, the open tabs, the bookmarks or the history.
 */
export type PaletteScope = 'all' | 'tabs' | 'bookmarks' | 'history';

/**
 * An open tab of a window of the same kind as the palette's, private or not: in the palette's
 * window, where `current` is its active tab, or in another window.
 */
export interface PaletteTab {
  /** The id of the tab's window, as `BaseWindow` numbers windows. */
  readonly windowId: number;
  /** The id of the tab, which only its window knows. */
  readonly tabId: string;
  readonly title: string;
  readonly url: string;
  /** The key of the icon of its page, or `null` without one. */
  readonly favicon: string | null;
  readonly place: 'current' | 'window' | 'other';
  /** Whether the tab sleeps: it has no page loaded, and loads when it is shown. */
  readonly sleeping: boolean;
}

/** A bookmark or a visited page. */
export interface PalettePage {
  readonly title: string;
  readonly url: string;
}

/** Where the results of the palette come from. */
export interface PaletteSources {
  /**
   * The open tabs of the windows of the same kind: those of the palette's window first, in the
   * order of its tab strip, then those of the other windows, the window used last first.
   */
  readonly tabs: readonly PaletteTab[];
  /** The bookmarks, in their order. */
  readonly bookmarks: readonly PalettePage[];
  /** Visited pages, the newest first. */
  readonly history: readonly PalettePage[];
  /** What the address bar would do with the text: open an address or search. */
  readonly target: OmniboxTarget | undefined;
}

/** A result of the palette from the browser process. */
export type PaletteResult =
  | { readonly kind: 'tab'; readonly tab: PaletteTab }
  | { readonly kind: 'bookmark' | 'history'; readonly title: string; readonly url: string }
  | { readonly kind: 'search'; readonly query: string; readonly url: string }
  | { readonly kind: 'url'; readonly url: string };

/**
 * How many results of each kind the palette shows: a few of each with everything, more when a
 * scope narrows the search to them.
 */
export const paletteLimits = {
  all: { tabs: 5, bookmarks: 3, history: 5 },
  tabs: 200,
  bookmarks: 50,
  history: 50,
} as const;

/**
 * The results of the palette for some text, in the order in which it shows them. Every word of
 * the text must be in the title or the address of a page. The best matches come first: a page
 * whose title starts with the text, then one where each word starts a word, then the others,
 * each in the order of its source. An address shows once: an open tab before a bookmark, and a
 * bookmark before a visit. With everything, the active tab is left out, and what the address
 * bar would do with the text comes last. Without text, the tabs scope lists every tab, the
 * bookmarks scope the first bookmarks and the history scope the newest visits; everything
 * shows nothing, as the page lists the commands then.
 * @param text - What was typed, without the prefix of a scope.
 * @param scope - What the palette searches.
 * @param sources - Where the results come from.
 */
export function paletteResults(
  text: string,
  scope: PaletteScope,
  sources: PaletteSources,
): PaletteResult[] {
  const words = searchWords(text);
  const shown = new Set<string>();
  /** The pages of a source that match, best first, each address once, up to a limit. */
  const pages = (
    list: readonly PalettePage[],
    kind: 'bookmark' | 'history',
    limit: number,
  ): PaletteResult[] => {
    const found: PaletteResult[] = [];
    for (const page of ranked(list, words, (item) => item)) {
      if (found.length >= limit) break;
      if (shown.has(page.url)) continue;
      shown.add(page.url);
      found.push({ kind, title: page.title, url: page.url });
    }
    return found;
  };
  const tabs = (limit: number, current: boolean): PaletteResult[] =>
    ranked(
      sources.tabs.filter((tab) => current || tab.place !== 'current'),
      words,
      (tab) => tab,
    )
      .slice(0, limit)
      .map((tab) => {
        shown.add(tab.url);
        return { kind: 'tab', tab };
      });
  if (scope === 'tabs') return tabs(paletteLimits.tabs, true);
  if (scope === 'bookmarks') return pages(sources.bookmarks, 'bookmark', paletteLimits.bookmarks);
  if (scope === 'history') return pages(sources.history, 'history', paletteLimits.history);
  if (words.length === 0) return [];
  const results = [
    ...tabs(paletteLimits.all.tabs, false),
    ...pages(sources.bookmarks, 'bookmark', paletteLimits.all.bookmarks),
    ...pages(sources.history, 'history', paletteLimits.all.history),
  ];
  const { target } = sources;
  if (target?.kind === 'search') {
    results.push({ kind: 'search', query: target.query, url: target.url });
  } else if (target !== undefined && !shown.has(target.url)) {
    results.push({ kind: 'url', url: target.url });
  }
  return results;
}

/**
 * The items whose page matches every word, the best first, each rank in the order of the list;
 * every item without words.
 */
function ranked<T>(
  list: readonly T[],
  words: readonly string[],
  page: (item: T) => PalettePage,
): T[] {
  if (words.length === 0) return [...list];
  const matching: { item: T; rank: number }[] = [];
  for (const item of list) {
    const { title, url } = page(item);
    const rank = matchRank(`${title} ${url.replace(/^https?:\/\//i, '')}`, words);
    if (rank !== undefined) matching.push({ item, rank });
  }
  // The sort keeps the order of the list among results of the same rank.
  return matching.toSorted((a, b) => a.rank - b.rank).map(({ item }) => item);
}
