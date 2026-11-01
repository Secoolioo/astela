/** Whether the content blocker works on a page: `none` for pages it never touches. */
export type Blocking = 'on' | 'off' | 'none';

/**
 * The site of a web page, by host name, as the content blocker's exceptions name it.
 * @param url - The page's address.
 * @returns The host name, or `undefined` for anything but http and https.
 */
export function siteOf(url: string): string | undefined {
  const host = /^https?:\/\/(?:[^@/?#]*@)?(\[[^\]/?#]*\]|[^:/?#]+)/i.exec(url)?.[1];
  return host === undefined ? undefined : host.toLowerCase();
}

/**
 * Tells whether the content blocker works on a page.
 * @param url - The page's address.
 * @param enabled - Whether the blocker is on at all.
 * @param allowedSites - Sites on which it is off.
 */
export function blockingFor(
  url: string,
  enabled: boolean,
  allowedSites: readonly string[],
): Blocking {
  const site = siteOf(url);
  if (site === undefined) {
    return 'none';
  }
  return enabled && !allowedSites.includes(site) ? 'on' : 'off';
}

/**
 * Turns the exception for a site on or off.
 * @param allowedSites - Sites on which the blocker is off.
 * @param site - The site to change.
 * @returns The new list, sorted.
 */
export function toggleSite(allowedSites: readonly string[], site: string): string[] {
  return allowedSites.includes(site)
    ? allowedSites.filter((other) => other !== site)
    : [...allowedSites, site].toSorted();
}
