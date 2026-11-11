import { bangs } from '../../shared/bangs.ts';
import { searchEngines } from '../../shared/search-engines.ts';

/** What the address bar should do with the user's input. */
export type OmniboxTarget =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'search'; readonly url: string; readonly query: string };

/** A search engine that a keyword picks, such as `ex` in `ex terms`. */
export interface KeywordEngine {
  /** The word before the search terms. */
  readonly keyword: string;
  /** Search URL with `%s` for the encoded query. */
  readonly url: string;
}

/** More ways to search than the default engine. */
export interface SearchShortcuts {
  /** Engines that their keyword picks, besides the built-in ones. */
  readonly engines?: readonly KeywordEngine[];
  /** Whether a `!bang` at the start or the end of a search picks a site. */
  readonly bangs?: boolean;
}

/** Schemes the address bar opens directly. Everything else is treated as a search. */
const navigableSchemes = new Set(['http:', 'https:', 'about:', 'app:']);

const hostPattern =
  /^(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d{1,5})?(?:[/?#].*)?$/i;

/** Hosts that are reached over plain HTTP by default, because they rarely have certificates. */
const localHostPattern =
  /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * Decides whether address bar input is a URL or a search, and builds the URL to open.
 * Hosts without a scheme get `https://`, except local hosts and IP addresses, which get
 * `http://`. The web view normalizes the URL when it loads it.
 * A keyword of an engine followed by search terms, such as `@google astela`, searches with
 * that engine; with `!bangs` on, a known `!bang` at the start or the end, such as `!w astela`,
 * searches its site.
 * @param input - What the user typed.
 * @param searchTemplate - Search URL with `%s` for the encoded query.
 * @param shortcuts - Engines by keyword, and whether `!bangs` work.
 * @returns The target, or `undefined` for blank input.
 */
export function resolveOmniboxInput(
  input: string,
  searchTemplate: string,
  shortcuts: SearchShortcuts = {},
): OmniboxTarget | undefined {
  const text = input.trim();
  if (text === '') {
    return undefined;
  }
  const shortcut = searchShortcut(text, shortcuts);
  if (shortcut !== undefined) return shortcut;
  const schemeMatch = /^([a-z][a-z0-9+.-]*:)/i.exec(text);
  if (schemeMatch?.[1] !== undefined && !/^[^\s:]+:\d/.test(text)) {
    const scheme = schemeMatch[1].toLowerCase();
    return navigableSchemes.has(scheme) && !/\s/.test(text)
      ? { kind: 'url', url: text }
      : search(text, searchTemplate);
  }
  if (!/\s/.test(text) && hostPattern.test(text)) {
    const scheme = localHostPattern.test(text) ? 'http' : 'https';
    return { kind: 'url', url: `${scheme}://${text}` };
  }
  return search(text, searchTemplate);
}

/**
 * Builds the URL that searches for a query with the configured search engine.
 * @param query - The search terms.
 * @param searchTemplate - Search URL with `%s` for the encoded query.
 */
export function searchUrl(query: string, searchTemplate: string): string {
  return searchTemplate.replace('%s', encodeURIComponent(query));
}

function search(query: string, template: string): OmniboxTarget {
  return { kind: 'search', query, url: searchUrl(query, template) };
}

/** A search with the engine of a keyword or with a `!bang`; `undefined` for neither. */
function searchShortcut(text: string, shortcuts: SearchShortcuts): OmniboxTarget | undefined {
  const words = text.split(/\s+/);
  const [first = '', ...rest] = words;
  if (rest.length === 0) return undefined;
  const engines: readonly KeywordEngine[] = [
    ...searchEngines.map((engine) => ({ keyword: engine.keyword, url: engine.searchUrl })),
    ...(shortcuts.engines ?? []),
  ];
  const engine = engines.find((candidate) => sameWord(candidate.keyword, first));
  if (engine !== undefined) return search(rest.join(' '), engine.url);
  if (shortcuts.bangs !== true) return undefined;
  const bangAt = (index: number): OmniboxTarget | undefined => {
    const word = words[index] ?? '';
    const site = word.startsWith('!')
      ? bangs.find((candidate) => sameWord(candidate.bang, word.slice(1)))
      : undefined;
    const terms = words.filter((_word, other) => other !== index).join(' ');
    return site === undefined ? undefined : search(terms, site.url);
  };
  return bangAt(0) ?? bangAt(words.length - 1);
}

/** Whether two words are the same, apart from case. */
function sameWord(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
