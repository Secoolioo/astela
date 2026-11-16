import { exceptionFor } from './blocking.ts';

// How the shield of a page changes the sites on which the content blocker is off. It loads
// with the shield, not with the start of the browser.

/**
 * The entry that turns blocking off for a host: its registrable domain, or the host itself
 * when the domain does not cover it, as for IPv6 addresses.
 * @param host - The page's host name.
 * @param domain - The registrable domain of the host, such as `example.co.uk`.
 */
export function exceptionSite(host: string, domain: string): string {
  return host === domain || host.endsWith(`.${domain}`) ? domain : host;
}

/**
 * Turns blocking on a page's site off, for the whole registrable domain, or back on by
 * removing every exception that covers the host.
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
  return exceptionFor(host, allowedSites) === undefined
    ? [...allowedSites, exceptionSite(host, domain)].toSorted()
    : allowedSites.filter((site) => !(host === site || host.endsWith(`.${site}`)));
}
