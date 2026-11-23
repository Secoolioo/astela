import type {
  App,
  DisplayMediaRequestHandlerHandlerRequest,
  PermissionCheckHandlerHandlerDetails,
  Session,
  Streams,
  WebContents,
} from 'electron';
import type { Logger } from '../../kernel/logging/logger.ts';
import { mayOpenWindow, placedDisposition } from '../../domain/navigation/new-tab.ts';
import { originOf } from './ipc-gate.ts';

/**
 * When web pages may play sound: only after people used the page, as Chrome lets them on the
 * desktop; Electron would let every page play sound at once. A page that a script opens gets
 * the same from the window guard, as Electron does not pass it on from the opener. Without
 * sound, videos still play, so sites start them muted.
 */
export const webAutoplayPolicy = 'document-user-activation-required';

/** Decides about the permissions of the pages of a session, asking the user where needed. */
export interface PermissionHandler {
  /**
   * Answers a request of a page.
   * @param contents - The page.
   * @param permission - Electron's name of the permission.
   * @param mediaTypes - For `media`, the devices that the page wants.
   * @param requestingUrl - The address of the frame that asks, which can be an embedded one.
   */
  request(
    contents: WebContents,
    permission: string,
    mediaTypes: readonly string[],
    requestingUrl: string,
  ): Promise<boolean>;
  /** Whether a page has a permission already, for checks such as `Notification.permission`. */
  check(
    contents: WebContents | null,
    permission: string,
    requestingOrigin: string,
    details: PermissionCheckHandlerHandlerDetails,
  ): boolean;
  /** Answers a page that wants to share the screen or a window. */
  shareScreen(
    request: DisplayMediaRequestHandlerHandlerRequest,
    callback: (streams: Streams | null) => void,
  ): void;
}

/**
 * Hardens a session: permission requests and checks go to the handler, or are refused
 * without one, as for the browser's own pages; device access is denied and spellchecking is
 * switched off on Windows and Linux, because it would download dictionaries from a
 * third-party server. Electron grants everything by default, so this runs on every session,
 * in the task that made it.
 * @param session - Any session.
 * @param permissions - Decides about the permissions of web pages.
 */
export function hardenSession(session: Session, permissions?: PermissionHandler): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permissions === undefined) {
      callback(false);
      return;
    }
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    permissions
      .request(contents, permission, mediaTypes, details.requestingUrl)
      .then(callback, () => callback(false));
  });
  session.setPermissionCheckHandler(
    (contents, permission, requestingOrigin, details) =>
      permissions?.check(contents, permission, requestingOrigin, details) ?? false,
  );
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (permissions === undefined) callback(null);
      else permissions.shareScreen(request, callback);
    },
    // macOS 15 and later show their own picker, which needs no access to the whole screen.
    { useSystemPicker: true },
  );
  if (process.platform !== 'darwin') {
    // A new session starts to load the dictionary of the system's language at once, and
    // downloads it while it is missing, also with spellchecking off; an empty list of
    // languages stops that load before it reaches the network.
    session.setSpellCheckerLanguages([]);
    session.setSpellCheckerEnabled(false);
  }
}

/** Options for {@link guardWebContents}. */
export interface WebContentsGuardOptions {
  /** Tells whether a `WebContents` belongs to the browser's own UI. */
  readonly isInternal: (contents: WebContents) => boolean;
  /**
   * Shows the page that a script opened, which Chromium made with the opener, in a tab or,
   * for a popup, in a window of its own.
   * @param contents - The new page.
   * @param opener - The page whose script opened it.
   * @param request - The address, how the page asked for it, and the features of a popup.
   */
  readonly openWindow: (
    contents: WebContents,
    opener: WebContents,
    request: { readonly url: string; readonly disposition: string; readonly features: string },
  ) => void;
  /** Tells whether a popup that a page opens is blocked, such as by the content blocker. */
  readonly blocksPopup?: (url: string, opener: WebContents) => boolean;
  readonly logger: Logger;
}

/**
 * Applies navigation and window guards to every `WebContents` that is created:
 * - `<webview>` is never attached.
 * - Pages cannot open free windows: what a script opens becomes a tab, or a popup window of
 *   the browser, and keeps its opener. What Electron cannot place, such as a window of
 *   Document Picture-in-Picture with the disposition `other`, is refused: the browser has no
 *   such windows yet, and a tab in its place would break the page (ADR 0057). What a page
 *   opens may play sound only after people used it, as its opener.
 * - The browser's own views never leave their `app://` origin.
 * - Web content never navigates to `app://`.
 * @param app - The Electron app.
 * @param options - Callbacks into the window layer.
 */
export function guardWebContents(app: App, options: WebContentsGuardOptions): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      if (
        options.isInternal(contents) ||
        !placedDisposition(disposition) ||
        !mayOpenWindow(url) ||
        options.blocksPopup?.(url, contents) === true
      ) {
        return { action: 'deny' };
      }
      return {
        action: 'allow',
        // Tabs and windows stay open when the page that opened them closes, as in other
        // browsers; Electron would close them with it.
        outlivesOpener: true,
        overrideBrowserWindowOptions: { webPreferences: { autoplayPolicy: webAutoplayPolicy } },
        // Electron hands over the page that Chromium made, and the browser shows it.
        createWindow: (made) => {
          const created: unknown = Reflect.get(made, 'webContents');
          if (!isWebContents(created)) throw new Error('No page for the new window');
          options.openWindow(created, contents, { url, disposition, features });
          return created;
        },
      };
    });
    const guard = (event: { preventDefault(): void }, url: string): void => {
      if (options.isInternal(contents)) {
        if (originOf(url) !== originOf(contents.getURL()) && contents.getURL() !== '') {
          event.preventDefault();
          options.logger.warn('Blocked navigation of an internal view', { url });
        }
      } else if (/^(?:app|astela-resource):/i.test(url)) {
        event.preventDefault();
        options.logger.warn('Blocked navigation of web content to an internal page', { url });
      }
    };
    contents.on('will-navigate', (event) => guard(event, event.url));
    contents.on('will-redirect', (event) => guard(event, event.url));
    contents.on('will-frame-navigate', (event) => {
      if (!options.isInternal(contents) && /^app:/i.test(event.url)) {
        event.preventDefault();
      }
    });
  });
  app.on('select-client-certificate', (event, _contents, _url, _list, callback) => {
    // Never pick a client certificate automatically; the selection UI arrives later.
    event.preventDefault();
    callback();
  });
}

/**
 * Builds a user agent without the app and Electron tokens, so sites see a plain Chromium: the
 * token of the app goes with any version, also one of a beta such as `0.1.0-beta.6`, and the
 * version of Chromium is reduced to its major number, as Chrome sends it (`Chrome/156.0.0.0`).
 * Pages that need the full version read it from `navigator.userAgentData`, as in Chrome.
 * @param userAgent - The default user agent.
 */
export function cleanUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s+Electron\/\S+/g, '')
    .replace(/\s+[A-Za-z][\w-]*\/\S+(?=\s+Chrome\/)/g, '')
    .replace(/(\sChrome\/\d+)(?:\.\d+)+/, '$1.0.0.0')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Whether a value is the `WebContents` of a page, which Electron's options do not declare. */
function isWebContents(value: unknown): value is WebContents {
  return typeof value === 'object' && value !== null && 'getURL' in value && 'id' in value;
}
