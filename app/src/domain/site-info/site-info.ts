import {
  connectionKind,
  type CertificateReason,
  type SiteConnection,
} from '../../shared/connection.ts';
import {
  decide,
  forget,
  sitePermissions,
  type DecidedPermission,
  type SiteDecisions,
  type SitePermissions,
} from '../permissions/site-permissions.ts';

/** What site information knows about the connection of a page. */
export interface ConnectionState {
  /** The address that the tab shows. */
  readonly url: string;
  /** Why the tab shows no page, if it shows none. */
  readonly problem: { readonly kind: string } | null;
  /** Whether the page may have come with a certificate that people accepted. */
  readonly covered: boolean;
  /** Whether the browser still accepts that certificate. */
  readonly accepted: boolean;
  /** Whether people opened the page's insecure address past the warning of HTTPS-First. */
  readonly httpAllowed: boolean;
}

/**
 * What site information says about the connection of a page: a warning about a certificate or
 * of HTTPS-First as such; a page that came with a certificate that people accepted as
 * `accepted` while the exception holds, and as `certificate` after people turned the warning
 * back on, as the page may still be one that came with it; an insecure address that people
 * opened past HTTPS-First as `allowed-http`. Pages without a connection, the browser's own
 * pages and pages that could not load have no site information.
 * @param state - The page and what the browser allowed for it.
 */
export function connectionOf(state: ConnectionState): SiteConnection | undefined {
  const problem = state.problem?.kind;
  if (problem === 'certificate') return 'certificate';
  const kind = connectionKind({
    url: state.url,
    problem: state.problem,
    certificateException: state.covered,
  });
  if (kind === 'secure' || kind === 'local') return kind;
  if (kind !== 'insecure') return undefined;
  if (problem !== undefined) return 'insecure';
  if (/^https:/i.test(state.url)) return state.accepted ? 'accepted' : 'certificate';
  return state.httpAllowed ? 'allowed-http' : 'insecure';
}

/**
 * Why Chromium did not trust a certificate, by its name for the error, such as
 * `ERR_CERT_DATE_INVALID`.
 * @param code - Chromium's name for the error, with or without `net::`.
 */
export function certificateReason(code: string): CertificateReason {
  switch (code.replace(/^net::/, '')) {
    case 'ERR_CERT_AUTHORITY_INVALID':
      return 'authority';
    case 'ERR_CERT_DATE_INVALID':
      return 'date';
    case 'ERR_CERT_COMMON_NAME_INVALID':
      return 'name';
    default:
      return 'other';
  }
}

/**
 * What site information shows and changes of the decisions of a site, in the order of the
 * settings page: the permissions that sites ask for, then whether the site's pages may open
 * pop-ups without a click.
 */
const decidedPermissions: readonly DecidedPermission[] = [...sitePermissions, 'popups'];

/** A permission that was decided for a site, or its pop-ups, and whether it is allowed. */
export interface PermissionRow {
  readonly name: DecidedPermission;
  readonly allowed: boolean;
}

/**
 * The permissions that were decided for a site, in the order in which prompts and the settings
 * page name them, and its pop-ups last.
 * @param decisions - The decisions of the site, if it has any.
 */
export function permissionRows(decisions: SiteDecisions | undefined): PermissionRow[] {
  return decidedPermissions.flatMap((name) => {
    const decision = decisions?.[name];
    return decision === undefined ? [] : [{ name, allowed: decision === 'allow' }];
  });
}

/**
 * The decisions of a site, or none.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the site.
 */
export function decisionsOf(sites: SitePermissions, origin: string): SiteDecisions | undefined {
  return Object.hasOwn(sites, origin) ? sites[origin] : undefined;
}

/**
 * Allows or blocks a permission that was decided for a site, or its pop-ups. A permission that
 * the site never asked for is not decided here: the site asks for it as before, and pop-ups
 * that nobody allowed or blocked stay blocked unless a click opens them.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the site.
 * @param permission - The permission, or `popups`.
 * @param allowed - Whether the site may use it.
 */
export function setPermission(
  sites: SitePermissions,
  origin: string,
  permission: DecidedPermission,
  allowed: boolean,
): SitePermissions {
  if (decisionsOf(sites, origin)?.[permission] === undefined) return sites;
  return decide(sites, origin, [permission], allowed ? 'allow' : 'block');
}

/**
 * Forgets every decision of a site, so that it asks again and its pages open pop-ups only
 * after a click.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the site.
 */
export function resetPermissions(sites: SitePermissions, origin: string): SitePermissions {
  return decidedPermissions.reduce((kept, permission) => forget(kept, origin, permission), sites);
}

/**
 * Whether a cookie belongs to a site: its domain is the site or a host below it.
 * @param domain - The cookie's domain, with or without its leading dot.
 * @param site - The site, such as `example.com`, or a host without a registrable domain.
 */
export function cookieOfSite(domain: string, site: string): boolean {
  const name = domain.replace(/^\./, '').toLowerCase();
  const target = site.toLowerCase();
  return name === target || name.endsWith(`.${target}`);
}

/**
 * The address that deletes a cookie: one that the cookie would be sent to, with its host,
 * its path and the scheme that it needs.
 * @param cookie - The cookie's domain, path and whether it is only sent securely.
 */
export function cookieAddress(cookie: {
  readonly domain?: string | undefined;
  readonly path?: string | undefined;
  readonly secure?: boolean | undefined;
}): string {
  const host = (cookie.domain ?? '').replace(/^\./, '');
  const path = cookie.path?.startsWith('/') === true ? cookie.path : '/';
  return `${cookie.secure === true ? 'https' : 'http'}://${host}${path}`;
}

/**
 * Whether an action of site information still concerns the page that it shows: the window's
 * active tab is the one that it opened for, and still shows the same origin. Otherwise the
 * page changed while the popover was open, and the action could reach another site.
 * @param shown - The tab and origin that site information opened for.
 * @param now - The active tab and the origin that it shows now.
 */
export function sameSite(
  shown: { readonly tab: string; readonly origin: string },
  now: { readonly tab: string | undefined; readonly origin: string | undefined },
): boolean {
  return now.tab === shown.tab && now.origin === shown.origin;
}
