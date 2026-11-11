import { hostResolverOptions } from '../shared/secure-dns.ts';
import { app, Menu, session, webContents, type DownloadItem, type Session } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { brand } from '../shared/brand.ts';
import { languageArguments } from '../shared/ui-language.ts';
import { sameZoom } from '../shared/zoom.ts';
import { newTabUrl, pageUrl, tabPages } from '../shared/internal-pages.ts';
import {
  GetNewTabState,
  NavigateFromNewTab,
  NewTabChanged,
  type NewTabState,
} from '../shared/ipc/newtab-contracts.ts';
import {
  ActivateTab,
  CloseTab,
  GetShellState,
  ShellCommand,
  NavigateTab,
  OpenTab,
  SetShellInsets,
  TabAction,
} from '../shared/ipc/shell-contracts.ts';
import { shellLaterChannels } from '../shared/ipc/shell-channels.ts';
import {
  FanOutLogSink,
  RingBufferLogSink,
  SinkLogger,
  type Logger,
} from '../kernel/logging/logger.ts';
import { mayOpenInNewTab } from '../domain/navigation/new-tab.ts';
import type { SearchShortcuts } from '../domain/navigation/omnibox.ts';
import { engineForSearchUrl, type CustomSearchEngine } from '../shared/search-engines.ts';
import { linksFromArguments, restoreSessionSwitch } from '../domain/navigation/links.ts';
import { blockingFor, siteOf, type Blocking } from '../domain/blocker/blocking.ts';
import { webFontPreferences } from '../domain/appearance/appearance.ts';
import { parseSession } from '../domain/session/session.ts';
import { PolicyService } from '../domain/policy/policy-service.ts';
import type { SettingDefinition } from '../domain/settings/setting.ts';
import { SettingsService, settingPolicies } from '../domain/settings/settings-service.ts';
import { updatePolicies } from '../domain/updates/update-policies.ts';
import { SetupGuideEnabled, shouldShowSetupGuide } from '../domain/setup/setup-guide.ts';
import { AppProtocol, registerAppScheme } from '../platform/electron/app-protocol.ts';
import {
  WindowManager,
  type BrowserWindowController,
  type ContextMenuRequest,
} from '../platform/electron/browser-window.ts';
import { IpcGate } from '../platform/electron/ipc-gate.ts';
import { IpcRouter } from '../platform/electron/ipc-router.ts';
import { HttpsFirst } from '../platform/electron/https-first.ts';
import { RequestPipeline } from '../platform/electron/request-pipeline.ts';
import { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import { serveResources } from '../platform/blocker/resource-protocol.ts';
import {
  cleanUserAgent,
  guardWebContents,
  hardenSession,
  type PermissionHandler,
} from '../platform/electron/session-security.ts';
import { RotatingFileLogSink } from '../platform/node/file-log-sink.ts';
import { JsonFileSettingsStore } from '../platform/node/json-settings-store.ts';
import { JsonFileSessionStore } from '../platform/node/session-store.ts';
import { SystemClock } from '../platform/node/system-clock.ts';
import { JsonFilePolicyCache } from '../platform/policy/policy-cache.ts';
import { createPolicyProviders } from '../platform/policy/platform-providers.ts';
import {
  AskDownloadSetting,
  BookmarksBarSetting,
  DownloadFolderSetting,
  HomeButtonSetting,
  HomePageSetting,
  HttpAllowlistSetting,
  HttpsFirstSetting,
  SecureDnsSetting,
  SecureDnsTemplatesSetting,
  NewTabClockSetting,
  NewTabSearchSetting,
  NewTabTilesSetting,
  StartupPagesSetting,
  StartupSetting,
  BlockerAllowedSitesSetting,
  BlockerAnnoyancesSetting,
  BlockerCookieNoticesSetting,
  ContentBlockerSetting,
  DefaultZoomSetting,
  LanguageSetting,
  WebFontsSetting,
  WebTextSizeSetting,
  SearchBangsSetting,
  SearchEnginesSetting,
  SearchUrlTemplate,
  SetupShownSetting,
  SiteZoomSetting,
  SitePermissionsSetting,
  TabStripPositionSetting,
  ToolbarItemsSetting,
  coreSettings,
} from './core-settings.ts';
import { AppearanceController } from './appearance.ts';
import { chooseLanguage } from './ui-language.ts';
import type { Bookmarks } from './bookmarks.ts';
import {
  canBeDefaultBrowser,
  DefaultBrowserSettingEnabled,
} from '../domain/default-browser/default-browser.ts';
import { ImportEnabled } from '../domain/import/import.ts';
import { SSLErrorOverrideAllowed } from '../domain/certificates/certificates.ts';
import { DeveloperToolsAvailability } from '../domain/page-tools/page-tools.ts';
import { PrivateModeAvailability } from '../domain/windows/private-windows.ts';
import type { SitePermissions } from '../domain/permissions/site-permissions.ts';
import { CertificateExceptions } from '../platform/electron/certificates.ts';
import type { DataClient, DataServiceClient } from '../platform/electron/data-service-client.ts';
import { connectBlockerFrames } from './blocker-frames.ts';
import { freeName, pathKey } from '../domain/downloads/downloads.ts';
import type { Downloads } from './downloads.ts';
import type { PermissionPrompts } from './permission-prompt.ts';
import { sitePermissions } from './site-permissions.ts';
import { GetBlockerStatus } from '../shared/ipc/blocker-contracts.ts';
import { checkBoot } from './boot.ts';
import { windowBackground } from './window-background.ts';
import type { UpdateService } from '../domain/updates/update-service.ts';

/** Paths of the bundled files, relative to the main bundle. */
export interface BundleLayout {
  /** Directory of the renderer build (one folder per internal host). */
  readonly rendererDir: string;
  /** Preload script of the shell. */
  readonly shellPreload: string;
  /** Preload script of internal pages. */
  readonly pagePreload: string;
  /** Folder of the content blocker data. */
  readonly blockerDir: string;
  /** Path of the content blocker's preload for the frames of web pages. */
  readonly framePreload: string;
  /** Path of the data service's entry. */
  readonly dataService: string;
  /** Dev server URL of the shell, only during development. */
  readonly devShellUrl: string | undefined;
}

const internalPartition = 'internal';
const webPartition = 'persist:default';
/** Private windows keep the data of their pages in memory: partitions without `persist:`. */
const privatePartition = 'private';

/**
 * Starts the browser. The order matters for start-up time and safety: schemes and the
 * last known policies before `ready`, fresh policies before the window, sessions hardened
 * before any view exists, the window as early as possible, everything else after the
 * first paint.
 * @param layout - Where the bundled files are.
 */
export async function bootstrap(layout: BundleLayout): Promise<void> {
  // Other apps hand over links as events on macOS and as a second start elsewhere, also
  // before the first window exists; until then the links wait.
  const pendingLinks: string[] = [];
  let openLinks = (links: readonly string[]): void => void pendingLinks.push(...links);
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openLinks(linksFromArguments([url]));
  });
  app.on('second-instance', (_event, argv) => openLinks(linksFromArguments(argv.slice(1))));
  // Milliseconds since process start at each step, for the self-test report.
  const marks: Record<string, number> = { main: Math.round(performance.now()) };
  // Wall-clock time at which these milliseconds start, to add the shell page's own timing.
  const timeOrigin = Date.now() - performance.now();
  registerAppScheme();
  app.setName(brand.productName);
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  // Windows shows notifications only for the ID that the installers give the app's shortcuts.
  if (process.platform === 'win32') app.setAppUserModelId(brand.appId);
  const safeMode = app.commandLine.hasSwitch('safe-mode');
  // The self-test is only for package checks; it loads at once, off the start-up path.
  const smokeReport = app.commandLine.getSwitchValue('smoke-test');
  const smokeTest = smokeReport === '' ? undefined : import('./smoke-test.ts');
  const clock = new SystemClock();
  const userData = app.getPath('userData');
  const recentLogs = new RingBufferLogSink(500);
  const logger: Logger = new SinkLogger(
    new FanOutLogSink([
      new RotatingFileLogSink({ directory: join(userData, 'logs'), name: 'main' }),
      recentLogs,
    ]),
    clock,
    { scope: 'main', level: app.isPackaged ? 'info' : 'debug' },
  );
  logger.info('Starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    safeMode,
  });

  // Until the sources have been read, policies apply as the last start left them, so the
  // read runs while Electron starts; the first window waits for it.
  const policies = new PolicyService(
    [
      ...settingPolicies(coreSettings),
      ...updatePolicies,
      SetupGuideEnabled,
      ImportEnabled,
      SSLErrorOverrideAllowed,
      DeveloperToolsAvailability,
      PrivateModeAvailability,
      DefaultBrowserSettingEnabled,
    ],
    createPolicyProviders(brand, process.platform),
    logger,
    new JsonFilePolicyCache(join(userData, 'policy-cache.json')),
  );
  policies.applyCached();
  const freshPolicies = policies.refresh();
  // Whether the shell of the first window has loaded; until then, the policies that were
  // just read for the start are current.
  let shellLoaded = false;

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // After the lock, so a second start of a running browser is not counted as a start.
  const boot = await checkBoot(logger);
  if (boot === undefined) {
    app.exit(0);
    return;
  }
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(macMenu()) : null);
  // User settings load while Electron starts; the first window waits for them, because its
  // colors and sizes come from them.
  const store = new JsonFileSettingsStore(
    join(userData, 'settings.json'),
    join(userData, 'settings.rejected.json'),
    clock,
  );
  const settings = new SettingsService(coreSettings, policies, store, logger);
  // The session of the last start is read alongside, for the first window.
  const sessionStore = new JsonFileSessionStore(join(userData, 'session.json'), clock);
  const savedSession = sessionStore.read();
  const settingsLoaded = settings
    .load()
    .catch((error: unknown) => logger.error('Settings could not be loaded; defaults apply', error))
    .then(() => {
      marks['settings'] = Math.round(performance.now());
    });

  await app.whenReady();
  marks['ready'] = Math.round(performance.now());
  await freshPolicies;
  marks['policies'] = Math.round(performance.now());
  await settingsLoaded;
  // Settings that need a restart keep the value of this start, such as the language of the
  // menus, the dialogs and the browser's own views; the settings page compares with these.
  const language = settings.get(LanguageSetting);
  chooseLanguage(language);
  const definitions: readonly SettingDefinition<unknown>[] = coreSettings;
  const startValues = new Map(
    definitions
      .filter((definition) => definition.restartRequired === true)
      .map((definition) => [definition.key, JSON.stringify(settings.get(definition))]),
  );
  const protocolHandler = new AppProtocol(
    layout.rendererDir,
    new Set(['shell', 'overlay', 'sandbox-help', ...tabPages]),
  );
  const internal = session.fromPartition(internalPartition);
  protocolHandler.serve(internal);
  hardenSession(internal);
  // The data service, and the code that talks to it, start with the first call.
  let dataClient: Promise<DataServiceClient> | undefined;
  let startedClient: DataServiceClient | undefined;
  const data: DataClient = {
    call: (method, ...params) => {
      dataClient ??= import('../platform/electron/data-service-client.ts').then(
        ({ DataServiceClient: Client }) =>
          (startedClient = new Client(
            layout.dataService,
            join(userData, 'profile.db'),
            logger.child('data'),
          )),
      );
      return dataClient.then((client) => client.call(method, ...params));
    },
    dispose: () => startedClient?.dispose(),
  };
  // Every request of web content passes the request pipeline. HTTPS-First sends pages to the
  // secure address first; the content blocker follows, and its engine loads with the first
  // web page.
  const pipeline = new RequestPipeline();
  const httpsFirst = new HttpsFirst({
    enabled: () => settings.get(HttpsFirstSetting),
    allowlist: () => settings.get(HttpAllowlistSetting),
  });
  pipeline.add(httpsFirst);
  // A blocker without filter data shows that it fails where it should block.
  const blocking = (url: string): Blocking => {
    const value = blockingFor(
      url,
      settings.get(ContentBlockerSetting),
      settings.get(BlockerAllowedSitesSetting),
    );
    return value === 'on' && blocker.status === 'failed' ? 'failed' : value;
  };
  const blocker: ContentBlocker = new ContentBlocker({
    dataDir: layout.blockerDir,
    // Off everywhere wins; a page whose address is not known yet is blocked as usual.
    enabled: (page) => settings.get(ContentBlockerSetting) && blocking(page) !== 'off',
    onBlocked: (contentsId) => windows.countBlocked(contentsId),
    onStatus: () => windows.refreshShells(),
    extras: () => [
      ...(settings.get(BlockerCookieNoticesSetting) ? (['cookies'] as const) : []),
      ...(settings.get(BlockerAnnoyancesSetting) ? (['annoyances'] as const) : []),
    ],
    logger: logger.child('blocker'),
  });
  pipeline.add(blocker);
  // Web pages ask before they use the camera, the microphone, the location and the like; the
  // question loads with the first one.
  let prompts: Promise<PermissionPrompts> | undefined;
  const loadPrompts = (): Promise<PermissionPrompts> => {
    prompts ??= import('./permission-prompt.ts').then(({ permissionPrompts }) =>
      permissionPrompts(overlayOptions, router, logger),
    );
    return prompts;
  };
  const webPermissions = sitePermissions({
    sites: () => settings.get(SitePermissionsSetting),
    save: (sites) => {
      const result = settings.set(SitePermissionsSetting, sites);
      if (!result.ok) logger.warn('A permission was not saved', { error: result.error.kind });
    },
    windowOf: (contents) => windows.forTab(contents),
    prompts: loadPrompts,
    logger,
  });
  // Private windows ask again, and keep the answers only until the last of them closes.
  let privateSites: SitePermissions = {};
  const privatePermissions = sitePermissions({
    sites: () => privateSites,
    save: (sites) => {
      privateSites = sites;
    },
    windowOf: (contents) => windows.forTab(contents),
    prompts: loadPrompts,
    logger,
  });
  // Downloads go to the downloads folder without a question, under a name that is free there,
  // also from downloads that still run; the list and its panel load with the first download.
  let downloads: Downloads | undefined;
  let downloadsLoaded: Promise<Downloads> | undefined;
  const downloadFolder = (): string =>
    settings.get(DownloadFolderSetting) || app.getPath('downloads');
  const loadDownloads = (): Promise<Downloads> => {
    downloadsLoaded ??= import('./downloads.ts').then(({ Downloads: List }) => {
      downloads = new List({
        data,
        windows,
        folder: downloadFolder,
        webSession: (privateWindow) =>
          privateWindow ? privateWeb() : session.fromPartition(webPartition),
        overlay: overlayOptions,
        router,
        logger: logger.child('downloads'),
      });
      return downloads;
    });
    return downloadsLoaded;
  };
  const reservedPaths = new Set<string>();
  const saveDownload = (item: DownloadItem, privateWindow: boolean): void => {
    const folder = downloadFolder();
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
      logger.warn('The downloads folder could not be made', { error: String(error) });
    }
    reservedPaths.add(reserved);
    item.once('done', () => reservedPaths.delete(reserved));
    item.setSavePath(path);
    loadDownloads().then(
      (list) => (ask ? list.ask(item, privateWindow, suggested) : list.track(item, privateWindow)),
      (error: unknown) => logger.error('The list of downloads failed', error),
    );
  };
  const webSessions = new Set<Session>();
  // The sessions of private windows: a new one after the last private window closed.
  const privateSessions = new WeakSet<Session>();
  // A session's pages get the answers of their kind of window. A private session is known
  // only once it was made, so each question looks again.
  const permissionsOf = (s: Session): PermissionHandler => {
    const handler = (): PermissionHandler =>
      privateSessions.has(s) ? privatePermissions : webPermissions;
    return {
      request: (contents, permission, mediaTypes, requestingUrl) =>
        handler().request(contents, permission, mediaTypes, requestingUrl),
      check: (contents, permission, origin, details) =>
        handler().check(contents, permission, origin, details),
      shareScreen: (request, callback) => handler().shareScreen(request, callback),
    };
  };
  const addFramePreload = connectBlockerFrames(
    blocker,
    (s) => webSessions.has(s),
    layout.framePreload,
  );
  const protectWebSession = (s: Session): void => {
    if (s !== internal && !webSessions.has(s)) {
      webSessions.add(s);
      protocolHandler.refuse(s);
      serveResources(s, (name) => blocker.resource(name));
      hardenSession(s, permissionsOf(s));
      s.on('will-download', (_event, item) => saveDownload(item, privateSessions.has(s)));
      pipeline.attach(s);
      addFramePreload(s);
    }
  };
  app.on('session-created', protectWebSession);
  protectWebSession(session.defaultSession);
  protectWebSession(session.fromPartition(webPartition));
  // Private windows share a session in memory, made with the first of them; after the last
  // of them closed, its data is deleted and the next private window gets a new session.
  let privateSession: Session | undefined;
  let privateRuns = 0;
  const privateWeb = (): Session => {
    if (privateSession === undefined) {
      privateRuns += 1;
      const created = session.fromPartition(`${privatePartition}-${privateRuns}`);
      privateSessions.add(created);
      protectWebSession(created);
      privateSession = created;
    }
    return privateSession;
  };
  const forgetPrivate = (): void => {
    const ended = privateSession;
    privateSession = undefined;
    privateSites = {};
    downloads?.forgetPrivate();
    if (ended === undefined) return;
    Promise.all([ended.clearStorageData(), ended.clearCache(), ended.clearAuthCache()]).catch(
      (error: unknown) => logger.warn('Private data was not deleted', { error: String(error) }),
    );
  };
  // Organizations can keep people from opening private windows.
  const privateWindowsAllowed = (): boolean =>
    policies.mandatoryValue(PrivateModeAvailability) !== 1;
  const openPrivateWindow = (): void => {
    if (privateWindowsAllowed()) windows.open(undefined, { private: true });
  };

  const gate = new IpcGate(clock);
  const router = new IpcRouter(gate, logger);
  if (app.commandLine.hasSwitch('sandbox-help')) {
    // Started by the AppImage launcher because the sandbox cannot work: no web content.
    const [{ showSandboxHelp }, { runSandboxHelpSmokeTest }] = await Promise.all([
      import('./sandbox-help.ts'),
      import('./smoke-test.ts'),
    ]);
    const help = showSandboxHelp({
      url: 'app://sandbox-help/',
      origin: 'app://sandbox-help',
      preload: layout.pagePreload,
      partition: internalPartition,
      gate,
      router,
      logger,
    });
    app.on('window-all-closed', () => app.quit());
    const helpReport = app.commandLine.getSwitchValue('smoke-test');
    if (helpReport !== '') {
      runSandboxHelpSmokeTest(help.webContents, helpReport);
    }
    return;
  }
  const searchTemplate = async (): Promise<string> => {
    await settingsLoaded;
    return settings.get(SearchUrlTemplate);
  };
  const searchShortcuts = async (): Promise<SearchSettings> => {
    await settingsLoaded;
    return { engines: settings.get(SearchEnginesSetting), bangs: settings.get(SearchBangsSetting) };
  };
  // Every tab that a page opens, from a script or from the context menu, takes this path.
  const openFromPage = (url: string, opener: Electron.WebContents, activate = true): void => {
    if (mayOpenInNewTab(url)) windows.forTab(opener)?.tabs.open(url, { activate });
  };
  // Chromium's value 2 keeps the developer tools closed; 0 and 1 allow them for web pages.
  const developerTools = (): boolean => policies.mandatoryValue(DeveloperToolsAvailability) !== 2;
  // The menu code loads with the first context menu, not before the first window.
  const onContextMenu = (request: ContextMenuRequest): void => {
    void import('./context-menu.ts')
      .then(({ popupContextMenu }) =>
        popupContextMenu(request, {
          searchTemplate,
          openTab: openFromPage,
          developerTools,
          isInternal: (contents) => contents.session === internal,
          logger,
        }),
      )
      .catch((error: unknown) => logger.error('The context menu failed', error));
  };

  // The star in the address bar shows whether a page has a bookmark; the bookmarks load with
  // the first web page that a tab shows, or with the bookmarks bar.
  let bookmarks: Bookmarks | undefined;
  let bookmarksLoaded: Promise<Bookmarks> | undefined;
  const loadBookmarks = (): Promise<Bookmarks> => {
    bookmarksLoaded ??= import('./bookmarks.ts').then(
      ({ Bookmarks: List }) =>
        (bookmarks = new List(
          data,
          router,
          internal,
          () => windows.refreshShells(),
          logger.child('bookmarks'),
        )),
    );
    return bookmarksLoaded;
  };
  const appearance = await AppearanceController.create(settings, router, internal, () =>
    windows.repaintBackgrounds(),
  );
  const windows = new WindowManager({
    shellUrl: layout.devShellUrl ?? 'app://shell/',
    shellOrigin:
      layout.devShellUrl === undefined ? 'app://shell' : new URL(layout.devShellUrl).origin,
    shellPreload: layout.shellPreload,
    pagePreload: layout.pagePreload,
    internalPartition,
    webPartition,
    privateSession: privateWeb,
    newTabUrl,
    backgroundColor: windowBackground,
    appearanceArgument: () => appearance.argument,
    languageArguments: languageArguments(language),
    webFonts: () =>
      webFontPreferences(settings.get(WebFontsSetting), settings.get(WebTextSizeSetting)),
    homeButton: () => settings.get(HomeButtonSetting),
    defaultZoom: () => settings.get(DefaultZoomSetting),
    homePage: () => settings.get(HomePageSetting),
    tabStripPosition: () => settings.get(TabStripPositionSetting),
    toolbar: () => settings.get(ToolbarItemsSetting),
    blocking,
    // The history records every web page a tab shows; the data service starts with it.
    onVisit: (url, title, titleOnly) => {
      const call = titleOnly
        ? data.call('setTitle', url, title)
        : data.call('addVisit', url, title);
      call.catch((error: unknown) => logger.warn('History not saved', { error: String(error) }));
    },
    // The first web page loads the bookmarks; until they are there, no page has one.
    isBookmarked: (url) => {
      if (bookmarks !== undefined) return bookmarks.has(url);
      if (/^https?:/i.test(url)) void loadBookmarks().then((list) => list.has(url));
      return false;
    },
    toggleBookmark: (url, title) => void loadBookmarks().then((list) => list.toggle(url, title)),
    // The bookmarks bar loads the bookmarks only while it shows.
    bookmarksBar: () => {
      if (!settings.get(BookmarksBarSetting)) return null;
      if (bookmarks !== undefined) return bookmarks.barItems();
      void loadBookmarks().then((list) => list.barItems());
      return [];
    },
    toggleBookmarksBar: () =>
      void settings.set(BookmarksBarSetting, !settings.get(BookmarksBarSetting)),
    downloads: (privateWindow) => downloads?.summary(privateWindow) ?? null,
    openWindow: () => void windows.open(),
    openPrivateWindow,
    // Administrators expect a change of policy to show when they come back to the browser.
    // The focus that the first window gets at start does not read them a second time.
    onFocus: () => {
      if (shellLoaded) void policies.refresh();
    },
    onPrivateWindowsClosed: forgetPrivate,
    // The shortcut shows the downloads button first; the shell opens the list at it.
    showDownloads: (window) =>
      void loadDownloads().then((list) => {
        list.reveal(window.isPrivate);
        window.refreshShell();
        router.publish(ShellCommand, window.shellContents, 'downloads.open');
      }),
    // The handlers of the other internal pages load with the first of them, before it loads.
    prepareInternalPage: (page) => (page === 'newtab' ? undefined : connectPages()),
    gate,
    router,
    logger,
    onContextMenu,
    certificateOverride: () => policies.mandatoryValue(SSLErrorOverrideAllowed) !== false,
    insecureAddressFor: (contents, failed) => httpsFirst.insecureAddressFor(contents, failed),
    onPageCommand: (window, command, contents) =>
      void import('./page-tools.ts').then(({ runPageCommand }) =>
        runPageCommand(window, command, contents, {
          developerTools,
          logger,
        }),
      ),
    zoomFor: (url) => {
      const host = siteOf(url);
      return host === undefined ? undefined : settings.get(SiteZoomSetting)[host];
    },
    onZoom: (url, factor) => {
      const host = siteOf(url);
      if (host === undefined) return;
      const { [host]: _old, ...others } = settings.get(SiteZoomSetting);
      // A site at the default zoom has no zoom of its own.
      const plain = sameZoom(factor, settings.get(DefaultZoomSetting));
      void settings.set(SiteZoomSetting, plain ? others : { ...others, [host]: factor });
    },
    onUnresponsive: (window, tabId, contents) =>
      void import('./hang-prompt.ts').then(({ askAboutHangingPage }) =>
        askAboutHangingPage(window, tabId, contents),
      ),
  });
  // Not asked for yet, loading, or `true` once the handlers are there.
  let pages: Promise<void> | true | undefined;
  const connectPages = (): Promise<void> | undefined => {
    if (pages === true) return undefined;
    pages ??= Promise.all([import('./page-handlers.ts'), loadBookmarks()])
      .then(([{ connectPages: connect }, list]) => {
        connect({
          router,
          settings,
          definitions: coreSettings,
          internal,
          data,
          bookmarks: list,
          windows,
          importAllowed: () => policies.mandatoryValue(ImportEnabled) !== false,
          defaultBrowserAllowed: () =>
            policies.mandatoryValue(DefaultBrowserSettingEnabled) !== false,
          canBeDefaultBrowser: canBeDefaultBrowser(boot.installType),
          startValues,
          webSession: () => session.fromPartition(webPartition),
        });
        pages = true;
      })
      .catch((error: unknown) =>
        logger.error('The handlers of internal pages did not load', error),
      );
    return pages;
  };
  guardWebContents(app, {
    // Every view of the internal session is the browser's own: the shell and internal pages.
    isInternal: (contents) => contents.session === internal,
    // What a script opens keeps its opener: a popup with a size or position gets a window of
    // its own, anything else a tab, in the background when the user asked for that.
    // What a page of a private window opens stays private.
    openWindow: (contents, opener, { url, disposition, features }) => {
      const window = windows.forTab(opener);
      const privateWindow = privateSessions.has(opener.session);
      if (disposition === 'new-window' && features !== '') {
        windows.openPopup(contents, url, features, window, privateWindow);
        return;
      }
      const target =
        disposition === 'new-window' ? undefined : (window ?? windows.lastUsedOf(privateWindow));
      if (target === undefined) windows.openWith(contents, url, { private: privateWindow });
      else target.adopt(contents, url, disposition !== 'background-tab');
    },
    // Popups that the filter lists name do not open, and count as blocked on their page.
    blocksPopup: (url, opener) => {
      const blocked = blocker.blocksPopup(url, opener.getURL());
      if (blocked) windows.countBlocked(opener.id);
      return blocked;
    },
    logger,
  });
  registerShellHandlers(router, windows, searchTemplate, searchShortcuts);
  const overlayOptions = {
    url: 'app://overlay/',
    preload: layout.pagePreload,
    partition: internalPartition,
    appearanceArgument: () => appearance.argument,
    languageArguments: languageArguments(language),
    gate,
    router,
  };
  // Sites and proxies that ask for a user name and password ask in the tab's window.
  app.on('login', (event, contents, details, info, callback) => {
    const window = contents === null ? undefined : windows.forTab(contents);
    if (window === undefined || contents === null) return;
    event.preventDefault();
    void import('./login-prompt.ts').then(({ askForLogin }) =>
      askForLogin(window, contents, details, info, callback, overlayOptions, router),
    );
  });
  // Certificates that the user accepted after the warning hold for this session.
  const certificates = new CertificateExceptions(
    () => policies.mandatoryValue(SSLErrorOverrideAllowed) !== false,
  );
  certificates.attach(app);
  // Requests of the shell that its first paint does not need load with the first of them.
  router.handleLater(shellLaterChannels, () =>
    import('./shell-later.ts').then(({ registerLaterShellHandlers }) =>
      registerLaterShellHandlers({
        router,
        windows,
        privateWindows: privateWindowsAllowed,
        openDownloads: (window, anchor) =>
          void loadDownloads().then((list) => list.open(window, anchor)),
        allowCertificate: (contents) => certificates.allow(contents),
        allowInsecure: (contents, address) => httpsFirst.allow(contents, address),
        folderContents: (folder) => bookmarks?.contents(folder) ?? [],
        openShieldPopover: async (window, anchor) => {
          const { openShieldPopover } = await import('./shield-popover.ts');
          openShieldPopover(window, anchor, {
            windows,
            router,
            overlay: overlayOptions,
            settings,
            blocker,
            blocking,
          });
        },
      }),
    ),
  );
  // What the new tab page shows besides the search engine, as the settings say.
  const newTabState = async (): Promise<NewTabState> => {
    const template = await searchTemplate();
    const custom = (await searchShortcuts()).engines.find((engine) => engine.url === template);
    return {
      engine: engineForSearchUrl(template)?.name ?? custom?.name ?? null,
      search: settings.get(NewTabSearchSetting),
      clock: settings.get(NewTabClockSetting),
      tiles: settings.get(NewTabTilesSetting),
    };
  };
  registerNewTabHandlers(router, windows, newTabState, searchTemplate, searchShortcuts);
  // Electron starts without DNS over HTTPS, whatever its documentation says, so the browser
  // sets the mode of the host resolver itself, at the start and when the settings change.
  const applySecureDns = (): void =>
    app.configureHostResolver(
      hostResolverOptions(settings.get(SecureDnsSetting), settings.get(SecureDnsTemplatesSetting)),
    );
  applySecureDns();
  settings.onDidChange(({ keys }) => {
    if (keys.includes(SecureDnsSetting.key) || keys.includes(SecureDnsTemplatesSetting.key)) {
      applySecureDns();
    }
  });
  const newTabKeys = new Set([
    NewTabSearchSetting.key,
    NewTabClockSetting.key,
    NewTabTilesSetting.key,
    SearchUrlTemplate.key,
    SearchEnginesSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
    if (!keys.some((key) => newTabKeys.has(key))) return;
    void newTabState().then((state) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.session === internal && contents.getURL().startsWith(newTabUrl)) {
          router.publish(NewTabChanged, contents, state);
        }
      }
    });
  });
  const shellSettings = new Set([
    BookmarksBarSetting.key,
    HomeButtonSetting.key,
    DefaultZoomSetting.key,
    ToolbarItemsSetting.key,
    TabStripPositionSetting.key,
    ContentBlockerSetting.key,
    BlockerAllowedSitesSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
    if (keys.includes(DefaultZoomSetting.key)) {
      windows.applyDefaultZoom(settings.get(DefaultZoomSetting));
    }
    if (keys.some((key) => shellSettings.has(key))) windows.refreshShells();
    // Optional lists that were turned on load at once, so the next page has them.
    if (
      blocker.status === 'ready' &&
      keys.some(
        (key) => key === BlockerCookieNoticesSetting.key || key === BlockerAnnoyancesSetting.key,
      )
    ) {
      void blocker.loadExtras();
    }
  });

  router.handle(GetBlockerStatus, async () => {
    if (settings.get(ContentBlockerSetting)) await blocker.load();
    return { status: blocker.status };
  });

  // The first start of a profile opens the setup guide instead of a new tab page.
  const showSetup = shouldShowSetupGuide({
    shown: settings.get(SetupShownSetting),
    policy: policies.mandatoryValue(SetupGuideEnabled),
    noFirstRun: app.commandLine.hasSwitch('no-first-run'),
  });
  if (showSetup) {
    settings.set(SetupShownSetting, true);
  }
  // A restart from the settings page brings the tabs back, whatever the startup setting says.
  const startup = settings.get(StartupSetting);
  const lastSession =
    !showSetup && (startup === 'restore' || app.commandLine.hasSwitch(restoreSessionSwitch))
      ? parseSession(await savedSession)
      : undefined;
  // The pages of the settings open like a session: in one window, and only the first loads.
  const startPages = startup === 'pages' && !showSetup ? settings.get(StartupPagesSetting) : [];
  const startSession =
    lastSession ??
    (startPages.length === 0
      ? undefined
      : {
          version: 1 as const,
          windows: [{ tabs: startPages.map((url) => ({ url, title: url })), active: 0 }],
        });
  // Links from other apps open in tabs; a start without a session or the guide shows only them.
  const startLinks = [...linksFromArguments(process.argv.slice(1)), ...pendingLinks.splice(0)];
  const first =
    startSession === undefined
      ? windows.open(showSetup ? pageUrl('setup') : startLinks.shift())
      : windows.restore(startSession);
  // Later links open in the window used last, which comes to the front, also without links;
  // without a window, the first link opens one.
  openLinks = (links) => {
    const [link, ...more] = links;
    // Links from other apps never open in private windows.
    const used = windows.lastUsedOf(false);
    const target = used ?? windows.open(link);
    if (used !== undefined && link !== undefined) target.tabs.open(link);
    for (const url of more) target.tabs.open(url);
    if (!target.window.isDestroyed()) target.window.focus();
  };
  if (startLinks.length > 0) openLinks(startLinks);
  // The session follows every change of tabs and windows; an empty one, after the last window
  // closed, is not kept, so the next start restores that window.
  const keepSession = (): void => {
    const snapshot = windows.snapshot();
    if (snapshot.windows.length > 0) sessionStore.schedule(snapshot);
  };
  windows.onDidChange(keepSession);
  windows.onDidMove(keepSession);
  marks['window'] = Math.round(performance.now());
  // A start counts as healthy after 10 s with a loaded shell, or when it quits normally.
  first.shellContents.once('did-finish-load', () => {
    shellLoaded = true;
    setTimeout(() => boot.guard.markHealthy(app.getVersion()), 10_000).unref();
  });
  if (smokeTest !== undefined) {
    // Loaded long before; the shell cannot finish loading while this continues.
    const { runSmokeTest } = await smokeTest;
    runSmokeTest(first, smokeReport, {
      keepRunning: app.commandLine.hasSwitch('smoke-test-keep-running'),
      marks,
      timeOrigin,
    });
  }
  logger.info('First window opened', { ms: Math.round(process.uptime() * 1000) });
  if (process.platform === 'darwin') {
    void import('./browser-menu.ts')
      .then(({ macMenuBar, runFromMenuBar }) =>
        Menu.setApplicationMenu(
          macMenuBar((command) => runFromMenuBar(windows, command, openPrivateWindow)),
        ),
      )
      .catch((error: unknown) => logger.error('The menu bar failed', error));
  }

  // Everything that is not needed for the first window loads after its shell.
  let updates: UpdateService | undefined;
  first.shellContents.once('did-finish-load', () => {
    void import('./updates.ts')
      .then(({ createUpdateService }) => {
        updates = createUpdateService({ policies, clock, logger, userData, boot });
        updates.start();
      })
      .catch((error: unknown) => logger.error('The update service failed to start', error));
  });

  const timer = setInterval(() => void policies.refresh(), 15 * 60 * 1000);
  timer.unref();

  app.on('activate', () => {
    if (windows.all.length === 0) windows.open();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    logger.info('Shutting down');
    if (shellLoaded) boot.guard.markHealthy(app.getVersion());
    // The code that shuts the browser down loads when it quits.
    void import('./shutdown.ts')
      .then(({ shutDown }) =>
        shutDown({
          logger,
          clock,
          settings: store,
          sessions: sessionStore,
          windows,
          web: session.fromPartition(webPartition),
          data,
          updates,
        }),
      )
      .catch((error: unknown) => logger.error('The shutdown failed', error))
      // Everything is saved and every window is closed at this point, or saving failed.
      .finally(() => app.exit(0));
  });
}

/** The searches of the address bar and the new tab page, besides the default engine. */
interface SearchSettings extends SearchShortcuts {
  readonly engines: readonly CustomSearchEngine[];
  readonly bangs: boolean;
}

function registerShellHandlers(
  router: IpcRouter,
  windows: WindowManager,
  searchTemplate: () => Promise<string>,
  searchShortcuts: () => Promise<SearchSettings>,
): void {
  const windowOf = (sender: Electron.WebContents): BrowserWindowController => {
    const window = windows.forShell(sender);
    if (window === undefined) {
      throw new Error('No window for this shell');
    }
    return window;
  };
  const target = (input: string): Promise<string | undefined> =>
    resolveInput(input, searchTemplate, searchShortcuts);
  router.handle(GetShellState, (_request, { sender }) => windowOf(sender).state());
  router.handle(OpenTab, async ({ input }, { sender }) => {
    const url = input === undefined ? undefined : await target(input);
    return { tabId: windowOf(sender).tabs.open(url) };
  });
  router.handle(
    ActivateTab,
    ({ tabId }, { sender }) => (windowOf(sender).tabs.activate(tabId), null),
  );
  router.handle(CloseTab, ({ tabId }, { sender }) => (windowOf(sender).tabs.close(tabId), null));
  router.handle(NavigateTab, async ({ tabId, input }, { sender }) => {
    const url = await target(input);
    if (url !== undefined) windowOf(sender).tabs.navigate(tabId, url);
    return null;
  });
  router.handle(TabAction, ({ tabId, action }, { sender }) => {
    if (action === 'home') windowOf(sender).goHome(tabId);
    else windowOf(sender).tabs.run(tabId, action);
    return null;
  });
  router.handle(SetShellInsets, (insets, { sender }) => (windowOf(sender).setInsets(insets), null));
}

function registerNewTabHandlers(
  router: IpcRouter,
  windows: WindowManager,
  newTabState: () => Promise<NewTabState>,
  searchTemplate: () => Promise<string>,
  searchShortcuts: () => Promise<SearchSettings>,
): void {
  router.handle(GetNewTabState, () => newTabState());
  router.handle(NavigateFromNewTab, async ({ input }, { sender }) => {
    const window = windows.forTab(sender);
    const tabId = window?.tabIdOf(sender);
    const url = await resolveInput(input, searchTemplate, searchShortcuts);
    if (window !== undefined && tabId !== undefined && url !== undefined) {
      window.tabs.navigate(tabId, url);
    }
    return null;
  });
}

/**
 * The address that the text of an address bar or of the search field of the new tab page
 * leads to. Its parser loads with the first text, not before the first window.
 * @param input - The text.
 * @param searchTemplate - The address of the search engine.
 * @param searchShortcuts - The engines of keywords, and whether `!bangs` work.
 */
async function resolveInput(
  input: string,
  searchTemplate: () => Promise<string>,
  searchShortcuts: () => Promise<SearchShortcuts>,
): Promise<string | undefined> {
  const { resolveOmniboxInput } = await import('../domain/navigation/omnibox.ts');
  return resolveOmniboxInput(input, await searchTemplate(), await searchShortcuts())?.url;
}

/**
 * The first menu bar of macOS, until the full one loads. It has no View menu: the roles of
 * that menu act on the focused view, the browser's own ones too, and ignore the policies.
 */
function macMenu(): Electron.MenuItemConstructorOptions[] {
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}
