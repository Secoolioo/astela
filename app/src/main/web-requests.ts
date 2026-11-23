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
import type { DocumentReader } from '../domain/blocker/document-requests.ts';
import { freeName, pathKey } from '../domain/downloads/downloads.ts';
import {
  allowsPopups,
  decide,
  originOf,
  storageAccessOpen,
  type SitePermissions,
} from '../domain/permissions/site-permissions.ts';
import { fittedPopup, popupBounds, popupFrame } from '../domain/windows/popup-bounds.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import { CertificateLog } from '../platform/electron/certificate-log.ts';
import { CertificateExceptions } from '../platform/electron/certificates.ts';
import { HttpsFirst } from '../platform/electron/https-first.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import { RequestPipeline, type RequestInterceptor } from '../platform/electron/request-pipeline.ts';
import { pageActivations } from '../platform/electron/page-activation.ts';
import { tabWindowOf } from '../platform/electron/popup-windows.ts';
import type { PermissionHandler } from '../platform/electron/session-security.ts';
import type { TabActivity } from '../platform/electron/tab-activity.ts';
import { ThirdPartyCookies } from '../platform/electron/third-party-cookies.ts';
import { blockerFrames, type BlockerFrames } from './blocker-frames.ts';
import { expandFolder } from './download-folder.ts';
import { watchPageQuestions } from './page-questions.ts';
import { popupBlocker } from './popup-blocker.ts';
import { chosenToSave } from './save-as.ts';
import { listenToFrames, type FrameReports } from './web-frames.ts';
import type { ProtectedMedia } from './protected-media.ts';
import type { SecurityKeyPrompts } from './webauthn-prompt.ts';
import {
  AskDownloadSetting,
  BlockerAnnoyancesSetting,
  BlockerCookieNoticesSetting,
  BlockThirdPartyCookiesSetting,
  ContentBlockerSetting,
  DensitySetting,
  DownloadFolderSetting,
  HttpAllowlistSetting,
  HttpsFirstSetting,
  SitePermissionsSetting,
} from './core-settings.ts';
import type { Downloads } from './downloads.ts';
import type { PageNoticeKind, PageNotices } from './page-notices.ts';
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
  /**
   * The address of the page under a reader view, or `undefined` for a page that is none: the
   * frames of a reader view get no rules of the content blocker, and its pictures load by the
   * rules of that page.
   */
  readonly readerPageOf: (contents: WebContents) => string | undefined;
  /** Whether the content blocker works on a page, as the settings and the exceptions say. */
  readonly blocking: (url: string) => Blocking;
  /** Counts a request that the content blocker blocked for the document that made it. */
  readonly onBlocked: (contentsId: number, document: DocumentReader) => void;
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
  /**
   * The addresses that the policies of the organization block (`network-policies.ts`), which
   * the pipeline asks before its other steps; without it, nothing is blocked by policy.
   */
  readonly urlPolicy?: RequestInterceptor | undefined;
  readonly logger: Logger;
}

/**
 * Where the decisions of sites about permissions are kept for a kind of window: the setting
 * for regular windows and workspaces, the memory of the private session for private windows.
 */
export interface PermissionStore {
  /** The decisions of all sites. */
  readonly sites: () => SitePermissions;
  /**
   * Keeps new decisions, and tells whether they were kept; a policy or a full list can refuse
   * them.
   */
  readonly save: (sites: SitePermissions) => boolean;
  /** Whether a policy manages the decisions, so that they cannot be changed. */
  readonly managed: () => boolean;
}

/**
 * The code for the requests of web pages: the steps of the request pipeline, HTTPS-First,
 * the third-party cookies and the content blocker, with the exceptions for certificates and
 * the answers to the frames of web pages, the logins that sites ask for, the dialogs of pages
 * and their questions to stay, the downloads and the pages that scripts open. It loads with the code for web pages, before the first web
 * page loads, or with the first request or frame of a web page; the browser's own pages need
 * none of it.
 */
export interface WebRequests {
  readonly pipeline: RequestPipeline;
  readonly httpsFirst: HttpsFirst;
  readonly blocker: ContentBlocker;
  /** The certificates that people accepted after the warning, for their session. */
  readonly certificates: CertificateExceptions;
  /**
   * The certificates that Chromium checked, by session and host, which the verify function of
   * each web session hands over (ADR 0059).
   */
  readonly certificateLog: CertificateLog;
  readonly frames: BlockerFrames;
  /**
   * Saves a download in the downloads folder without a question, under a name that is free
   * there, also from downloads that still run; the list and its panel load with the first one.
   * @param item - The download, which gets its path at once.
   * @param from - The session of the page that started it.
   */
  saveDownload(item: DownloadItem, from: Session): void;
  /**
   * Takes the page that a script opened into a window: a popup with a size or position gets a
   * window of its own, whose page has the size that it asked for, anything else a tab, in the
   * background when the user asked for that. A popup shows only its page, so the tabs that its
   * page opens open in a regular window of its workspace. What a page of a private window opens
   * stays private.
   */
  openWindow(contents: WebContents, opener: WebContents, opening: WindowOpening): void;
  /**
   * Whether a window that a page opens is blocked: the filter lists name it, and it counts as
   * blocked by the content blocker; or no click opened it, and its site may not open pop-ups,
   * and the tab of the page lists it as a blocked pop-up. Every window that a page opens uses
   * the input that a person gave the page up, so that one click opens one window.
   */
  blocksPopup(url: string, opener: WebContents): boolean;
  /**
   * The permissions of the pages of a session, as their kind of window decides them: a private
   * session is known only once it was made, so each question looks again.
   */
  permissions(session: Session): PermissionHandler;
  /** Where the decisions of the pages of a session are kept, as their kind of window decides. */
  permissionStore(session: Session): PermissionStore;
  /** Gives a session of web content that was made after this code the frame preload. */
  protect(session: Session): void;
  /**
   * Forgets what this code keeps for a session that ended, such as the private session once the
   * last private window closed: the certificates that Chromium checked and that people
   * accepted, the insecure addresses that they opened and the answers about permissions.
   * Electron keeps every session until the browser quits, so nothing else lets them go.
   */
  forget(session: Session): void;
}

/**
 * Makes the code for the requests of web pages. The addresses that the policies block come
 * first, as no other step may load them; HTTPS-First sends pages to the secure address next;
 * the content blocker follows, and its engine loads with the first web page.
 * @param options - Settings, sessions and callbacks.
 */
export function webRequests(options: WebRequestOptions): WebRequests {
  const { settings } = options;
  const pipeline = new RequestPipeline();
  if (options.urlPolicy !== undefined) pipeline.add(options.urlPolicy);
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
    pageOf: options.readerPageOf,
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
  // With this switch, Chromium connects whatever certificate a site shows, as tests do.
  const certificateLog = new CertificateLog(
    options.app.commandLine.hasSwitch('ignore-certificate-errors'),
  );
  const frames = blockerFrames(
    blocker,
    options.isWebSession,
    (origin, topOrigin, frameSession) =>
      thirdPartyCookies.blocksFrame(origin, topOrigin, frameSession),
    (contents) => options.readerPageOf(contents) !== undefined,
  );
  // Sites that wait for a security key or a passkey ask in the window of their tab; the
  // questions load with the first request.
  let keyPrompts: Promise<SecurityKeyPrompts> | undefined;
  const withKeyPrompts = (
    run: (prompts: SecurityKeyPrompts) => void,
    failed?: () => void,
  ): void => {
    keyPrompts ??= Promise.all([import('./webauthn-prompt.ts'), options.windows.laterCode()]).then(
      ([{ securityKeyPrompts }]) => securityKeyPrompts(options.overlay, options.router),
    );
    keyPrompts.then(run, (error: unknown) => {
      options.logger.error('The questions for security keys did not load', error);
      failed?.();
    });
  };
  // A page that asked for protected video or music in vain shows a sign in the address bar,
  // unless it played media since its document loaded: then a player or a script only probed.
  let media: Promise<ProtectedMedia> | undefined;
  const played = new WeakSet<WebContents>();
  const reports: FrameReports = {
    report: (contents, frame, event, request) => {
      const window = options.isWebSession(contents.session)
        ? options.windows.forTab(contents)
        : undefined;
      if (window !== undefined) {
        withKeyPrompts((prompts) => prompts.report(window, contents, frame, event, request));
      }
    },
    chooseAccount: (details, answer) => {
      const { frame } = details;
      const contents = frame === null ? undefined : webContents.fromFrame(frame);
      const window = contents === undefined ? undefined : options.windows.forTab(contents);
      if (frame === null || contents === undefined || window === undefined) {
        answer();
        return;
      }
      withKeyPrompts(
        (prompts) =>
          prompts.chooseAccount(
            window,
            contents,
            frame,
            details.relyingPartyId,
            details.accounts,
            answer,
          ),
        () => answer(),
      );
    },
    protectedMedia: (contents) => {
      if (!options.isWebSession(contents.session) || played.has(contents)) return;
      media ??= Promise.all([import('./protected-media.ts'), options.windows.laterCode()]).then(
        ([{ protectedMedia }]) => protectedMedia(options.windows, options.overlay, options.router),
      );
      media.then(
        (loaded) => {
          if (!contents.isDestroyed() && !played.has(contents)) loaded.mark(contents);
        },
        (error: unknown) =>
          options.logger.error('The signs of protected media did not load', error),
      );
    },
  };
  // The dialogs of web pages and their questions to stay, from the first web page on.
  const questions = watchPageQuestions({
    app: options.app,
    windows: options.windows,
    router: options.router,
    overlay: options.overlay,
    isWebSession: options.isWebSession,
    logger: options.logger,
  });
  // The frames of web pages ask for their rules as they start, which they can only once this
  // code has loaded, before the first web page; so do their calls of `prompt()`.
  const protect = listenToFrames(
    () => Promise.resolve(frames),
    options.framePreload,
    options.logger,
    (event, message, value) => questions.prompt(event, message, value),
    reports,
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
  const saveDownload = (item: DownloadItem, from: Session): void => {
    const privateWindow = options.isPrivate(from);
    const folder = expandFolder(options.downloadFolder());
    // A file that people chose to save from a context menu asks where, as in other browsers,
    // unless a mandatory policy sets the folder, which then holds it, as in Chrome.
    const chosen = chosenToSave(item.getURLChain()[0]);
    const ask =
      settings.get(AskDownloadSetting) ||
      (chosen && !settings.inspect(DownloadFolderSetting).locked);
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
      (list) =>
        ask
          ? list.ask(item, privateWindow, suggested, from)
          : list.track(item, privateWindow, undefined, from),
      (error: unknown) => options.logger.error('The list of downloads failed', error),
    );
  };
  const openWindow = (
    contents: WebContents,
    opener: WebContents,
    { url, disposition, features }: WindowOpening,
  ): void => {
    const window = windows.forTab(opener);
    // What a page opens stays in the page's workspace, whose partition it uses.
    const place = {
      private: options.isPrivate(opener.session),
      workspace: window?.tabs.workspaceOf(window.tabIdOf(opener) ?? ''),
    };
    // A popup opens where the page asked, and its page as large as the page asked: its window
    // has only a toolbar around it.
    if (disposition === 'new-window' && features !== '') {
      const areas = screen.getAllDisplays().map((display) => display.workArea);
      const bounds = popupBounds(
        features,
        window?.window.getBounds() ?? { x: 100, y: 100, width: 1280, height: 820 },
        areas,
        popupFrame(settings.get(DensitySetting)),
      );
      const popup = windows.openWith(contents, url, { ...place, bounds, popup: true }).window;
      // The title bar of the system adds to the size of the page; the window still fits.
      const outer = popup.getBounds();
      const fitted = fittedPopup(outer, areas);
      if (JSON.stringify(fitted) !== JSON.stringify(outer)) popup.setBounds(fitted);
      return;
    }
    // A popup shows only its page: what its page opens in a tab opens in a regular window.
    const activate = disposition !== 'background-tab';
    const target =
      disposition === 'new-window'
        ? undefined
        : window?.popup === true
          ? tabWindowOf(window)
          : (window ?? windows.lastUsedOf(place.private));
    if (target === undefined) windows.openWith(contents, url, place);
    else target.adopt(contents, url, activate, opener);
    // The regular window comes to the front of the popup, for the tab that opened in front.
    if (activate && window?.popup === true) target?.window.focus();
  };
  const blocksPopup = (url: string, opener: WebContents): boolean => {
    const activated = pageActivations.consume(opener);
    if (blocker.blocksPopup(url, opener.getURL())) {
      windows.countBlocked(opener.id);
      return true;
    }
    return !activated && popups.block(url, opener);
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
  let notices: Promise<PageNotices> | undefined;
  const notice = (
    window: BrowserWindowController,
    contents: WebContents,
    kind: PageNoticeKind,
  ): void => {
    notices ??= Promise.all([import('./page-notices.ts'), windows.laterCode()]).then(
      ([{ pageNotices }]) => pageNotices(options.overlay, options.router),
    );
    notices.then(
      (loaded) => loaded.show(window, contents, kind),
      (error: unknown) => options.logger.error('The notices of pages did not load', error),
    );
  };
  // A page of a tab that takes the whole screen or the mouse pointer says so in its window.
  const noticeOf = (contents: WebContents, kind: PageNoticeKind): void => {
    const window = windowOf(contents);
    if (window !== undefined) notice(window, contents, kind);
  };
  // This code loads before the first web page loads, so that pages made before it get the
  // notice as well, and pages that play media are known before the sign of protected media.
  const watchPage = (contents: WebContents): void => {
    if (!options.isWebSession(contents.session)) return;
    contents.on('enter-html-full-screen', () => noticeOf(contents, 'fullScreen'));
    contents.on('media-started-playing', () => played.add(contents));
    contents.on('did-navigate', () => played.delete(contents));
  };
  for (const contents of webContents.getAllWebContents()) watchPage(contents);
  options.app.on('web-contents-created', (_event, contents) => watchPage(contents));
  const pointerNotice = (contents: WebContents): void => noticeOf(contents, 'pointerLock');
  const regularStore: PermissionStore = {
    sites: () => settings.get(SitePermissionsSetting),
    save: (sites) => {
      const result = settings.set(SitePermissionsSetting, sites);
      if (!result.ok) {
        options.logger.warn('A permission was not saved', { error: result.error.kind });
      }
      return result.ok;
    },
    managed: () => settings.inspect(SitePermissionsSetting).locked,
  };
  // Private windows ask again, and keep the answers only until the last of them closes: the
  // private session keeps them, and the next private window gets a new session.
  const privateStores = new WeakMap<Session, PermissionStore>();
  const permissionStore = (s: Session): PermissionStore => {
    if (!options.isPrivate(s)) return regularStore;
    let store = privateStores.get(s);
    if (store === undefined) {
      let sites: SitePermissions = {};
      store = {
        sites: () => sites,
        save: (kept) => {
          sites = kept;
          return true;
        },
        managed: () => false,
      };
      privateStores.set(s, store);
    }
    return store;
  };
  const handlerFor = (store: PermissionStore): PermissionHandler =>
    sitePermissions({
      sites: store.sites,
      save: (sites) => void store.save(sites),
      windowOf,
      prompts: loadPrompts,
      pointerLocked: pointerNotice,
      logger: options.logger,
    });
  const webPermissions = handlerFor(regularStore);
  const privatePermissions = new WeakMap<Session, PermissionHandler>();
  const handlerOf = (s: Session): PermissionHandler => {
    if (!options.isPrivate(s)) return webPermissions;
    let handler = privatePermissions.get(s);
    if (handler === undefined) {
      handler = handlerFor(permissionStore(s));
      privatePermissions.set(s, handler);
    }
    return handler;
  };
  // A frame of another site that asks for its cookies learns whether it has them, without a
  // question: while they are blocked, a grant would give it none.
  const cookiesOpen = (s: Session): boolean =>
    storageAccessOpen({
      native: options.nativeCookieBlocking,
      private: options.isPrivate(s),
      setting: settings.get(BlockThirdPartyCookiesSetting),
    });
  // Pages open windows after a click, and those of the sites that people allowed also without
  // one, in the store of the decisions of their kind of window.
  const popups = popupBlocker({
    windows,
    router: options.router,
    overlay: options.overlay,
    allows: (contents) => {
      const origin = originOf(contents.getURL());
      return (
        origin !== undefined && allowsPopups(permissionStore(contents.session).sites(), origin)
      );
    },
    allow: (contents) => {
      const origin = originOf(contents.getURL());
      const store = permissionStore(contents.session);
      if (origin !== undefined) store.save(decide(store.sites(), origin, ['popups'], 'allow'));
    },
  });
  // A page that got a camera, a microphone or the screen stays awake.
  const permissions = (s: Session): PermissionHandler => {
    const handler = handlerOf(s);
    return {
      request: (contents, permission, mediaTypes, requestingUrl) =>
        permission === 'storage-access'
          ? Promise.resolve(cookiesOpen(s))
          : handler.request(contents, permission, mediaTypes, requestingUrl).then((granted) => {
              if (granted && permission === 'media' && mediaTypes.length > 0) {
                options.activity()?.capturing(contents);
              }
              return granted;
            }),
      check: (contents, permission, origin, details) =>
        permission === 'storage-access'
          ? cookiesOpen(s)
          : handler.check(contents, permission, origin, details),
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
    certificateLog,
    frames,
    saveDownload,
    openWindow,
    blocksPopup,
    permissions,
    permissionStore,
    protect,
    forget: (s) => {
      certificateLog.forget(s);
      certificates.forget(s);
      httpsFirst.forgetSession(s);
      privateStores.delete(s);
      privatePermissions.delete(s);
    },
  };
}
