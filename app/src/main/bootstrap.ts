import { addFeatures, cookiesBlockedAtStart, thirdPartyCookieFeature } from './cookie-blocking.ts';
import { newTabBackgroundRoute } from '../platform/electron/app-protocol-routes.ts';
import {
  paletteCommands,
  pictureInPictureCommands,
  readerCommands,
  shortcutTable,
  splitCommands,
  workspaceCommands,
  type WindowCommand,
} from '../shared/shortcuts.ts';
import { defaultWorkspaceId, workspacePartition, type Workspace } from '../shared/workspaces.ts';
import type { ShortcutRecorder } from '../platform/electron/shortcut-recorder.ts';
import { hostResolverOptions } from '../shared/secure-dns.ts';
import { app, Menu, session, webContents, type Session } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { brand } from '../shared/brand.ts';
import { languageArguments, localeArguments } from '../shared/ui-language.ts';
import { sameZoom } from '../shared/zoom.ts';
import { inOrder } from '../shared/in-order.ts';
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
import type { OmniboxTarget, SearchShortcuts } from '../domain/navigation/omnibox.ts';
import type { CustomSearchEngine } from '../shared/search-engines.ts';
import { linksFromArguments, restoreSessionSwitch } from '../domain/navigation/links.ts';
import { blockingFor, siteOf, type Blocking } from '../domain/blocker/blocking.ts';
import { webFontPreferences } from '../domain/appearance/appearance.ts';
import {
  parseSession,
  restoredWindows,
  sessionStart,
  type SessionSnapshot,
} from '../domain/session/session.ts';
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
  type PaletteOpening,
} from '../platform/electron/browser-window.ts';
import { IpcGate } from '../platform/electron/ipc-gate.ts';
import type { TabActivity } from '../platform/electron/tab-activity.ts';
import { IpcRouter } from '../platform/electron/ipc-router.ts';
import { attachLater } from '../platform/electron/pipeline-later.ts';
import { answerWithChromium } from '../platform/electron/certificate-verify.ts';
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
  BookmarksBarSetting,
  DownloadFolderSetting,
  WorkspacesEnabledSetting,
  WorkspacesRemovedSetting,
  WorkspacesSetting,
  HomeButtonSetting,
  HomePageSetting,
  SecureDnsSetting,
  SecureDnsTemplatesSetting,
  ShortcutsSetting,
  AltOpensMenuSetting,
  CommandPaletteSetting,
  SplitViewSetting,
  ReaderEnabledSetting,
  PictureInPictureEnabledSetting,
  BlockThirdPartyCookiesSetting,
  NewTabClockSetting,
  NewTabSearchSetting,
  NewTabTilesSetting,
  NewTabMostVisitedSetting,
  NewTabBackgroundSetting,
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
  TabStripPositionSetting,
  TitleBarSetting,
  DensitySetting,
  ToolbarItemsSetting,
  ToolbarPlacementSetting,
  ToolbarAutoHideSetting,
  coreSettings,
} from './core-settings.ts';
import { AppearanceController } from './appearance.ts';
import { chooseLanguage } from './ui-language.ts';
import type { Bookmarks } from './bookmarks.ts';
import type { Workspaces } from './workspaces.ts';
import type { ReaderController } from './reader.ts';
import type { PictureInPictureController } from './picture-in-picture.ts';
import {
  canBeDefaultBrowser,
  DefaultBrowserSettingEnabled,
} from '../domain/default-browser/default-browser.ts';
import { ImportEnabled } from '../domain/import/import.ts';
import { SSLErrorOverrideAllowed } from '../domain/certificates/certificates.ts';
import { DeveloperToolsAvailability } from '../domain/page-tools/page-tools.ts';
import { PrivateModeAvailability } from '../domain/windows/private-windows.ts';
import type { DataClient, DataServiceClient } from '../platform/electron/data-service-client.ts';
import type { WebRequests } from './web-requests.ts';
import type { Downloads } from './downloads.ts';
import { GetBlockerStatus } from '../shared/ipc/blocker-contracts.ts';
import { checkBoot } from './boot.ts';
import { toolbarBackground, windowBackground } from './window-background.ts';
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
  /** Folder of the scripts that the browser runs in web pages, such as the reader view's. */
  readonly pageScripts: string;
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
  // What the pages of tabs do that keeps them awake loads with the code for web pages, before
  // the first web page loads, and with the timer of sleeping tabs: no page can be busy before.
  let activity: TabActivity | undefined;
  const loadActivity = (): Promise<TabActivity> =>
    import('../platform/electron/tab-activity.ts').then(
      ({ TabActivity: Activity }) => (activity ??= new Activity(() => clock.wallTime())),
    );
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
  // An error that no code catches goes to the log. Electron would show it in a box that stops
  // the browser process, which then neither answers nor quits until someone closes the box.
  process.on('uncaughtException', (error) => {
    logger.error('An error in the browser process was not caught', error);
  });
  // A promise that fails without a handler only warns on the console, which nobody reads.
  process.on('unhandledRejection', (reason) => {
    logger.error('A promise of the browser process failed and no code handled it', reason);
  });
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
  // Chromium blocks third-party cookies itself, in every frame and worker, only with a
  // feature that it reads as it starts, so the setting takes full effect at the next start.
  // Until then, and in private windows without it, the request pipeline and the frames keep
  // them away as well as they can.
  const nativeCookieBlocking = cookiesBlockedAtStart({
    settingsFile: join(userData, 'settings.json'),
    key: BlockThirdPartyCookiesSetting.key,
    mandatory: policies.getMandatory('BlockThirdPartyCookies')?.value,
    recommended: policies.getRecommended('BlockThirdPartyCookies')?.value,
    fallback: BlockThirdPartyCookiesSetting.default,
  });
  if (nativeCookieBlocking)
    addFeatures(app.commandLine, 'enable-features', thirdPartyCookieFeature);
  // The browser has no push service and cannot place windows of Document Picture-in-Picture:
  // sites see both as missing and fall back, rather than offer what cannot work.
  addFeatures(
    app.commandLine,
    'disable-blink-features',
    'DocumentPictureInPictureAPI,PushMessaging',
  );

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
  // The browser's own views get the language of the settings and the locale of the system.
  const viewArguments = [...languageArguments(language), ...localeArguments(app.getSystemLocale())];
  const definitions: readonly SettingDefinition<unknown>[] = coreSettings;
  const startValues = new Map(
    definitions
      .filter((definition) => definition.restartRequired === true)
      .map((definition) => [definition.key, JSON.stringify(settings.get(definition))]),
  );
  // The background image of the new tab page lives in the profile; its folder exists from
  // the start, so the route that serves it has a place to look.
  const newTabFolder = join(userData, 'newtab');
  mkdirSync(newTabFolder, { recursive: true });
  const protocolHandler = new AppProtocol(
    layout.rendererDir,
    new Set(['shell', 'overlay', 'sandbox-help', ...tabPages]),
    [newTabBackgroundRoute(newTabFolder)],
  );
  const internal = session.fromPartition(internalPartition);
  protocolHandler.serve(internal);
  hardenSession(internal);
  // The navigations of the browser's own pages wait for the network service, those to `app://`
  // too, and one whose answer the service never gives, or took with it when it went away, never
  // ends. A main-frame navigation of the internal session that still waits after 10 s hands
  // over to the code that starts it again, which loads only then.
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session !== internal) return;
    let latest: unknown;
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      latest = details;
      setTimeout(() => {
        if (latest === details && !contents.isDestroyed() && contents.isWaitingForResponse()) {
          void import('../platform/electron/network-service.ts').then((module) =>
            module.watch(contents, details.url, () => latest === details, logger),
          );
        }
      }, 10_000);
    });
  });
  // The data service, and the code that talks to it, start with the first call.
  let dataClient: Promise<DataServiceClient> | undefined;
  let startedClient: DataServiceClient | undefined;
  const data: DataClient & { settled(): Promise<void> } = {
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
    settled: () => dataClient?.then((client) => client.settled()) ?? Promise.resolve(),
  };
  // The keyboard shortcuts of the windows, made again when people change them. While the
  // command palette, split view, the workspaces, the reader view or picture in picture are off,
  // their shortcuts reach the pages.
  const shortcutsNow = (): Map<string, WindowCommand> =>
    shortcutTable(process.platform, settings.get(ShortcutsSetting), [
      ...(settings.get(CommandPaletteSetting) ? [] : paletteCommands),
      ...(settings.get(SplitViewSetting) ? [] : splitCommands),
      ...(settings.get(WorkspacesEnabledSetting) ? [] : workspaceCommands),
      ...(settings.get(ReaderEnabledSetting) ? [] : readerCommands),
      ...(settings.get(PictureInPictureEnabledSetting) ? [] : pictureInPictureCommands),
    ]);
  let shortcuts = shortcutsNow();
  // The editor of shortcuts on the settings page waits for key presses with a recorder that
  // loads with the handlers of the browser's own pages, before the settings page.
  let shortcutRecorder: ShortcutRecorder | undefined;
  // Every request of web content passes the request pipeline: HTTPS-First, the third-party
  // cookies and the content blocker, whose engine loads with the first web page. Their code,
  // with the exceptions for certificates and the answers to the frames of web pages, loads
  // with the first request or frame of a web page; requests and frames that come meanwhile
  // wait for it. A start that shows only the browser's own pages loads none of it.
  let web: WebRequests | undefined;
  let webLoaded: Promise<WebRequests> | undefined;
  let webFailed = false;
  const loadWeb = (): Promise<WebRequests> => {
    webLoaded ??= import('./web-requests.ts').then(
      ({ webRequests }) =>
        (web = webRequests({
          app,
          settings,
          blockerDir: layout.blockerDir,
          nativeCookieBlocking,
          isPrivate: (s) => privateSessions.has(s),
          isWebSession: (s) => webSessions.has(s),
          blocking,
          onBlocked: (contentsId) => windows.countBlocked(contentsId),
          onStatus: () => windows.refreshShells(),
          certificateOverride: () => policies.mandatoryValue(SSLErrorOverrideAllowed) !== false,
          windows,
          router,
          overlay: overlayOptions,
          downloadFolder,
          downloads: loadDownloads,
          activity: () => activity,
          webSessions,
          framePreload: layout.framePreload,
          readerPageOf: (contents) => reader?.pageOf(contents),
          logger,
        })),
      (error: unknown) => {
        webFailed = true;
        logger.error('The code for the requests of web pages did not load', error);
        windows.refreshShells();
        throw error;
      },
    );
    return webLoaded;
  };
  // A blocker without filter data shows that it fails where it should block.
  const blocking = (url: string): Blocking => {
    const value = blockingFor(
      url,
      settings.get(ContentBlockerSetting),
      settings.get(BlockerAllowedSitesSetting),
    );
    return value === 'on' && (webFailed || web?.blocker.status === 'failed') ? 'failed' : value;
  };
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
  const webSessions = new Set<Session>();
  // The sessions of private windows: a new one after the last private window closed.
  const privateSessions = new WeakSet<Session>();
  // A session's pages get the answers of their kind of window, which the code for the requests
  // of web pages gives: it loads before the first web page, which could ask or check.
  const permissionsOf = (s: Session): PermissionHandler => ({
    request: (contents, permission, mediaTypes, requestingUrl) =>
      loadWeb().then(
        (loaded) => loaded.permissions(s).request(contents, permission, mediaTypes, requestingUrl),
        () => false,
      ),
    check: (contents, permission, origin, details) =>
      web?.permissions(s).check(contents, permission, origin, details) === true,
    shareScreen: (request, callback) =>
      void loadWeb().then(
        (loaded) => loaded.permissions(s).shareScreen(request, callback),
        () => callback(null),
      ),
  });
  const protectWebSession = (s: Session): void => {
    if (s !== internal && !webSessions.has(s)) {
      webSessions.add(s);
      protocolHandler.refuse(s);
      serveResources(s, (name) => web?.blocker.resource(name));
      hardenSession(s, permissionsOf(s));
      // A page that downloads stays awake; a download that the list started again has none.
      // Downloads come from requests of web pages, after their code loaded.
      s.on('will-download', (_event, item, contents: Electron.WebContents | null) => {
        web?.saveDownload(item, s);
        activity?.downloading(contents, item);
      });
      attachLater(s, () => loadWeb().then((loaded) => loaded.pipeline));
      // Chromium decides about every certificate; site information notes what it checked. The
      // checks come with requests of web pages, which wait for the code that keeps the notes.
      answerWithChromium(s, (request) => web?.certificateLog.record(s, request));
      // The code for the requests of web pages gives the frame preload to the sessions made
      // before it as it loads, and to the others here.
      web?.protect(s);
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
    downloads?.forgetPrivate();
    if (ended === undefined) return;
    // Electron keeps the session until the browser quits; what the code for the requests of web
    // pages noted for it goes now.
    web?.forget(ended);
    // The icons of the private pages go with their session.
    import('../platform/electron/favicons.ts').then(
      ({ favicons }) => favicons.forget(ended),
      (error: unknown) => logger.warn('Private icons were not deleted', { error: String(error) }),
    );
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
    const { startSandboxHelp } = await import('./sandbox-help.ts');
    await startSandboxHelp({
      preload: layout.pagePreload,
      partition: internalPartition,
      gate,
      router,
      logger,
      languageArguments: viewArguments,
    });
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
    const window = windows.forTab(opener);
    if (mayOpenInNewTab(url)) window?.tabs.open(url, { activate, opener: window.tabIdOf(opener) });
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
          pictureInPictureEnabled: () => settings.get(PictureInPictureEnabledSetting),
          pictureInPicture: ({ window, tabId, contents, params }, enter) => {
            if (tabId === undefined) return;
            const { frame, x, y, srcURL: src, pageURL: page } = params;
            const menu = { frame, x, y, src, page };
            loadPictureInPicture()
              .then((controller) => controller.atPoint(window, tabId, contents, { ...menu, enter }))
              .catch(failedPictureInPicture);
          },
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
  // The address bar and the command palette find pages in the same places.
  const pageSources = {
    target: async (text: string): Promise<OmniboxTarget | undefined> => {
      const { resolveOmniboxInput } = await import('../domain/navigation/omnibox.ts');
      return resolveOmniboxInput(text, await searchTemplate(), await searchShortcuts());
    },
    history: async (text: string, limit: number): Promise<{ title: string; url: string }[]> =>
      (await data.call('history', text, limit)).map(({ title, url }) => ({ title, url })),
    bookmarks: async (): Promise<{ title: string; url: string }[]> =>
      (await loadBookmarks()).loadedPages(),
  };
  // The command palette loads with its first shortcut; the keys typed meanwhile wait for it.
  const openPalette = (window: BrowserWindowController, scope: PaletteOpening): void => {
    if (!settings.get(CommandPaletteSetting)) return;
    window.holdTyping();
    // The palette asks the window with its commands which of them can run.
    Promise.all([import('./palette.ts'), windows.laterCode()])
      .then(([{ openPalette: open }]) =>
        open(window, scope, {
          windows,
          router,
          overlay: overlayOptions,
          newTabUrl,
          workspaces: workspacesNow,
          ...pageSources,
          absent: coreSettings.flatMap((definition) =>
            definition.ui === undefined ? [definition.key] : [],
          ),
        }),
      )
      .catch((error: unknown) => {
        window.releaseTyping();
        logger.error('The command palette failed', error);
      });
  };
  // The reader view loads with the first web page that has loaded in the active tab while it is
  // on, or with its command.
  let reader: ReaderController | undefined;
  let readerLoaded: Promise<ReaderController> | undefined;
  const loadReader = (): Promise<ReaderController> =>
    (readerLoaded ??= import('./reader.ts').then(
      ({ ReaderController: Controller }) =>
        (reader = new Controller({ windows, settings, scripts: layout.pageScripts, logger })),
    ));
  // Picture in picture loads with the first video that plays or pauses while it is on, once it
  // is turned on, with its command or the context menu of a video, or before a tab goes to sleep.
  let pictureInPicture: PictureInPictureController | undefined;
  let pictureInPictureLoaded: Promise<PictureInPictureController> | undefined;
  const loadPictureInPicture = (): Promise<PictureInPictureController> =>
    (pictureInPictureLoaded ??= import('./picture-in-picture.ts').then(
      ({ PictureInPictureController: Controller }) =>
        (pictureInPicture = new Controller({
          windows,
          settings,
          scripts: layout.pageScripts,
          activity: () => activity,
          logger,
        })),
    ));
  const failedPictureInPicture = (error: unknown): void =>
    logger.error('Picture in picture failed', error);
  // A page may show a video in picture in picture that it started itself, which keeps its tab
  // awake: picture in picture looks at the pages of tabs before they go to sleep, also while it
  // is off, as the page did that, not the browser.
  const beforeSleep = async (
    window: BrowserWindowController,
    ids: readonly string[],
  ): Promise<void> => (await loadPictureInPicture()).beforeSleep(window, ids);
  // The workspaces of the profile while windows have them; their code loads with its first use.
  const workspacesNow = (): readonly Workspace[] | undefined =>
    settings.get(WorkspacesEnabledSetting) ? settings.get(WorkspacesSetting) : undefined;
  const loadWorkspaces = (): Promise<Workspaces> =>
    import('./workspaces.ts').then(({ workspaces: code }) =>
      code({ windows, router, overlay: overlayOptions, settings, logger, webPartition, userData }),
    );
  const appearance = await AppearanceController.create(settings, router, internal, () =>
    windows.repaintBackgrounds(),
  );
  const titleBarAtStart = settings.get(TitleBarSetting);
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
    toolbarColor: toolbarBackground,
    appearanceArgument: () => appearance.argument,
    languageArguments: viewArguments,
    webFonts: () =>
      webFontPreferences(settings.get(WebFontsSetting), settings.get(WebTextSizeSetting)),
    homeButton: () => settings.get(HomeButtonSetting),
    defaultZoom: () => settings.get(DefaultZoomSetting),
    homePage: () => settings.get(HomePageSetting),
    tabStripPosition: () => settings.get(TabStripPositionSetting),
    toolbarPlacement: () => settings.get(ToolbarPlacementSetting),
    // The tabs and the toolbar that hide until they are needed, whose code loads while they do.
    autoHideToolbar: () => settings.inspect(ToolbarAutoHideSetting),
    toggleAutoHideToolbar: () =>
      void settings.set(ToolbarAutoHideSetting, !settings.get(ToolbarAutoHideSetting)),
    hidingRows: () => import('../platform/electron/hiding-rows.ts'),
    // The title bar of a window is fixed when it opens; the setting applies after a restart.
    titleBar: () => ({
      integrated: titleBarAtStart === 'integrated',
      density: settings.get(DensitySetting),
    }),
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
    // A new window shows the workspace of the window that it comes from.
    openWindow: (from) => void windows.open(undefined, { workspace: from.tabs.workspace }),
    openPrivateWindow,
    privateWindows: privateWindowsAllowed,
    developerTools,
    openPalette,
    commandPalette: () => settings.get(CommandPaletteSetting),
    splitView: () => settings.get(SplitViewSetting),
    workspaces: workspacesNow,
    partitionFor: (workspace) =>
      workspacePartition(settings.get(WorkspacesSetting), workspace, webPartition),
    onLaterCommand: (window, command) =>
      void loadWorkspaces().then((code) => code.run(window, command)),
    reader: () => settings.get(ReaderEnabledSetting),
    onPageEvent: (window, tabId, contents, event) => {
      // Picture in picture loads with the first video of a page that plays or pauses; a tab that
      // shows reaches it once it is there.
      if (
        (event === 'media' || event === 'shown') &&
        settings.get(PictureInPictureEnabledSetting)
      ) {
        const code = event === 'media' ? loadPictureInPicture() : pictureInPictureLoaded;
        code
          ?.then((controller) => controller.page(window, tabId, contents, event))
          .catch(failedPictureInPicture);
      }
      if (event === 'media' || !settings.get(ReaderEnabledSetting)) return;
      // The reader view's code loads once a web page has loaded in the active tab: a page that
      // shows while it still loads, as at the start, tells once it has, and one in the
      // background once its tab shows. Until then, there is nothing to check.
      const ready =
        window.tabs.active?.id === tabId &&
        (event === 'loaded' ||
          (!contents.isLoadingMainFrame() && /^https?:/i.test(contents.getURL())));
      const code = ready ? loadReader() : readerLoaded;
      void code?.then((controller) => controller.page(window, tabId, contents, event));
    },
    onReaderCommand: (window, tabId) =>
      void loadReader().then((code) => code.toggle(window, tabId)),
    pictureInPicture: () => settings.get(PictureInPictureEnabledSetting),
    onPictureInPictureCommand: (window, tabId, pressed) =>
      void loadPictureInPicture()
        .then((controller) => controller.toggle(window, tabId, pressed))
        .catch(failedPictureInPicture),
    // The commands of the browser itself: its version, shown in a message, and quitting it.
    onAppCommand: (window, command) => {
      if (command === 'app.quit') {
        app.quit();
        return;
      }
      void import('./browser-menu.ts')
        .then(({ showAbout }) => showAbout(window))
        .catch((error: unknown) => logger.error('The version of the browser was not shown', error));
    },
    // Administrators expect a change of policy to show when they come back to the browser.
    // The focus that the first window gets at start does not read them a second time. Picture
    // in picture looks at its videos again, as its window has no event of its own.
    onFocus: (window) => {
      if (shellLoaded) void policies.refresh();
      pictureInPicture?.focused(window);
    },
    onPrivateWindowsClosed: forgetPrivate,
    holdsPrivateClose: (window) => downloads?.holdsPrivateClose(window) === true,
    // The shortcut shows the downloads button first; the shell opens the list at it.
    showDownloads: (window) =>
      void loadDownloads().then((list) => {
        list.reveal(window.isPrivate);
        window.refreshShell();
        router.publish(ShellCommand, window.shellContents, 'downloads.open');
      }),
    // The handlers of the other internal pages load with the first of them, before it loads.
    prepareInternalPage: (page) => (page === 'newtab' ? undefined : connectPages()),
    // So does the code that follows the views of web pages, with the first web page, with what
    // keeps their tabs awake and the code for their requests, and the commands of the windows
    // that do not move the focus, with the first of them.
    webPages: () =>
      Promise.all([
        import('../platform/electron/web-pages.ts'),
        loadActivity().catch((error: unknown) =>
          logger.error('What keeps tabs awake did not load', error),
        ),
        // The requests of web pages, their downloads and the pages that they open find their
        // code there; it logs itself when it fails.
        loadWeb().catch(() => undefined),
      ]).then(([{ webPages }]) => webPages),
    windowCommands: () =>
      import('../platform/electron/window-commands.ts').then(
        ({ windowCommands }) => windowCommands,
      ),
    gate,
    router,
    logger,
    onContextMenu,
    certificateOverride: () => policies.mandatoryValue(SSLErrorOverrideAllowed) !== false,
    // The pages of a site whose certificate the user accepted after the warning do not count
    // as secure.
    certificateException: (contents, url) => web?.certificates.covers(contents, url) === true,
    insecureAddressFor: (contents, failed, stopped) =>
      web?.httpsFirst.insecureAddressFor(contents, failed, stopped),
    shortcuts: () => shortcuts,
    shortcutRecorder: () => shortcutRecorder,
    altOpensMenu: () => process.platform !== 'darwin' && settings.get(AltOpensMenuSetting),
    onPageCommand: (window, command, contents) =>
      void import('./page-tools.ts').then(({ runPageCommand }) =>
        runPageCommand(window, command, contents, {
          developerTools,
          logger,
          downloadFolder,
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
    activity: () => activity,
    now: () => clock.wallTime(),
  });
  // Not asked for yet, loading, or `true` once the handlers are there.
  let pages: Promise<void> | true | undefined;
  const connectPages = (): Promise<void> | undefined => {
    if (pages === true) return undefined;
    pages ??= Promise.all([
      import('./page-handlers.ts'),
      loadBookmarks(),
      import('../platform/electron/shortcut-recorder.ts'),
    ])
      .then(([{ connectPages: connect }, list, { ShortcutRecorder: Recorder }]) => {
        const recorder = new Recorder();
        shortcutRecorder = recorder;
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
          webPartition,
          // Clearing the whole history also clears the lists that the session files keep.
          forgetTabHistories: async () => {
            windows.forgetTabHistories();
            await sessionStore.forgetHistories();
          },
          newTabFolder,
          shortcuts: {
            table: () => shortcuts,
            overrides: () => settings.get(ShortcutsSetting),
            record: (contents) => recorder.record(contents),
          },
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
    // What a script of a web page opens keeps its opener, and popups that the filter lists
    // name do not open; the code for web pages has loaded before any of them.
    openWindow: (contents, opener, request) => {
      if (web === undefined) contents.close();
      else web.openWindow(contents, opener, request);
    },
    blocksPopup: (url, opener) => web?.blocksPopup(url, opener) === true,
    logger,
  });
  registerShellHandlers(router, windows, searchTemplate, searchShortcuts);
  const overlayOptions = {
    url: 'app://overlay/',
    preload: layout.pagePreload,
    partition: internalPartition,
    appearanceArgument: () => appearance.argument,
    languageArguments: viewArguments,
    gate,
    router,
  };
  // Requests of the shell that its first paint does not need load with the first of them,
  // with the commands of the windows, which their menus ask about the tabs.
  router.handleLater(shellLaterChannels, () =>
    Promise.all([import('./shell-later.ts'), windows.laterCode()]).then(
      ([{ registerLaterShellHandlers }]) =>
        registerLaterShellHandlers({
          router,
          windows,
          logger,
          overlay: overlayOptions,
          openDownloads: (window, anchor) =>
            void loadDownloads().then((list) => list.open(window, anchor)),
          allowCertificate: (contents) => web?.certificates.allow(contents) === true,
          allowInsecure: (contents, address) => web?.httpsFirst.allow(contents, address),
          folderContents: (folder) => bookmarks?.contents(folder) ?? [],
          bookmarks: loadBookmarks,
          workspaces: loadWorkspaces,
          suggestions: {
            overlay: overlayOptions,
            target: pageSources.target,
            history: (text) => pageSources.history(text, 10),
            bookmarks: pageSources.bookmarks,
          },
          beforeSleep,
          openShieldPopover: async (window, anchor) => {
            const { openShieldPopover } = await import('./shield-popover.ts');
            openShieldPopover(window, anchor, {
              windows,
              router,
              overlay: overlayOptions,
              settings,
              blocker: (await loadWeb()).blocker,
              blocking,
            });
          },
          openSiteInfo: async (window, anchor) => {
            const [{ openSiteInfo }, loaded] = await Promise.all([
              import('./site-info.ts'),
              loadWeb(),
            ]);
            await openSiteInfo(window, anchor, {
              windows,
              router,
              overlay: overlayOptions,
              settings,
              blocker: loaded.blocker,
              blocking,
              web: loaded,
              logger,
            });
          },
        }),
    ),
  );
  // What the new tab page shows besides the search engine, as the settings say. A private
  // window shows no sites from the history.
  const newTabState = async (privateWindow: boolean): Promise<NewTabState> => {
    const template = await searchTemplate();
    const custom = (await searchShortcuts()).engines.find((engine) => engine.url === template);
    const tiles = settings.get(NewTabTilesSetting);
    const mostVisited =
      settings.get(NewTabMostVisitedSetting) && !privateWindow
        ? (await data.call('topSites', 24).catch(() => []))
            .filter(
              (site) =>
                /^https?:\/\/\S+$/i.test(site.url) &&
                site.url.length <= 8192 &&
                !tiles.some((tile) => tile.url === site.url),
            )
            .slice(0, 8)
            .map((site) => ({ title: site.title.slice(0, 64), url: site.url }))
        : [];
    // The names of the built-in engines load with the first new tab page.
    const { engineForSearchUrl } = await import('../shared/search-engines.ts');
    return {
      engine: engineForSearchUrl(template)?.name ?? custom?.name ?? null,
      search: settings.get(NewTabSearchSetting),
      clock: settings.get(NewTabClockSetting),
      tiles,
      mostVisited,
      background: settings.get(NewTabBackgroundSetting),
    };
  };
  // Each new tab page gets its states in the order of the changes, so that a state that
  // waited for the history never replaces a newer one that did not.
  const queueNewTab = inOrder();
  const newTabStateOf = (contents: Electron.WebContents): Promise<NewTabState> =>
    queueNewTab(contents, () => newTabState(windows.forTab(contents)?.isPrivate ?? false));
  registerNewTabHandlers(router, windows, newTabStateOf, searchTemplate, searchShortcuts);
  // Electron starts without DNS over HTTPS, whatever its documentation says, so the browser
  // sets the mode of the host resolver itself, at the start and when the settings change.
  // Addresses that Chromium refuses must stop neither the start nor the saving of settings;
  // the provider of the system applies instead.
  const applySecureDns = (): void => {
    try {
      app.configureHostResolver(
        hostResolverOptions(
          settings.get(SecureDnsSetting),
          settings.get(SecureDnsTemplatesSetting),
        ),
      );
    } catch (error) {
      logger.warn('The addresses for secure DNS were refused; the system provider applies', {
        error: String(error),
      });
      app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: [] });
    }
  };
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
    NewTabMostVisitedSetting.key,
    NewTabBackgroundSetting.key,
    SearchUrlTemplate.key,
    SearchEnginesSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
    if (!keys.some((key) => newTabKeys.has(key))) return;
    for (const contents of webContents.getAllWebContents()) {
      if (contents.session === internal && contents.getURL().startsWith(newTabUrl)) {
        void newTabStateOf(contents).then((state) => {
          if (!contents.isDestroyed()) router.publish(NewTabChanged, contents, state);
        });
      }
    }
  });
  // The density and the place of the toolbar set the height of the top row, which the window
  // controls share.
  const shellSettings = new Set([
    BookmarksBarSetting.key,
    HomeButtonSetting.key,
    DefaultZoomSetting.key,
    ToolbarItemsSetting.key,
    TabStripPositionSetting.key,
    ToolbarPlacementSetting.key,
    ToolbarAutoHideSetting.key,
    DensitySetting.key,
    ContentBlockerSetting.key,
    BlockerAllowedSitesSetting.key,
    WorkspacesSetting.key,
    WorkspacesEnabledSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
    if (keys.includes(DefaultZoomSetting.key)) {
      windows.applyDefaultZoom(settings.get(DefaultZoomSetting));
    }
    if (keys.some((key) => shellSettings.has(key))) windows.refreshShells();
    // The code of the workspaces follows their changes from its first use on and applies what
    // changed before as it loads, so a window with tabs in another workspace loads it at once,
    // as when a policy turns the workspaces off.
    if (
      (keys.includes(WorkspacesSetting.key) || keys.includes(WorkspacesEnabledSetting.key)) &&
      windows.all.some(
        ({ tabs }) => tabs.strips.length > 1 || tabs.workspace !== defaultWorkspaceId,
      )
    ) {
      void loadWorkspaces();
    }
    // Optional lists that were turned on load at once, so the next page has them.
    if (
      web?.blocker.status === 'ready' &&
      keys.some(
        (key) => key === BlockerCookieNoticesSetting.key || key === BlockerAnnoyancesSetting.key,
      )
    ) {
      void web.blocker.loadExtras();
    }
  });

  router.handle(GetBlockerStatus, async () => {
    if (!settings.get(ContentBlockerSetting)) return { status: web?.blocker.status ?? 'idle' };
    // Asking loads the filter data, and the code that works with it first.
    const loaded = await loadWeb().catch(() => undefined);
    await loaded?.blocker.load();
    return { status: loaded?.blocker.status ?? 'failed' };
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
  // A restart from the settings page brings the tabs back, whatever the startup setting says,
  // and so does a start after the browser did not quit normally, as after a crash, unless a
  // mandatory policy sets what the browser opens at start.
  const startup = settings.inspect(StartupSetting);
  const stored = await savedSession;
  const restores = sessionStart(startup, {
    restart: app.commandLine.hasSwitch(restoreSessionSwitch),
    unclean: stored.unclean,
    setup: showSetup,
  });
  // Only a start that restores the session parses its file.
  const lastSession = restores === undefined ? undefined : parseSession(await stored.data());
  if (restores === 'crash' && lastSession !== undefined) {
    logger.info('The browser did not quit normally; the last session comes back', {
      windows: lastSession.windows.length,
      tabs: lastSession.windows.reduce((sum, window) => sum + window.tabs.length, 0),
    });
  }
  // The pages of the settings open like a session: in one window, and only the first loads.
  const startPages =
    startup.value === 'pages' && !showSetup ? settings.get(StartupPagesSetting) : [];
  const startWindows =
    lastSession === undefined
      ? startPages.length === 0
        ? undefined
        : [{ tabs: startPages.map((url) => ({ url, title: url })), active: 0, place: {} }]
      : restoredWindows(lastSession);
  // Links from other apps open in tabs; a start without a session or the guide shows only them.
  const startLinks = [...linksFromArguments(process.argv.slice(1)), ...pendingLinks.splice(0)];
  // The code of groups of tabs loads only for a session that has groups, and that of workspaces
  // only for a session that has workspaces.
  const regroup = lastSession?.windows.some((window) => window.tabs.some((tab) => tab.group))
    ? (await import('../domain/tabs/tab-groups.ts')).restoreGroups
    : undefined;
  const respace = lastSession?.windows.some(
    (window) => window.workspace !== undefined || window.tabs.some((tab) => tab.workspace),
  )
    ? (await import('../domain/tabs/workspace-strips.ts')).workspaceRestore(
        (workspacesNow() ?? []).map(({ id }) => id),
      )
    : undefined;
  const first =
    startWindows === undefined
      ? windows.open(showSetup ? pageUrl('setup') : startLinks.shift())
      : windows.restore(startWindows, regroup, respace);
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
  const takeSession = (): SessionSnapshot | undefined => {
    const snapshot = windows.snapshot();
    return snapshot.windows.length > 0 ? snapshot : undefined;
  };
  const keepSession = (): void => {
    const snapshot = takeSession();
    if (snapshot !== undefined) sessionStore.schedule(snapshot);
  };
  // A count of blocked requests or a page that loads does not build the session again, and a
  // new title alone, as of a page that counts down, builds and writes it only later.
  windows.onDidChangeKept(({ titleOnly }) => {
    if (titleOnly) sessionStore.scheduleLater(takeSession);
    else keepSession();
  });
  windows.onDidMove(keepSession);
  marks['window'] = Math.round(performance.now());
  // A start counts as healthy after 10 s with a loaded shell, or when it quits normally. From
  // the first shell on, the browser marks that it runs, until it quits normally.
  first.shellContents.once('did-finish-load', () => {
    shellLoaded = true;
    setTimeout(() => boot.guard.markHealthy(app.getVersion()), 10_000).unref();
    sessionStore
      .markRunning()
      .catch((error: unknown) =>
        logger.debug('The browser could not mark that it runs', { error: String(error) }),
      );
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
  // The menu bar of macOS shows the shortcuts, so it is made again when they change.
  const showMenuBar = (): void => {
    if (process.platform !== 'darwin') return;
    void import('./browser-menu.ts')
      .then(({ macMenuBar, runFromMenuBar }) =>
        Menu.setApplicationMenu(
          macMenuBar((command) => runFromMenuBar(windows, command, openPrivateWindow), shortcuts, {
            palette: settings.get(CommandPaletteSetting),
            splitView: settings.get(SplitViewSetting),
            reader: settings.get(ReaderEnabledSetting),
            pictureInPicture: settings.get(PictureInPictureEnabledSetting),
          }),
        ),
      )
      .catch((error: unknown) => logger.error('The menu bar failed', error));
  };
  showMenuBar();
  // The command palette and split view turn on and off at once: their shortcuts and the items
  // of the menus. Split view turned off ends the split views that show.
  const keyedSettings = new Set([
    ShortcutsSetting.key,
    CommandPaletteSetting.key,
    SplitViewSetting.key,
    WorkspacesEnabledSetting.key,
    ReaderEnabledSetting.key,
    PictureInPictureEnabledSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
    if (!keys.some((key) => keyedSettings.has(key))) return;
    if (keys.includes(SplitViewSetting.key) && !settings.get(SplitViewSetting)) {
      windows.endSplits();
    }
    // The reader view checks the pages that show once it is on, and picture in picture looks
    // at their videos; both turn themselves off.
    if (keys.includes(ReaderEnabledSetting.key) && settings.get(ReaderEnabledSetting)) {
      void loadReader();
    }
    if (
      keys.includes(PictureInPictureEnabledSetting.key) &&
      settings.get(PictureInPictureEnabledSetting)
    ) {
      loadPictureInPicture().catch(failedPictureInPicture);
    }
    shortcuts = shortcutsNow();
    showMenuBar();
  });

  // Everything that is not needed for the first window loads after its shell, such as the
  // updates and what puts tabs to sleep that were not used for a while.
  let updates: UpdateService | undefined;
  first.shellContents.once('did-finish-load', () => {
    void import('./updates.ts')
      .then(({ createUpdateService }) => {
        updates = createUpdateService({ policies, clock, logger, userData, boot });
        updates.start();
      })
      .catch((error: unknown) => logger.error('The update service failed to start', error));
    // The timer asks the windows about their tabs with their commands, which load meanwhile.
    void Promise.all([import('./tab-sleep.ts'), loadActivity(), windows.laterCode()])
      .then(([{ startTabSleeper }, loaded]) =>
        startTabSleeper({
          windows,
          settings,
          activity: loaded,
          beforeSleep,
          clock,
          logger: logger.child('sleep'),
        }),
      )
      .catch((error: unknown) => logger.error('Tabs do not go to sleep by themselves', error));
    // The folders of deleted workspaces go once Chromium of the last run let go of them.
    if (settings.get(WorkspacesRemovedSetting).length > 0) {
      void loadWorkspaces().then((code) => code.removeDeletedPartitions());
    }
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
          web: webSessions,
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
    return { tabId: windowOf(sender).openTab(url) };
  });
  router.handle(
    ActivateTab,
    ({ tabId }, { sender }) => (windowOf(sender).tabs.activate(tabId), null),
  );
  // People close the tab, whose page may ask to stay first.
  router.handle(
    CloseTab,
    ({ tabId }, { sender }) => (windowOf(sender).tabAction(tabId, 'close'), null),
  );
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
  newTabState: (contents: Electron.WebContents) => Promise<NewTabState>,
  searchTemplate: () => Promise<string>,
  searchShortcuts: () => Promise<SearchSettings>,
): void {
  router.handle(GetNewTabState, (_request, { sender }) => newTabState(sender));
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
