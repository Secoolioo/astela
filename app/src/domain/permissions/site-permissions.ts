/** A permission that a site asks for, and that the user gives or refuses for the site. */
export type SitePermission = 'camera' | 'microphone' | 'location' | 'notifications' | 'clipboard';

/** The permissions in the order in which prompts and the settings page name them. */
export const sitePermissions: readonly SitePermission[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
];

/**
 * What the user decides for a site: a permission that it asks for, or `popups`, whether its
 * pages may open windows without a click, which no site asks for: people allow it in the
 * popover of the pop-up blocker.
 */
export type DecidedPermission = SitePermission | 'popups';

/** What the user decided about a permission for a site. */
export type PermissionDecision = 'allow' | 'block';

/** The decisions of one site. */
export type SiteDecisions = Readonly<Partial<Record<DecidedPermission, PermissionDecision>>>;

/** The decisions of all sites, by origin, such as `https://meet.example`. */
export type SitePermissions = Readonly<Record<string, SiteDecisions>>;

/** Most sites with decisions, so the setting stays small. */
export const maxSites = 10_000;

/**
 * What a request of Chromium needs: nothing, because it is granted without asking or always
 * refused, or the permissions of the site to check, and to ask for when they are not decided.
 * Full screen, pointer lock and writing to the clipboard are granted, as in other browsers;
 * so is sharing the screen, whose picker asks for every request. Everything else that has no
 * prompt is refused.
 * @param permission - Electron's name of the permission, such as `media`.
 * @param mediaTypes - For `media`, the devices that the page wants: `video`, `audio` or both.
 */
export function permissionsFor(
  permission: string,
  mediaTypes: readonly string[] = [],
): 'grant' | 'refuse' | readonly SitePermission[] {
  switch (permission) {
    case 'fullscreen':
    case 'pointerLock':
    case 'clipboard-sanitized-write':
    case 'display-capture':
      return 'grant';
    case 'media': {
      const needed: SitePermission[] = [];
      if (mediaTypes.includes('video')) needed.push('camera');
      if (mediaTypes.includes('audio')) needed.push('microphone');
      return needed.length === 0 ? 'refuse' : needed;
    }
    case 'geolocation':
      return ['location'];
    case 'notifications':
      return ['notifications'];
    case 'clipboard-read':
      return ['clipboard'];
    default:
      return 'refuse';
  }
}

/** A web address, as Chromium writes it: the scheme, the host and the port, if any. */
const webAddress =
  /^(https?):\/\/(?:[^@/?#\s]*@)?(\[[0-9a-f:.]+\]|[^/?#:@\s]+)(?::(\d{1,5}))?(?:[/?#]|$)/i;

/**
 * The origin under which a page's decisions are kept: the scheme, host and port of a web
 * address, without the usual port of the scheme. Other addresses have none, and their pages
 * get no permissions.
 * @param url - The address of the page, as Chromium reports it.
 */
export function originOf(url: string): string | undefined {
  const match = webAddress.exec(url);
  const [, scheme = '', host = '', port] = match ?? [];
  if (match === null) return undefined;
  const lower = scheme.toLowerCase();
  const usual = port === undefined || Number(port) === (lower === 'https' ? 443 : 80);
  return `${lower}://${host.toLowerCase()}${usual ? '' : `:${Number(port)}`}`;
}

/** The answer to a request: given, refused, or a question about what is not decided. */
export type RequestAnswer =
  | { readonly kind: 'allow' }
  | { readonly kind: 'block' }
  | { readonly kind: 'ask'; readonly permissions: readonly SitePermission[] };

/**
 * Answers a request from what was decided for the site: one refused permission refuses it,
 * and it is given when every permission is allowed.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the page.
 * @param needed - The permissions that the request needs.
 */
export function answer(
  sites: SitePermissions,
  origin: string,
  needed: readonly SitePermission[],
): RequestAnswer {
  const decisions = Object.hasOwn(sites, origin) ? sites[origin] : undefined;
  if (needed.some((permission) => decisions?.[permission] === 'block')) return { kind: 'block' };
  const open = needed.filter((permission) => decisions?.[permission] !== 'allow');
  return open.length === 0 ? { kind: 'allow' } : { kind: 'ask', permissions: open };
}

/**
 * Whether a site has a permission, for the checks of Chromium, such as the one behind
 * `Notification.permission`.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the page.
 * @param permission - Electron's name of the permission.
 * @param mediaType - For `media`, the device: `video` or `audio`.
 */
export function isGranted(
  sites: SitePermissions,
  origin: string,
  permission: string,
  mediaType?: string,
): boolean {
  const needed = permissionsFor(permission, mediaType === undefined ? [] : [mediaType]);
  if (needed === 'grant' || needed === 'refuse') return needed === 'grant';
  return answer(sites, origin, needed).kind === 'allow';
}

/**
 * Whether the pages of a site may open windows without a click, which the pop-up blocker
 * otherwise blocks: only when people allowed it. A site that people blocked opens windows after
 * a click, as one without a decision does.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the page.
 */
export function allowsPopups(sites: SitePermissions, origin: string): boolean {
  return Object.hasOwn(sites, origin) && sites[origin]?.popups === 'allow';
}

/**
 * Records a decision of the user for some permissions of a site.
 * @param sites - The decisions of all sites.
 * @param origin - The origin of the page.
 * @param permissions - The permissions that were asked for, or `popups`.
 * @param decision - The answer.
 * @returns The new decisions, or the old ones when no further site fits.
 */
export function decide(
  sites: SitePermissions,
  origin: string,
  permissions: readonly DecidedPermission[],
  decision: PermissionDecision,
): SitePermissions {
  const known = Object.hasOwn(sites, origin);
  if (!known && Object.keys(sites).length >= maxSites) return sites;
  const decisions: Partial<Record<DecidedPermission, PermissionDecision>> = {
    ...(known ? sites[origin] : {}),
  };
  for (const permission of permissions) decisions[permission] = decision;
  return { ...sites, [origin]: decisions };
}

/**
 * Forgets the decision about a permission of a site, so the site asks again; a site
 * without decisions leaves the list.
 * @param sites - The decisions of all sites.
 * @param origin - The origin.
 * @param permission - The permission.
 */
export function forget(
  sites: SitePermissions,
  origin: string,
  permission: DecidedPermission,
): SitePermissions {
  if (!Object.hasOwn(sites, origin)) return sites;
  const { [permission]: _forgotten, ...rest } = sites[origin] ?? {};
  const { [origin]: _site, ...others } = sites;
  return Object.keys(rest).length === 0 ? others : { ...others, [origin]: rest };
}

/**
 * Whether the browser can find where the device is. On Linux, Chromium asks only Google's
 * location service, which answers nobody without a key, and its provider for the location
 * service of the system ends the browser in Electron 45; sites that ask there get no at once,
 * without a question. A key that the environment gives the browser, as `GOOGLE_API_KEY`,
 * lets Chromium ask that service.
 * @param platform - The system, as Node.js names it.
 * @param apiKey - The value of `GOOGLE_API_KEY`, if any.
 */
export function canLocate(platform: string, apiKey: string | undefined): boolean {
  return platform !== 'linux' || (apiKey ?? '') !== '';
}

/**
 * Whether a frame of another site gets its cookies, which the Storage Access API reports: only
 * where the browser keeps no third-party cookies away. While Chromium blocks them itself, a
 * grant would give the frame no cookies (ADR 0044), so the site is told no at once and keeps
 * its other way to sign in.
 * @param blocked - Whether Chromium blocks them since the start, whether the session is one of
 *   private windows, which always keep them away, and whether the setting blocks them.
 */
export function storageAccessOpen(blocked: {
  readonly native: boolean;
  readonly private: boolean;
  readonly setting: boolean;
}): boolean {
  return !blocked.native && !blocked.private && !blocked.setting;
}

/**
 * Whether a frame may use what its page decides. A page lets the frames of other sites use
 * its camera, microphone and location through its permissions policy, which Chromium
 * applies; no such policy covers notifications, so only the page's own site gets them.
 * @param permission - Electron's name of the permission.
 * @param origin - The origin of the page.
 * @param requesting - The address or origin of the frame that asks.
 */
export function mayAsk(permission: string, origin: string, requesting: string): boolean {
  return permission !== 'notifications' || originOf(requesting) === origin;
}
