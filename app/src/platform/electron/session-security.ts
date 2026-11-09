import type {
  App,
  DisplayMediaRequestHandlerHandlerRequest,
  PermissionCheckHandlerHandlerDetails,
  Session,
  Streams,
  WebContents,
} from 'electron';
import type { Logger } from '../../kernel/logging/logger.ts';
import { mayOpenInNewTab } from '../../domain/navigation/new-tab.ts';
import { originOf } from './ipc-gate.ts';

/** Decides about the permissions of the pages of a session, asking the user where needed. */
export interface PermissionHandler {
  /**
   * Answers a request of a page.
   * @param contents - The page.
   * @param permission - Electron's name of the permission.
   * @param mediaTypes - For `media`, the devices that the page wants.
   */
  request(
    contents: WebContents,
    permission: string,
    mediaTypes: readonly string[],
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
 * third-party server. Electron grants everything by default, so this runs on every session.
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
    permissions.request(contents, permission, mediaTypes).then(callback, () => callback(false));
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
    session.setSpellCheckerEnabled(false);
    session.setSpellCheckerDictionaryDownloadURL('https://0.0.0.0/');
  }
}

/** Options for {@link guardWebContents}. */
export interface WebContentsGuardOptions {
  /** Tells whether a `WebContents` belongs to the browser's own UI. */
  readonly isInternal: (contents: WebContents) => boolean;
  /** Opens a URL that a page wanted to open in a new window as a new tab instead. */
  readonly openInTab: (url: string, opener: WebContents) => void;
  /** Tells whether a popup that a page opens is blocked, such as by the content blocker. */
  readonly blocksPopup?: (url: string, opener: WebContents) => boolean;
  readonly logger: Logger;
}

/**
 * Applies navigation and window guards to every `WebContents` that is created:
 * - `<webview>` is never attached.
 * - Pages cannot open free windows; requests become tabs.
 * - The browser's own views never leave their `app://` origin.
 * - Web content never navigates to `app://`.
 * @param app - The Electron app.
 * @param options - Callbacks into the window layer.
 */
export function guardWebContents(app: App, options: WebContentsGuardOptions): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (
        !options.isInternal(contents) &&
        mayOpenInNewTab(url) &&
        options.blocksPopup?.(url, contents) !== true
      ) {
        options.openInTab(url, contents);
      }
      return { action: 'deny' };
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
 * Builds a user agent without the app and Electron tokens, so sites see a plain Chromium.
 * @param userAgent - The default user agent.
 */
export function cleanUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s+Electron\/\S+/g, '')
    .replace(/\s+[A-Za-z][\w-]*\/\d+(?:\.\d+)*(?=\s+Chrome\/)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
