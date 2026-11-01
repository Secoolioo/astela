/** A search engine that can be chosen in the settings. */
export interface SearchEngine {
  /** Stable identifier, such as `duckduckgo`. */
  readonly id: string;
  /** Name shown to users. */
  readonly name: string;
  /** Search URL with `%s` for the encoded query. */
  readonly searchUrl: string;
}

/**
 * The search engines offered without configuration. The URLs are the plain search URLs of
 * each engine, without partner or tracking parameters.
 */
export const searchEngines: readonly SearchEngine[] = [
  { id: 'duckduckgo', name: 'DuckDuckGo', searchUrl: 'https://duckduckgo.com/?q=%s' },
  { id: 'google', name: 'Google', searchUrl: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', searchUrl: 'https://www.bing.com/search?q=%s' },
  { id: 'startpage', name: 'Startpage', searchUrl: 'https://www.startpage.com/sp/search?q=%s' },
  { id: 'ecosia', name: 'Ecosia', searchUrl: 'https://www.ecosia.org/search?q=%s' },
  { id: 'brave', name: 'Brave Search', searchUrl: 'https://search.brave.com/search?q=%s' },
  { id: 'qwant', name: 'Qwant', searchUrl: 'https://www.qwant.com/?q=%s' },
];

/**
 * Finds the engine that a search URL belongs to.
 * @param searchUrl - A search URL with `%s`, such as the value of `search.urlTemplate`.
 * @returns The engine, or `undefined` for a custom search URL.
 */
export function engineForSearchUrl(searchUrl: string): SearchEngine | undefined {
  return searchEngines.find((engine) => engine.searchUrl === searchUrl);
}
