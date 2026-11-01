/** Internal pages that open in tabs, by their host below `app://`. */
export const tabPages = ['newtab'] as const;

/** An internal page that opens in a tab. */
export type TabPage = (typeof tabPages)[number];

/** Address of the new tab page. */
export const newTabUrl = 'app://newtab/';

/**
 * Tells which internal page a URL opens in a tab. Other `app://` hosts, such as the shell,
 * never open in a tab; their URLs are treated like any web address and refused there.
 * @param url - Any URL.
 * @returns The page, or `undefined` for web addresses and other hosts.
 */
export function tabPageOf(url: string): TabPage | undefined {
  const host = /^app:\/\/([^/?#]*)/i.exec(url)?.[1]?.toLowerCase();
  return tabPages.find((page) => page === host);
}
