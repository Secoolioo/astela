import { originOf } from '../permissions/site-permissions.ts';

/** How many characters of a host the notice of a page shows at most. */
export const noticeSiteLength = 60;

/**
 * The site that the notice of a page in full screen, or of a page that took the mouse pointer,
 * names: the host of the origin of the page, with its port if it is not the usual one, for a
 * page of the web. A host that is too long keeps its end, which names the site that owns it,
 * after an ellipsis, as the labels at its start are free to choose for anyone who owns the site.
 * @param origin - The origin of the page's document, as Chromium serializes it, such as that
 *   of a page at a `blob:` address or of an `about:blank` page that its opener wrote.
 * @returns The site, or nothing for an opaque origin or one of another kind, such as a file,
 *   whose notice names no site.
 */
export function noticeSite(origin: string): string | undefined {
  const web = originOf(origin);
  if (web === undefined) return undefined;
  const host = web.slice(web.indexOf('://') + 3);
  return host.length <= noticeSiteLength ? host : `…${host.slice(1 - noticeSiteLength)}`;
}
