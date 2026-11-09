/**
 * Whether the content blocker works on a page: `none` for pages it never touches, and
 * `failed` where it should block but has no usable filter data.
 */
export type Blocking = 'on' | 'off' | 'none' | 'failed';

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
 * The exception that covers a host: the entry for the host itself or for a domain it
 * belongs to, so an exception for `example.com` also covers `www.example.com`.
 * @param host - The page's host name.
 * @param allowedSites - Sites on which the blocker is off.
 */
export function exceptionFor(host: string, allowedSites: readonly string[]): string | undefined {
  return allowedSites.find((site) => host === site || host.endsWith(`.${site}`));
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
  return enabled && exceptionFor(site, allowedSites) === undefined ? 'on' : 'off';
}

/**
 * Turns blocking on a page's site off, for the whole registrable domain, or back on by
 * removing the exception that covers the host.
 * @param allowedSites - Sites on which the blocker is off.
 * @param host - The page's host name.
 * @param domain - The registrable domain of the host, such as `example.co.uk`.
 * @returns The new list, sorted.
 */
export function toggleSite(
  allowedSites: readonly string[],
  host: string,
  domain: string = host,
): string[] {
  const existing = exceptionFor(host, allowedSites);
  return existing === undefined
    ? [...allowedSites, domain].toSorted()
    : allowedSites.filter((site) => site !== existing);
}
