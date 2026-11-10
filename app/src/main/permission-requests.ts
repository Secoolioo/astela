import { webContents, type WebContents } from 'electron';
import {
  answer,
  decide,
  mayAsk,
  originOf,
  permissionsFor,
  type PermissionDecision,
  type SitePermission,
  type SitePermissions,
} from '../domain/permissions/site-permissions.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { PermissionHandler } from '../platform/electron/session-security.ts';
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
 * Asks the user in the page's window, if the page's tab is the one the window shows.
 * @param options - Settings and windows.
 * @param contents - The page.
 * @param origin - The origin of the page.
 * @param permissions - What the site wants.
 */
async function ask(
  options: SitePermissionOptions,
  contents: WebContents,
  origin: string,
  permissions: readonly SitePermission[],
): Promise<PermissionDecision | undefined> {
  const window = options.windowOf(contents);
  if (window === undefined || window.activeTabContents !== contents) return undefined;
  const prompts = await options.prompts();
  return prompts.askForPermissions(window, contents, origin, permissions);
}

/**
 * Answers a site's request for a permission: at once when it needs no question or was
 * decided before, or else with the answer to a question in its window, which the site keeps.
 * @param options - Settings and windows.
 * @param contents - The page.
 * @param permission - Electron's name of the permission.
 * @param mediaTypes - The devices of a request for media.
 * @param requestingUrl - The address of the frame that asks.
 */
export async function requestPermission(
  options: SitePermissionOptions,
  contents: WebContents,
  permission: Parameters<PermissionHandler['request']>[1],
  mediaTypes: Parameters<PermissionHandler['request']>[2],
  requestingUrl: string,
): Promise<boolean> {
  const needed = permissionsFor(permission, mediaTypes);
  if (needed === 'grant' || needed === 'refuse') return needed === 'grant';
  const origin = originOf(contents.getURL());
  if (origin === undefined || !mayAsk(permission, origin, requestingUrl)) return false;
  const known = answer(options.sites(), origin, needed);
  if (known.kind !== 'ask') return known.kind === 'allow';
  const decision = await ask(options, contents, origin, known.permissions);
  // Closing the question decides nothing: the site may ask again.
  if (decision === undefined) return false;
  options.save(decide(options.sites(), origin, known.permissions, decision));
  return decision === 'allow';
}

/**
 * Lets the user choose a screen or a window for a site to see, if the page's tab is the one
 * that its window shows; otherwise the site sees nothing.
 * @param options - Settings and windows.
 * @param request - Electron's request.
 * @param callback - Electron's answer.
 */
export function requestScreen(
  options: SitePermissionOptions,
  request: Parameters<PermissionHandler['shareScreen']>[0],
  callback: Parameters<PermissionHandler['shareScreen']>[1],
): void {
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
}
