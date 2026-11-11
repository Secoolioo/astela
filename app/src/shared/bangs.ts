/** A site that a `!bang` searches, such as `!w` for Wikipedia. */
export interface Bang {
  /** The word after the `!`, in lower case. */
  readonly bang: string;
  readonly name: string;
  /** Search URL of the site with `%s` for the encoded query. */
  readonly url: string;
}

/**
 * The `!bangs` of the address bar: a short list of sites that people search often, written
 * for Astela. Each URL is the site's own plain search URL.
 */
export const bangs: readonly Bang[] = [
  { bang: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s' },
  {
    bang: 'wde',
    name: 'Wikipedia (Deutsch)',
    url: 'https://de.wikipedia.org/wiki/Special:Search?search=%s',
  },
  {
    bang: 'wikt',
    name: 'Wiktionary',
    url: 'https://en.wiktionary.org/wiki/Special:Search?search=%s',
  },
  { bang: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { bang: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { bang: 'gi', name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q=%s' },
  { bang: 'b', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { bang: 'sp', name: 'Startpage', url: 'https://www.startpage.com/sp/search?q=%s' },
  { bang: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
  { bang: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { bang: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s' },
  { bang: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s' },
  { bang: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/search?q=%s' },
  { bang: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=%s' },
  { bang: 'osm', name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query=%s' },
  { bang: 'maps', name: 'Google Maps', url: 'https://www.google.com/maps/search/%s' },
  { bang: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s' },
  { bang: 'ade', name: 'Amazon (Deutschland)', url: 'https://www.amazon.de/s?k=%s' },
  { bang: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s' },
  { bang: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q=%s' },
  { bang: 'leo', name: 'LEO Englisch–Deutsch', url: 'https://dict.leo.org/englisch-deutsch/%s' },
  { bang: 'arch', name: 'ArchWiki', url: 'https://wiki.archlinux.org/index.php?search=%s' },
];
