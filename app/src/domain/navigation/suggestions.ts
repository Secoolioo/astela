import type { OmniboxTarget } from './omnibox.ts';

/** What a suggestion of the address bar leads to. */
export type SuggestionKind = 'search' | 'url' | 'tab' | 'bookmark' | 'history';

/** One suggestion of the address bar; a `tab` suggestion switches to the tab instead. */
export interface Suggestion {
  readonly kind: SuggestionKind;
  readonly title: string;
  readonly url: string;
  /** The open tab of a `tab` suggestion. */
  readonly tabId?: string;
}

/** A page that a suggestion can come from. */
export interface SuggestionSource {
  readonly title: string;
  readonly url: string;
}

/** Where the suggestions for some text come from. */
export interface SuggestionSources {
  /** What Enter would do with the text: open an address or search. */
  readonly target: OmniboxTarget | undefined;
  /** The open tabs of the window, other than the active one. */
  readonly tabs: readonly (SuggestionSource & { readonly id: string })[];
  readonly bookmarks: readonly SuggestionSource[];
  /** Visited pages that match the text, the most relevant first. */
  readonly history: readonly SuggestionSource[];
}

/** How many suggestions the address bar shows at most. */
export const suggestionLimit = 8;
const perKind = 3;

/**
 * The suggestions for text typed in the address bar: first what Enter would do, then open
 * tabs, bookmarks and visited pages whose title or address contains every word of the text,
 * each address once.
 * @param text - What was typed.
 * @param sources - Where suggestions come from.
 */
export function suggestionsFor(text: string, sources: SuggestionSources): Suggestion[] {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (page: SuggestionSource): boolean => {
    const haystack = `${page.title} ${page.url}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const seen = new Set<string>();
  const result: Suggestion[] = [];
  const add = (suggestion: Suggestion): void => {
    if (result.length >= suggestionLimit || seen.has(suggestion.url)) return;
    seen.add(suggestion.url);
    result.push(suggestion);
  };
  const { target } = sources;
  if (target !== undefined) {
    add({
      kind: target.kind,
      title: target.kind === 'search' ? target.query : target.url,
      url: target.url,
    });
  }
  for (const tab of sources.tabs.filter(matches).slice(0, perKind)) {
    // Switching to an open tab shows also when Enter opens the same address.
    seen.delete(tab.url);
    add({ kind: 'tab', title: tab.title, url: tab.url, tabId: tab.id });
  }
  for (const page of sources.bookmarks.filter(matches).slice(0, perKind)) {
    add({ kind: 'bookmark', title: page.title, url: page.url });
  }
  for (const page of sources.history.filter(matches)) {
    add({ kind: 'history', title: page.title, url: page.url });
  }
  return result;
}
