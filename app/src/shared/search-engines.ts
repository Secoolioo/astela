/** A search engine that can be chosen in the settings. */
export interface SearchEngine {
  /** Stable identifier, such as `duckduckgo`. */
  readonly id: string;
  /** Name shown to users. */
  readonly name: string;
  /** Search URL with `%s` for the encoded query. */
  readonly searchUrl: string;
  /** The word that searches with the engine in the address bar, such as `@google` in `@google terms`. */
  readonly keyword: string;
}

/** A search engine that someone added, with the keyword that picks it. */
export interface CustomSearchEngine {
  readonly name: string;
  /** The word before a search that picks the engine; it starts with neither `!` nor `@`. */
  readonly keyword: string;
  /** Search URL with `%s` for the encoded query. */
  readonly url: string;
}

/**
 * The search engines offered without configuration. The URLs are the plain search URLs of
 * each engine, without partner or tracking parameters.
 */
export const searchEngines: readonly SearchEngine[] = [
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrl: 'https://duckduckgo.com/?q=%s',
    keyword: '@duckduckgo',
  },
  {
    id: 'google',
    name: 'Google',
    searchUrl: 'https://www.google.com/search?q=%s',
    keyword: '@google',
  },
  { id: 'bing', name: 'Bing', searchUrl: 'https://www.bing.com/search?q=%s', keyword: '@bing' },
  {
    id: 'startpage',
    name: 'Startpage',
    searchUrl: 'https://www.startpage.com/sp/search?q=%s',
    keyword: '@startpage',
  },
  {
    id: 'ecosia',
    name: 'Ecosia',
    searchUrl: 'https://www.ecosia.org/search?q=%s',
    keyword: '@ecosia',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    searchUrl: 'https://search.brave.com/search?q=%s',
    keyword: '@brave',
  },
  { id: 'qwant', name: 'Qwant', searchUrl: 'https://www.qwant.com/?q=%s', keyword: '@qwant' },
];

/**
 * Finds the engine that a search URL belongs to.
 * @param searchUrl - A search URL with `%s`, such as the value of `search.urlTemplate`.
 * @returns The engine, or `undefined` for a custom search URL.
 */
export function engineForSearchUrl(searchUrl: string): SearchEngine | undefined {
  return searchEngines.find((engine) => engine.searchUrl === searchUrl);
}
