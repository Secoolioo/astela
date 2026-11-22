import { canLocate, isGranted, mayAsk, originOf } from '../domain/permissions/site-permissions.ts';
import type { PermissionHandler } from '../platform/electron/session-security.ts';
import type * as PermissionRequests from './permission-requests.ts';
import type { SitePermissionOptions } from './permission-requests.ts';

/** The code for the requests of sites, which loads with the first of them. */
function permissionRequests(): Promise<typeof PermissionRequests> {
  return import('./permission-requests.ts');
}

/** Whether a site asks for the location where the browser cannot find it (`canLocate`). */
function unlocatable(permission: string): boolean {
  return (
    permission === 'geolocation' && !canLocate(process.platform, process.env['GOOGLE_API_KEY'])
  );
}

/**
 * The permissions of web pages: what a site may use was decided once and is kept per origin;
 * what is not decided yet, the page's tab asks about in its window. Only the visible tab of
 * a window asks; a page in the background, or one that is not a web page, gets nothing. The
 * code for requests loads with the first one; Chromium's checks get their answer at once. A
 * site that wants the location where the browser cannot find it gets no at once, without a
 * question, rather than an error after it was allowed.
 * @param options - Settings and windows.
 */
export function sitePermissions(options: SitePermissionOptions): PermissionHandler {
  return {
    async request(contents, permission, mediaTypes, requestingUrl) {
      if (unlocatable(permission)) return false;
      const { requestPermission } = await permissionRequests();
      return requestPermission(options, contents, permission, mediaTypes, requestingUrl);
    },
    check(contents, permission, requestingOrigin, details) {
      // The page decides, as for requests; a worker without a page is its own origin.
      const origin = originOf(contents?.getURL() ?? requestingOrigin);
      return (
        !unlocatable(permission) &&
        origin !== undefined &&
        mayAsk(permission, origin, requestingOrigin) &&
        isGranted(options.sites(), origin, permission, details.mediaType)
      );
    },
    shareScreen(request, callback) {
      permissionRequests().then(
        ({ requestScreen }) => requestScreen(options, request, callback),
        (error: unknown) => {
          options.logger.error('The screen picker failed', error);
          callback(null);
        },
      );
    },
  };
}
