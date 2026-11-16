import {
  screen,
  webContents,
  type App,
  type DownloadItem,
  type Session,
  type WebContents,
} from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Blocking } from '../domain/blocker/blocking.ts';
import { freeName, pathKey } from '../domain/downloads/downloads.ts';
import type { SitePermissions } from '../domain/permissions/site-permissions.ts';
import { popupBounds } from '../domain/windows/popup-bounds.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import type { WindowManager } from '../platform/electron/browser-window.ts';
import { CertificateExceptions } from '../platform/electron/certificates.ts';
import { HttpsFirst } from '../platform/electron/https-first.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import { RequestPipeline } from '../platform/electron/request-pipeline.ts';
import type { PermissionHandler } from '../platform/electron/session-security.ts';
import type { TabActivity } from '../platform/electron/tab-activity.ts';
import { ThirdPartyCookies } from '../platform/electron/third-party-cookies.ts';
import { blockerFrames, type BlockerFrames } from './blocker-frames.ts';
import { listenToFrames } from './web-frames.ts';
import {
  AskDownloadSetting,
  BlockerAnnoyancesSetting,
  BlockerCookieNoticesSetting,
  BlockThirdPartyCookiesSetting,
  ContentBlockerSetting,
  HttpAllowlistSetting,
  HttpsFirstSetting,
  SitePermissionsSetting,
} from './core-settings.ts';
import type { Downloads } from './downloads.ts';
import type { PermissionPrompts } from './permission-prompt.ts';
import { sitePermissions } from './site-permissions.ts';

/** How a script opened a page: its address, as what, and the features of a popup. */
interface WindowOpening {
  readonly url: string;
  readonly disposition: string;
  readonly features: string;
}

/** What the code for the requests of web pages needs from the composition root. */
export interface WebRequestOptions {
  readonly app: App;
  readonly settings: SettingsService;
  /** Folder of the content blocker's data. */
  readonly blockerDir: string;
  /**
   * Whether Chromium blocks third-party cookies itself, in every session, since the start;
   * the pipeline and the frames keep them away only without it.
   */
  readonly nativeCookieBlocking: boolean;
  /** Whether a session is one of private windows, which always keep third-party cookies away. */
  readonly isPrivate: (session: Session) => boolean;
  /** Whether a session holds web content. */
  readonly isWebSession: (session: Session) => boolean;
  /** Whether the content blocker works on a page, as the settings and the exceptions say. */
  readonly blocking: (url: string) => Blocking;
  /** Counts a request that the content blocker blocked for the page that made it. */
  readonly onBlocked: (contentsId: number) => void;
  /** Called when the content blocker has loaded or could not load. */
  readonly onStatus: () => void;
  /** Whether a policy lets people continue to a site whose certificate is not trusted. */
  readonly certificateOverride: () => boolean;
  /** The windows, which take the pages that scripts open and ask for the logins of sites. */
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  /** The folder of the downloads, as the settings say. */
  readonly downloadFolder: () => string;
  /** The list of downloads, which loads with the first download. */
  readonly downloads: () => Promise<Downloads>;
  /** What keeps the pages of tabs awake, such as a camera that a page was granted. */
  readonly activity: () => TabActivity | undefined;
  /** The sessions of web content made so far; each gets the frame preload. */
  readonly webSessions: Iterable<Session>;
  /** Path of the frame preload, which asks the content blocker for the rules of each frame. */
  readonly framePreload: string;
  readonly logger: Logger;
}

/**
 * The code for the requests of web pages: the steps of the request pipeline, HTTPS-First,
 * the third-party cookies and the content blocker, with the exceptions for certificates and
 * the answers to the frames of web pages, the logins that sites ask for, the downloads and
 * the pages that scripts open. It loads with the code for web pages, before the first web
 * page loads, or with the first request or frame of a web page; the browser's own pages need
 * none of it.
 */
export interface WebRequests {
  readonly pipeline: RequestPipeline;
  readonly httpsFirst: HttpsFirst;
  readonly blocker: ContentBlocker;
  /** The certificates that people accepted after the warning, for their session. */
  readonly certificates: CertificateExceptions;
  readonly frames: BlockerFrames;
  /**
   * Saves a download in the downloads folder without a question, under a name that is free
   * there, also from downloads that still run; the list and its panel load with the first one.
   * @param item - The download, which gets its path at once.
   * @param privateWindow - Whether a page of a private window started it.
   */
  saveDownload(item: DownloadItem, privateWindow: boolean): void;
  /**
   * Takes the page that a script opened into a window: a popup with a size or position gets a
   * window of its own, anything else a tab, in the background when the user asked for that.
   * What a page of a private window opens stays private.
   */
  openWindow(contents: WebContents, opener: WebContents, opening: WindowOpening): void;
  /** Whether the filter lists name a popup, which then does not open and counts as blocked. */
  blocksPopup(url: string, opener: WebContents): boolean;
  /**
   * The permissions of the pages of a session, as their kind of window decides them: a private
   * session is known only once it was made, so each question looks again.
   */
  permissions(session: Session): PermissionHandler;
  /** Gives a session of web content that was made after this code the frame preload. */
  protect(session: Session): void;
}

/**
 * Makes the code for the requests of web pages. HTTPS-First sends pages to the secure
 * address first; the content blocker follows, and its engine loads with the first web page.
 * @param options - Settings, sessions and callbacks.
 */
export function webRequests(options: WebRequestOptions): WebRequests {
  const { settings } = options;
  const pipeline = new RequestPipeline();
  const httpsFirst = new HttpsFirst({
    enabled: () => settings.get(HttpsFirstSetting),
    allowlist: () => settings.get(HttpAllowlistSetting),
  });
  pipeline.add(httpsFirst);
  // Private windows always keep third-party cookies away; regular ones as the settings say.
  // When Chromium blocks them since the start, it does so for every session more precisely,
  // and leaves the partitioned cookies that cannot track across sites.
  const thirdPartyCookies = new ThirdPartyCookies({
    blocked: (s) =>
      !options.nativeCookieBlocking &&
      (options.isPrivate(s) || settings.get(BlockThirdPartyCookiesSetting)),
  });
  pipeline.add(thirdPartyCookies);
  const blocker = new ContentBlocker({
    dataDir: options.blockerDir,
    // Off everywhere wins; a page whose address is not known yet is blocked as usual.
    enabled: (page) => settings.get(ContentBlockerSetting) && options.blocking(page) !== 'off',
    onBlocked: options.onBlocked,
    onStatus: options.onStatus,
    extras: () => [
      ...(settings.get(BlockerCookieNoticesSetting) ? (['cookies'] as const) : []),
      ...(settings.get(BlockerAnnoyancesSetting) ? (['annoyances'] as const) : []),
    ],
    logger: options.logger.child('blocker'),
  });
  pipeline.add(blocker);
  // Certificates that the user accepted after the warning hold for this session. Their errors
  // come from requests, which wait for this code, so none comes before it.
  const certificates = new CertificateExceptions(options.certificateOverride);
  certificates.attach(options.app);
  const frames = blockerFrames(blocker, options.isWebSession, (origin, topOrigin, frameSession) =>
    thirdPartyCookies.blocksFrame(origin, topOrigin, frameSession),
  );
  // The frames of web pages ask for their rules as they start, which they can only once this
  // code has loaded, before the first web page.
  const protect = listenToFrames(
    () => Promise.resolve(frames),
    options.framePreload,
    options.logger,
  );
  for (const s of options.webSessions) protect(s);
  const { windows } = options;
  // Sites and proxies that ask for a user name and password ask in the tab's window. They ask
  // for requests, which wait for this code, so none asks before it.
  options.app.on('login', (event, contents, details, info, callback) => {
    const window = contents === null ? undefined : windows.forTab(contents);
    if (window === undefined || contents === null) return;
    event.preventDefault();
    void Promise.all([import('./login-prompt.ts'), windows.laterCode()]).then(([{ askForLogin }]) =>
      askForLogin(window, contents, details, info, callback, options.overlay, options.router),
    );
  });
  const reservedPaths = new Set<string>();
  const saveDownload = (item: DownloadItem, privateWindow: boolean): void => {
    const folder = options.downloadFolder();
    const ask = settings.get(AskDownloadSetting);
    // While the browser asks where to save a download, it goes on under a name of its own.
    const working = (path: string): string => (ask ? `${path}.part` : path);
    const name = freeName(basename(item.getFilename()) || 'download', (candidate) => {
      const path = join(folder, candidate);
      return [path, working(path)].some(
        (taken) => reservedPaths.has(pathKey(taken, process.platform)) || existsSync(taken),
      );
    });
    const suggested = join(folder, name);
    const path = working(suggested);
    const reserved = pathKey(path, process.platform);
    try {
      mkdirSync(folder, { recursive: true });
    } catch (error: unknown) {
      options.logger.warn('The downloads folder could not be made', { error: String(error) });
    }
    reservedPaths.add(reserved);
    item.once('done', () => reservedPaths.delete(reserved));
    item.setSavePath(path);
    options.downloads().then(
      (list) => (ask ? list.ask(item, privateWindow, suggested) : list.track(item, privateWindow)),
      (error: unknown) => options.logger.error('The list of downloads failed', error),
    );
  };
  const openWindow = (
    contents: WebContents,
    opener: WebContents,
    { url, disposition, features }: WindowOpening,
  ): void => {
    const window = windows.forTab(opener);
    const privateWindow = options.isPrivate(opener.session);
    // A popup opens where and as large as the page asked.
    if (disposition === 'new-window' && features !== '') {
      const bounds = popupBounds(
        features,
        window?.window.getBounds() ?? { x: 100, y: 100, width: 1280, height: 820 },
        screen.getAllDisplays().map((display) => display.workArea),
      );
      windows.openWith(contents, url, { bounds, popup: true, private: privateWindow });
      return;
    }
    const target =
      disposition === 'new-window' ? undefined : (window ?? windows.lastUsedOf(privateWindow));
    if (target === undefined) windows.openWith(contents, url, { private: privateWindow });
    else target.adopt(contents, url, disposition !== 'background-tab', opener);
  };
  const blocksPopup = (url: string, opener: WebContents): boolean => {
    const blocked = blocker.blocksPopup(url, opener.getURL());
    if (blocked) windows.countBlocked(opener.id);
    return blocked;
  };
  // Web pages ask before they use the camera, the microphone, the location and the like; the
  // question loads with the first one.
  let prompts: Promise<PermissionPrompts> | undefined;
  const loadPrompts = (): Promise<PermissionPrompts> => {
    prompts ??= Promise.all([import('./permission-prompt.ts'), windows.laterCode()]).then(
      ([{ permissionPrompts }]) =>
        permissionPrompts(options.overlay, options.router, options.logger),
    );
    return prompts;
  };
  const windowOf = (contents: WebContents): ReturnType<WindowManager['forTab']> =>
    windows.forTab(contents);
  const webPermissions = sitePermissions({
    sites: () => settings.get(SitePermissionsSetting),
    save: (sites) => {
      const result = settings.set(SitePermissionsSetting, sites);
      if (!result.ok) {
        options.logger.warn('A permission was not saved', { error: result.error.kind });
      }
    },
    windowOf,
    prompts: loadPrompts,
    logger: options.logger,
  });
  // Private windows ask again, and keep the answers only until the last of them closes: the
  // private session keeps them, and the next private window gets a new session.
  const privatePermissions = new WeakMap<Session, PermissionHandler>();
  const handlerOf = (s: Session): PermissionHandler => {
    if (!options.isPrivate(s)) return webPermissions;
    let handler = privatePermissions.get(s);
    if (handler === undefined) {
      let sites: SitePermissions = {};
      handler = sitePermissions({
        sites: () => sites,
        save: (kept) => {
          sites = kept;
        },
        windowOf,
        prompts: loadPrompts,
        logger: options.logger,
      });
      privatePermissions.set(s, handler);
    }
    return handler;
  };
  // A page that got a camera, a microphone or the screen stays awake.
  const permissions = (s: Session): PermissionHandler => {
    const handler = handlerOf(s);
    return {
      request: (contents, permission, mediaTypes, requestingUrl) =>
        handler.request(contents, permission, mediaTypes, requestingUrl).then((granted) => {
          if (granted && permission === 'media' && mediaTypes.length > 0) {
            options.activity()?.capturing(contents);
          }
          return granted;
        }),
      check: (contents, permission, origin, details) =>
        handler.check(contents, permission, origin, details),
      shareScreen: (request, callback) =>
        handler.shareScreen(request, (streams) => {
          const contents =
            request.frame === null ? undefined : webContents.fromFrame(request.frame);
          if (streams !== null && contents !== undefined) options.activity()?.capturing(contents);
          callback(streams);
        }),
    };
  };
  return {
    pipeline,
    httpsFirst,
    blocker,
    certificates,
    frames,
    saveDownload,
    openWindow,
    blocksPopup,
    permissions,
    protect,
  };
}
