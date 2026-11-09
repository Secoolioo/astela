import { webContents, type WebContents } from 'electron';
import {
  answer,
  decide,
  isGranted,
  originOf,
  permissionsFor,
  type PermissionDecision,
  type SitePermission,
  type SitePermissions,
} from '../domain/permissions/site-permissions.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { PermissionHandler } from '../platform/electron/session-security.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { PermissionPrompts } from './permission-prompt.ts';

/** What the permissions of web pages need from the composition root. */
export interface SitePermissionOptions {
  /** The decisions of all sites, from the settings. */
  readonly sites: () => SitePermissions;
  /** Keeps the decisions. */
  readonly save: (sites: SitePermissions) => void;
  /** The window of a tab's page. */
  readonly windowOf: (contents: WebContents) => BrowserWindowController | undefined;
  /** Loads the prompts, which come with the first question. */
  readonly prompts: () => Promise<PermissionPrompts>;
  readonly logger: Logger;
}

/**
 * The permissions of web pages: what a site may use was decided once and is kept per origin;
 * what is not decided yet, the page's tab asks about in its window. Only the visible tab of
 * a window asks; a page in the background, or one that is not a web page, gets nothing.
 * @param options - Settings and windows.
 */
export function sitePermissions(options: SitePermissionOptions): PermissionHandler {
  const ask = async (
    contents: WebContents,
    origin: string,
    permissions: readonly SitePermission[],
  ): Promise<PermissionDecision | undefined> => {
    const window = options.windowOf(contents);
    if (window === undefined || window.activeTabContents !== contents) return undefined;
    const prompts = await options.prompts();
    return prompts.askForPermissions(window, contents, origin, permissions);
  };
  return {
    async request(contents, permission, mediaTypes) {
      const needed = permissionsFor(permission, mediaTypes);
      if (needed === 'grant' || needed === 'refuse') return needed === 'grant';
      const origin = originOf(contents.getURL());
      if (origin === undefined) return false;
      const known = answer(options.sites(), origin, needed);
      if (known.kind !== 'ask') return known.kind === 'allow';
      const decision = await ask(contents, origin, known.permissions);
      // Closing the question decides nothing: the site may ask again.
      if (decision === undefined) return false;
      options.save(decide(options.sites(), origin, known.permissions, decision));
      return decision === 'allow';
    },
    check(contents, permission, requestingOrigin, details) {
      // The page decides, as for requests; a worker without a page is its own origin.
      const origin = originOf(contents?.getURL() ?? requestingOrigin);
      return (
        origin !== undefined && isGranted(options.sites(), origin, permission, details.mediaType)
      );
    },
    shareScreen(request, callback) {
      const contents = request.frame === null ? undefined : webContents.fromFrame(request.frame);
      const origin = contents === undefined ? undefined : originOf(contents.getURL());
      const window = contents === undefined ? undefined : options.windowOf(contents);
      if (
        contents === undefined ||
        origin === undefined ||
        window === undefined ||
        window.activeTabContents !== contents
      ) {
        callback(null);
        return;
      }
      options.prompts().then(
        (prompts) => prompts.chooseScreen(window, contents, origin, callback),
        (error: unknown) => {
          options.logger.error('The screen picker failed', error);
          callback(null);
        },
      );
    },
  };
}
