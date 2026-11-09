import { app, Menu, session, type Session } from 'electron';
import { join } from 'node:path';
import { brand } from '../shared/brand.ts';
import { newTabUrl, pageUrl, tabPages } from '../shared/internal-pages.ts';
import { GetNewTabState, NavigateFromNewTab } from '../shared/ipc/newtab-contracts.ts';
import {
  ActivateTab,
  CloseTab,
  GetShellState,
  OpenBlockerPopover,
  ProceedUnsafely,
  FindInPage,
  StopFinding,
  ResetZoom,
  OpenBookmarkFolder,
  ToggleBookmark,
  OpenMenu,
  NavigateTab,
  OpenTab,
  ReopenClosedTab,
  SetShellInsets,
  TabAction,
} from '../shared/ipc/shell-contracts.ts';
import { Lifecycle } from '../kernel/lifecycle/lifecycle.ts';
import {
  FanOutLogSink,
  RingBufferLogSink,
  SinkLogger,
  type Logger,
} from '../kernel/logging/logger.ts';
import { mayOpenInNewTab } from '../domain/navigation/new-tab.ts';
import { linksFromArguments } from '../domain/navigation/links.ts';
import { resolveOmniboxInput } from '../domain/navigation/omnibox.ts';
import { engineForSearchUrl } from '../shared/search-engines.ts';
import { blockingFor, siteOf, type Blocking } from '../domain/blocker/blocking.ts';
import { parseSession } from '../domain/session/session.ts';
import { PolicyService } from '../domain/policy/policy-service.ts';
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
import { RequestPipeline } from '../platform/electron/request-pipeline.ts';
import { ContentBlocker } from '../platform/blocker/content-blocker.ts';
import { serveResources } from '../platform/blocker/resource-protocol.ts';
import {
  cleanUserAgent,
  guardWebContents,
  hardenSession,
} from '../platform/electron/session-security.ts';
import { RotatingFileLogSink } from '../platform/node/file-log-sink.ts';
import { JsonFileSettingsStore } from '../platform/node/json-settings-store.ts';
import { JsonFileSessionStore } from '../platform/node/session-store.ts';
import { SystemClock } from '../platform/node/system-clock.ts';
import { JsonFilePolicyCache } from '../platform/policy/policy-providers.ts';
import { createPolicyProviders } from '../platform/policy/platform-providers.ts';
import {
  BookmarksBarSetting,
  StartupSetting,
  BlockerAllowedSitesSetting,
  BlockerAnnoyancesSetting,
  BlockerCookieNoticesSetting,
  ContentBlockerSetting,
  SearchUrlTemplate,
  SetupShownSetting,
  SiteZoomSetting,
  SitePermissionsSetting,
  TabStripPositionSetting,
  coreSettings,
} from './core-settings.ts';
import { AppearanceController } from './appearance.ts';
import type { Bookmarks } from './bookmarks.ts';
import {
  canBeDefaultBrowser,
  DefaultBrowserSettingEnabled,
} from '../domain/default-browser/default-browser.ts';
import { ImportEnabled } from '../domain/import/import.ts';
import { SSLErrorOverrideAllowed } from '../domain/certificates/certificates.ts';
import { DeveloperToolsAvailability } from '../domain/page-tools/page-tools.ts';
import { CertificateExceptions } from '../platform/electron/certificates.ts';
import type { DataClient, DataServiceClient } from '../platform/electron/data-service-client.ts';
import { connectBlockerFrames } from './blocker-frames.ts';
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
      DefaultBrowserSettingEnabled,
    ],
    createPolicyProviders(brand, process.platform),
    logger,
    new JsonFilePolicyCache(join(userData, 'policy-cache.json')),
  );
  policies.applyCached();
  const freshPolicies = policies.refresh();

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
  const lifecycle = new Lifecycle(logger, clock, {});
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
  // Every request of web content passes the request pipeline; the content blocker is its
  // first step. Its engine loads with the first web page.
  const pipeline = new RequestPipeline();
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
  const webSessions = new Set<Session>();
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
      hardenSession(s, webPermissions);
      pipeline.attach(s);
      addFramePreload(s);
    }
  };
  app.on('session-created', protectWebSession);
  protectWebSession(session.defaultSession);
  protectWebSession(session.fromPartition(webPartition));

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
  const appearance = new AppearanceController(settings, router, internal, () =>
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
    newTabUrl,
    backgroundColor: windowBackground,
    appearanceArgument: () => appearance.argument,
    tabStripPosition: () => settings.get(TabStripPositionSetting),
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
    // The handlers of the other internal pages load with the first of them, before it loads.
    prepareInternalPage: (page) => (page === 'newtab' ? undefined : connectPages()),
    gate,
    router,
    logger,
    onContextMenu,
    certificateOverride: () => policies.mandatoryValue(SSLErrorOverrideAllowed) !== false,
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
      void settings.set(SiteZoomSetting, factor === 1 ? others : { ...others, [host]: factor });
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
    openInTab: openFromPage,
    // Popups that the filter lists name do not open, and count as blocked on their page.
    blocksPopup: (url, opener) => {
      const blocked = blocker.blocksPopup(url, opener.getURL());
      if (blocked) windows.countBlocked(opener.id);
      return blocked;
    },
    logger,
  });
  registerShellHandlers(router, windows, searchTemplate);
  const overlayOptions = {
    url: 'app://overlay/',
    preload: layout.pagePreload,
    partition: internalPartition,
    appearanceArgument: () => appearance.argument,
    gate,
    router,
  };
  // Sites and proxies that ask for a user name and password ask in the tab's window.
  app.on('login', (event, contents, details, info, callback) => {
    const window = contents === null ? undefined : windows.forTab(contents);
    if (window === undefined) return;
    event.preventDefault();
    void import('./login-prompt.ts').then(({ askForLogin }) =>
      askForLogin(window, details, info, callback, overlayOptions, router),
    );
  });
  // Certificates that the user accepted after the warning hold for this session.
  const certificates = new CertificateExceptions(
    () => policies.mandatoryValue(SSLErrorOverrideAllowed) !== false,
  );
  certificates.attach(app);
  router.handle(ProceedUnsafely, ({ tabId }, { sender }) => {
    windows.forShell(sender)?.proceedUnsafely(tabId, (contents) => certificates.allow(contents));
    return null;
  });
  registerNewTabHandlers(router, windows, searchTemplate);
  const shellSettings = new Set([
    BookmarksBarSetting.key,
    TabStripPositionSetting.key,
    ContentBlockerSetting.key,
    BlockerAllowedSitesSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
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
  router.handle(OpenBookmarkFolder, async ({ id, from, x, y }, { sender }) => {
    const window = windows.forShell(sender);
    if (window === undefined) return null;
    const { popupBookmarkFolder } = await import('./browser-menu.ts');
    popupBookmarkFolder(
      window,
      { x, y },
      { id, from },
      (folder) => bookmarks?.contents(folder) ?? [],
      (url, newTab) => {
        const active = window.tabs.active;
        if (newTab || active === undefined) window.tabs.open(url);
        else window.tabs.navigate(active.id, url);
      },
    );
    return null;
  });
  router.handle(OpenBlockerPopover, async (anchor, { sender }) => {
    const window = windows.forShell(sender);
    if (window === undefined) return null;
    const { openShieldPopover } = await import('./shield-popover.ts');
    openShieldPopover(window, anchor, {
      windows,
      router,
      overlay: overlayOptions,
      settings,
      blocker,
      blocking,
    });
    return null;
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
  const lastSession =
    !showSetup && settings.get(StartupSetting) === 'restore'
      ? parseSession(await savedSession)
      : undefined;
  // Links from other apps open in tabs; a start without a session or the guide shows only them.
  const startLinks = [...linksFromArguments(process.argv.slice(1)), ...pendingLinks.splice(0)];
  const first =
    lastSession === undefined
      ? windows.open(showSetup ? pageUrl('setup') : startLinks.shift())
      : windows.restore(lastSession);
  // Later links open in the window used last, which comes to the front, also without links;
  // without a window, the first link opens one.
  openLinks = (links) => {
    const [link, ...more] = links;
    const used = windows.lastUsed;
    const target = used ?? windows.open(link);
    if (used !== undefined && link !== undefined) target.tabs.open(link);
    for (const url of more) target.tabs.open(url);
    if (!target.window.isDestroyed()) target.window.focus();
  };
  if (startLinks.length > 0) openLinks(startLinks);
  // The session follows every change of tabs and windows; an empty one, after the last window
  // closed, is not kept, so the next start restores that window.
  windows.onDidChange(() => {
    const snapshot = windows.snapshot();
    if (snapshot.windows.length > 0) sessionStore.schedule(snapshot);
  });
  marks['window'] = Math.round(performance.now());
  lifecycle.advance('ready');
  // A start counts as healthy after 10 s with a loaded shell, or when it quits normally.
  let shellLoaded = false;
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
    const frontWindow = (): BrowserWindowController => windows.lastUsed ?? windows.open();
    void import('./browser-menu.ts')
      .then(({ macMenuBar }) =>
        Menu.setApplicationMenu(macMenuBar((command) => frontWindow().execute(command))),
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

  const refreshPolicies = (): void => void policies.refresh();
  app.on('browser-window-focus', refreshPolicies);
  const timer = setInterval(refreshPolicies, 15 * 60 * 1000);
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
    lifecycle.onWillShutdown((e) => {
      e.join(store.flush(), 'settings');
      const snapshot = windows.snapshot();
      if (snapshot.windows.length > 0) sessionStore.schedule(snapshot);
      e.join(sessionStore.flush(), 'session');
      const web = session.fromPartition(webPartition);
      web.flushStorageData();
      e.join(web.cookies.flushStore(), 'cookies');
    });
    void lifecycle.shutdown('quit').then(() => {
      windows.dispose();
      data.dispose();
      updates?.installOnExit();
      updates?.dispose();
      logger.info('Shutdown complete');
      // Everything is saved and every window is closed at this point.
      app.exit(0);
    });
  });
  lifecycle.advance('running');
}

function registerShellHandlers(
  router: IpcRouter,
  windows: WindowManager,
  searchTemplate: () => Promise<string>,
): void {
  const windowOf = (sender: Electron.WebContents): BrowserWindowController => {
    const window = windows.forShell(sender);
    if (window === undefined) {
      throw new Error('No window for this shell');
    }
    return window;
  };
  const target = async (input: string): Promise<string | undefined> =>
    resolveOmniboxInput(input, await searchTemplate())?.url;
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
  router.handle(
    ReopenClosedTab,
    (_request, { sender }) => (windowOf(sender).tabs.reopenClosed(), null),
  );
  router.handle(NavigateTab, async ({ tabId, input }, { sender }) => {
    const url = await target(input);
    if (url !== undefined) windowOf(sender).tabs.navigate(tabId, url);
    return null;
  });
  router.handle(
    TabAction,
    ({ tabId, action }, { sender }) => (windowOf(sender).tabs.run(tabId, action), null),
  );
  router.handle(SetShellInsets, (insets, { sender }) => (windowOf(sender).setInsets(insets), null));
  router.handle(FindInPage, ({ tabId, query, forward, next }, { sender }) => {
    windowOf(sender).find(tabId, query, forward, next);
    return null;
  });
  router.handle(StopFinding, ({ tabId }, { sender }) => (windowOf(sender).stopFind(tabId), null));
  router.handle(ResetZoom, ({ tabId }, { sender }) => (windowOf(sender).zoom(tabId, 0), null));
  router.handle(
    ToggleBookmark,
    (_request, { sender }) => (windowOf(sender).execute('bookmark.toggle'), null),
  );
  // The menu code loads with the first menu, not before the first window.
  router.handle(OpenMenu, async (position, { sender }) => {
    const window = windowOf(sender);
    const { popupBrowserMenu } = await import('./browser-menu.ts');
    popupBrowserMenu(window, position);
    return null;
  });
}

function registerNewTabHandlers(
  router: IpcRouter,
  windows: WindowManager,
  searchTemplate: () => Promise<string>,
): void {
  router.handle(GetNewTabState, async () => ({
    engine: engineForSearchUrl(await searchTemplate())?.name ?? null,
  }));
  router.handle(NavigateFromNewTab, async ({ input }, { sender }) => {
    const window = windows.forTab(sender);
    const tabId = window?.tabIdOf(sender);
    const url = resolveOmniboxInput(input, await searchTemplate())?.url;
    if (window !== undefined && tabId !== undefined && url !== undefined) {
      window.tabs.navigate(tabId, url);
    }
    return null;
  });
}

/**
 * The first menu bar of macOS, until the full one loads. It has no View menu: the roles of
 * that menu act on the focused view, the browser's own ones too, and ignore the policies.
 */
function macMenu(): Electron.MenuItemConstructorOptions[] {
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }];
}
