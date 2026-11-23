import type { Session, WebContents } from 'electron';
import { originOf } from '../domain/permissions/site-permissions.ts';
import {
  certificateReason,
  connectionOf,
  cookieAddress,
  cookieOfSite,
  decisionsOf,
  permissionRows,
  resetPermissions,
  sameSite,
  setPermission,
} from '../domain/site-info/site-info.ts';
import type { Tab, TabId } from '../domain/tabs/tab-service.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import { summarize } from '../platform/electron/certificate-summary.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import type { OverlayAnchor, PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  ClearSiteData,
  OpenSiteSettings,
  ReloadSitePage,
  ResetSitePermissions,
  RestoreWarnings,
  SetSitePermission,
  type CertificateSummary,
  type OverlayContent,
  type SiteInformation,
} from '../shared/ipc/overlay-contracts.ts';
import {
  BlockerAllowedSitesSetting,
  ContentBlockerSetting,
  SitePermissionsSetting,
} from './core-settings.ts';
import {
  existingOverlay,
  focusBackOf,
  overlayBySender,
  overlayOf,
  rectOf,
  track,
  windowOfOverlay,
} from './overlays.ts';
import {
  blockerStateOf,
  connectBlockerSwitch,
  type SiteBlockingDependencies,
} from './site-blocking.ts';
import type { WebRequests } from './web-requests.ts';

/** What site information needs from the browser process. */
export interface SiteInfoDependencies extends SiteBlockingDependencies {
  readonly overlay: OverlayOptions;
  /** The certificates, HTTPS-First and the permissions of the sessions of web pages. */
  readonly web: Pick<
    WebRequests,
    'certificates' | 'certificateLog' | 'httpsFirst' | 'permissionStore'
  >;
  readonly logger: Logger;
}

/**
 * Site information as it opened: its number, the tab and the origin that it shows, which every
 * action checks again, and what it learned or did since it opened.
 */
interface Opened {
  readonly id: number;
  readonly tab: TabId;
  readonly origin: string;
  readonly anchor: OverlayAnchor;
  /**
   * Whether a permission that the site asked for changed, which a reload of the page applies;
   * the page follows a decision about its pop-ups at once.
   */
  changed: boolean;
  /** Whether the cookies and data of the site were deleted. */
  cleared: boolean;
  /** How many cookies the site has, once counted. */
  cookies: number | null;
  /** The site whose cookies count, such as `example.com`, once known; the host until then. */
  site: string;
}

/**
 * The data that deleting the data of a site clears for the origin of its page. The cache of
 * shaders is left out: Chromium clears it for every site at once.
 */
const siteStorages = [
  'localstorage',
  'indexdb',
  'serviceworkers',
  'cachestorage',
  'filesystem',
] as const;

/** How long site information waits for the count of the cookies before it opens. */
const countWait = 200;

/** What a site or a proxy asks, which site information never takes the place of. */
const questions = new Set<OverlayContent['kind']>(['permission', 'securityKey', 'screen', 'login']);

const opened = new WeakMap<WindowOverlay, Opened>();
let openings = 0;
let dependencies: SiteInfoDependencies | undefined;

/**
 * Opens site information for the page of a window's active tab at the chip of its
 * connection: the connection and the certificate, the permissions of the site, its cookies and
 * data, and the content blocker on it. A question of a site may take its place. The first call
 * connects the overlay's channels.
 * @param window - The window whose chip was clicked.
 * @param anchor - Where the chip is, and whether the keyboard opened it.
 * @param deps - What site information needs.
 */
export async function openSiteInfo(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  deps: SiteInfoDependencies,
): Promise<void> {
  if (dependencies === undefined) connect(deps);
  const tab = window.tabs.active;
  const origin = tab === undefined ? undefined : originOf(addressOf(tab));
  if (tab === undefined || origin === undefined) return;
  openings += 1;
  const state: Opened = {
    id: openings,
    tab: tab.id,
    origin,
    anchor: rectOf(anchor),
    changed: false,
    cleared: false,
    cookies: null,
    site: hostnameOf(addressOf(tab)),
  };
  if (contentOf(deps, window, state) === undefined) return;
  const focusBack = focusBackOf(window, anchor);
  const before = existingOverlay(window)?.content ?? null;
  const counted = count(deps, window, state);
  await Promise.race([counted, new Promise((done) => setTimeout(done, countWait))]);
  // While the cookies were counted, the tab may have changed, or a question of a site or another
  // popover opened, which keeps its place; the suggestions of the address bar give way.
  const content = contentOf(deps, window, state);
  const now = existingOverlay(window)?.content ?? null;
  if (
    content === undefined ||
    (now !== null && now.kind !== 'suggestions' && (now !== before || questions.has(now.kind)))
  ) {
    return;
  }
  const overlay = overlayOf(window, deps.overlay, deps.router);
  overlay.open(content, {
    popover: { kind: 'site', folder: null },
    focusBack,
    yieldsToQuestions: true,
  });
  opened.set(overlay, state);
  track(window, overlay);
  void counted.then(() => refresh(window, overlay));
}

/** Connects the requests of site information and follows the changes of what it shows. */
function connect(deps: SiteInfoDependencies): void {
  dependencies = deps;
  const { router, windows, settings } = deps;
  /** The window, the page and what opened, for a request of site information that may act. */
  const target = (
    senderId: number,
    id: number | undefined,
  ):
    | {
        readonly window: BrowserWindowController;
        readonly overlay: WindowOverlay;
        readonly state: Opened;
        readonly contents: WebContents;
        readonly content: SiteInformation;
      }
    | undefined => {
    const overlay = overlayBySender(senderId);
    const window = overlay === undefined ? undefined : windowOfOverlay(windows.all, overlay);
    const content = overlay?.content;
    const state = overlay === undefined ? undefined : opened.get(overlay);
    if (
      window === undefined ||
      overlay === undefined ||
      state === undefined ||
      content?.kind !== 'site' ||
      content.id !== state.id ||
      id !== state.id
    ) {
      return undefined;
    }
    const contents = window.webContentsOf(state.tab);
    // The page may have gone to another site since the popover showed it, also when the tab
    // has not told yet: nothing acts on that site, and the popover follows the page.
    if (
      contents === undefined ||
      !stillShows(window, state) ||
      (content.page && originOf(contents.getURL()) !== state.origin)
    ) {
      refresh(window, overlay);
      return undefined;
    }
    return { window, overlay, state, contents, content };
  };
  router.handle(SetSitePermission, ({ id, permission, allowed }, { sender }) => {
    const found = target(sender.id, id);
    if (found === undefined || !found.content.page) return null;
    const store = deps.web.permissionStore(found.contents.session);
    if (store.managed()) return null;
    const sites = store.sites();
    const next = setPermission(sites, found.state.origin, permission, allowed);
    if (next !== sites && store.save(next) && permission !== 'popups') found.state.changed = true;
    refresh(found.window, found.overlay);
    return null;
  });
  router.handle(ResetSitePermissions, ({ id }, { sender }) => {
    const found = target(sender.id, id);
    if (found === undefined || !found.content.page) return null;
    const store = deps.web.permissionStore(found.contents.session);
    if (store.managed()) return null;
    const sites = store.sites();
    const next = resetPermissions(sites, found.state.origin);
    const asked = permissionRows(decisionsOf(sites, found.state.origin)).some(
      ({ name }) => name !== 'popups',
    );
    if (next !== sites && store.save(next) && asked) found.state.changed = true;
    refresh(found.window, found.overlay);
    return null;
  });
  router.handle(ReloadSitePage, ({ id }, { sender }) => {
    const found = target(sender.id, id);
    if (found === undefined) return null;
    found.state.changed = false;
    found.window.tabs.run(found.state.tab, 'reload');
    refresh(found.window, found.overlay);
    return null;
  });
  router.handle(ClearSiteData, async ({ id }, { sender }) => {
    const found = target(sender.id, id);
    if (found === undefined || !found.content.page) return null;
    const { state, window, overlay } = found;
    // Each deletion ends with the note that it is done, also after an earlier one.
    state.cleared = false;
    refresh(window, overlay);
    try {
      await clearSite(found.contents.session, state);
      state.cleared = true;
    } catch (error: unknown) {
      deps.logger.warn('The data of a site was not deleted', { error: String(error) });
    }
    await count(deps, window, state);
    refresh(window, overlay);
    return null;
  });
  router.handle(RestoreWarnings, async ({ id }, { sender }) => {
    const found = target(sender.id, id);
    if (found === undefined) return null;
    const { contents, content, state, window } = found;
    const address = addressOf(window.tabs.active);
    if (content.connection !== 'accepted' && content.connection !== 'allowed-http') return null;
    found.overlay.close();
    if (content.connection === 'accepted') {
      deps.web.certificates.revoke(contents, hostOf(address));
      // A connection that is open keeps its certificate; the page loads over a new one, which
      // Chromium checks again, and the warning shows.
      await contents.session.closeAllConnections().catch(() => undefined);
    } else {
      deps.web.httpsFirst.revoke(contents, hostnameOf(address));
    }
    if (!contents.isDestroyed()) window.tabs.run(state.tab, 'reload');
    return null;
  });
  router.handle(OpenSiteSettings, (_request, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOfOverlay(windows.all, overlay);
    if (overlay?.content?.kind !== 'site') return null;
    overlay.close();
    window?.openPage('settings', `#${SitePermissionsSetting.key}`);
    return null;
  });
  // The switch of the content blocker acts only while the popover shows the site of the page;
  // a refused change sends the popover again, so that its switch goes back.
  connectBlockerSwitch('site', deps, {
    allows: (window, overlay, id) => {
      const state = opened.get(overlay);
      return (
        state !== undefined &&
        overlay.content?.kind === 'site' &&
        overlay.content.id === state.id &&
        id === state.id &&
        stillShows(window, state)
      );
    },
    refresh,
  });
  // The popover follows the page, at most every 50 ms, and the settings that it shows.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshAll = (): void => {
    for (const window of windows.all) {
      const overlay = existingOverlay(window);
      if (overlay?.content?.kind === 'site') refresh(window, overlay);
    }
  };
  windows.onDidChange(() => {
    timer ??= setTimeout(() => {
      timer = undefined;
      refreshAll();
    }, 50);
  });
  const shownSettings = new Set<string>([
    SitePermissionsSetting.key,
    ContentBlockerSetting.key,
    BlockerAllowedSitesSetting.key,
  ]);
  settings.onDidChange(({ keys }) => {
    if (keys.some((key) => shownSettings.has(key))) refreshAll();
  });
}

/**
 * Shows what is true now in open site information, or closes it once the tab no longer shows
 * the site that it opened for.
 * @param again - Sends it also when it did not change, as after a refused change.
 */
function refresh(window: BrowserWindowController, overlay: WindowOverlay, again = false): void {
  const shown = overlay.content;
  const state = opened.get(overlay);
  if (shown?.kind !== 'site' || state === undefined || shown.id !== state.id) return;
  if (dependencies === undefined) return;
  const next = contentOf(dependencies, window, state);
  if (next === undefined) overlay.close();
  else if (again || JSON.stringify(next) !== JSON.stringify(shown)) overlay.update(next);
}

/** Whether the window's active tab still shows the site that site information opened for. */
function stillShows(window: BrowserWindowController, state: Opened): boolean {
  const tab = window.tabs.active;
  return sameSite(state, {
    tab: tab?.id,
    origin: tab === undefined ? undefined : originOf(addressOf(tab)),
  });
}

/**
 * What site information shows for the page of a window's active tab, or `undefined` when the
 * tab no longer shows the site that it opened for, or its page has no site information.
 */
function contentOf(
  deps: SiteInfoDependencies,
  window: BrowserWindowController,
  state: Opened,
): SiteInformation | undefined {
  const tab = window.tabs.active;
  if (tab === undefined || !stillShows(window, state)) return undefined;
  const { web } = deps;
  const address = addressOf(tab);
  const contents = window.webContentsOf(tab.id);
  const accepted =
    contents === undefined ? undefined : web.certificates.acceptedOf(contents, address);
  const connection = connectionOf({
    url: tab.url,
    problem: tab.problem,
    covered: accepted !== undefined,
    accepted: accepted?.live === true,
    httpAllowed: contents !== undefined && web.httpsFirst.isAllowed(contents, hostnameOf(address)),
  });
  if (connection === undefined) return undefined;
  const page = contents !== undefined && tab.problem === null && /^https?:/i.test(tab.url);
  // A warning names the error of its page; a page that came with a certificate that people
  // accepted names the error of that certificate.
  const code = tab.problem?.kind === 'certificate' ? tab.problem.code : (accepted?.error ?? '');
  const store = page ? web.permissionStore(contents.session) : undefined;
  const blocker = page ? blockerStateOf(deps, tab) : undefined;
  return {
    kind: 'site',
    id: state.id,
    anchor: state.anchor,
    host: hostOf(address).slice(0, 300),
    connection,
    reason: connection === 'certificate' ? certificateReason(code) : null,
    code: connection === 'certificate' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : '',
    certificate: certificateOf(web, connection, contents, address, {
      warning: tab.problem?.kind === 'certificate',
      accepted: accepted?.certificate,
    }),
    page,
    private: window.isPrivate,
    permissions:
      store === undefined ? [] : permissionRows(decisionsOf(store.sites(), state.origin)),
    managed: store?.managed() === true,
    changed: page && state.changed,
    cookies: page ? state.cookies : null,
    site: state.site.slice(0, 300),
    cleared: page && state.cleared,
    blocker: blocker ?? null,
  };
}

/**
 * The certificate that site information shows: for a secure page, the one that Chromium last
 * trusted for its host, never one that it refused, as for another port; the one that a page
 * was refused, which its warning is about; or the one that people accepted for a page that came
 * with it.
 */
function certificateOf(
  web: SiteInfoDependencies['web'],
  connection: SiteInformation['connection'],
  contents: WebContents | undefined,
  address: string,
  seen: { readonly warning: boolean; readonly accepted: Electron.Certificate | undefined },
): CertificateSummary | null {
  if (contents === undefined) return null;
  const log = web.certificateLog;
  const host = hostnameOf(address);
  if (connection === 'secure') return log.certificateOf(contents.session, host, 'trusted') ?? null;
  if (connection !== 'accepted' && connection !== 'certificate') return null;
  const refused = web.certificates.refusedOf(contents);
  if (seen.warning && refused !== undefined && refused.host === hostOf(address)) {
    return summarize(refused.certificate, null);
  }
  if (seen.accepted !== undefined) return summarize(seen.accepted, null);
  // Chromium checked the certificate of the warning as well.
  return log.certificateOf(contents.session, host, 'refused') ?? null;
}

/**
 * Counts the cookies of the site of site information, once the site of its host is known: the
 * registrable domain, such as `example.com` for `www.example.com`, with the private suffixes of
 * the public suffix list, so that `you.github.io` is a site of its own; or the host itself, such
 * as an address of this computer.
 */
async function count(
  deps: SiteInfoDependencies,
  window: BrowserWindowController,
  state: Opened,
): Promise<void> {
  const contents = window.webContentsOf(state.tab);
  if (contents === undefined) return;
  try {
    const host = hostnameOf(`${state.origin}/`);
    state.site = await siteOfHost(host);
    state.cookies = (await cookiesOfSite(contents.session, state.site)).length;
  } catch (error: unknown) {
    deps.logger.warn('The cookies of a site were not counted', { error: String(error) });
  }
}

/**
 * The cookies of a site in a session: those of its domain and of every host under it. Electron
 * finds by `domain` only the cookies that a request to that domain would send, which leaves out
 * those of the hosts under it, such as one of `www.example.com` for the site `example.com`, so
 * the cookies of the session are filtered here.
 */
async function cookiesOfSite(session: Session, site: string): Promise<Electron.Cookie[]> {
  return (await session.cookies.get({})).filter((cookie) =>
    cookieOfSite(cookie.domain ?? '', site),
  );
}

/**
 * Deletes the cookies of a site, and the data of the origin of its page, in one session: the
 * session of the window, or of the workspace that keeps its own. Other sites, and what other
 * sites keep under this one, stay.
 */
async function clearSite(session: Session, state: Opened): Promise<void> {
  const site = await siteOfHost(hostnameOf(`${state.origin}/`));
  state.site = site;
  const cookies = await cookiesOfSite(session, site);
  await Promise.all(
    cookies.map((cookie) => session.cookies.remove(cookieAddress(cookie), cookie.name)),
  );
  await session.clearStorageData({ origin: state.origin, storages: [...siteStorages] });
  await session.cookies.flushStore();
}

let domainParser: Promise<(host: string) => string> | undefined;

/** The site of a host for its cookies; the list of suffixes loads with the first one. */
function siteOfHost(host: string): Promise<string> {
  domainParser ??= import('tldts-experimental').then(
    ({ getDomain }) =>
      (name: string) =>
        getDomain(name, { allowPrivateDomains: true }) ?? name,
  );
  return domainParser.then((domainOf) => domainOf(host));
}

/** The address of the page of a tab: the one that a warning is about, or the page's own. */
function addressOf(tab: Tab | undefined): string {
  return tab?.problem?.url ?? tab?.url ?? '';
}

/** The host of an address with its port, as site information names it. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** The host of an address without its port. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
