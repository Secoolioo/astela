import type { Input, WebContents, WebContentsView } from 'electron';
import type { TabId, TabProblem } from '../../domain/tabs/tab-service.ts';
import { noAppRegionCss } from '../../shared/app-region.ts';
import { sameZoom, zoomFactors } from '../../shared/zoom.ts';
import type { WindowHost, WebPages } from './browser-window.ts';
import { typesText } from './tab-activity.ts';

/**
 * The code of the windows for their web pages, which loads with the first of them: what the
 * view of a web page does as it navigates, fails or stops answering, and its zoom. The views
 * of the browser's own pages need none of it, so a start that shows only them does not load
 * it. A web page loads once this code follows its view (`BrowserWindowController`), so none
 * of its events goes unseen.
 */
export const webPages: WebPages = {
  watch,
  zoom,
  applyDefaultZoom,
  typed,
  find,
  proceedUnsafely,
  proceedInsecurely,
};

/**
 * Follows the events of a new view of a web page: what keeps its tab awake, the visits that
 * the history records, the pages that could not load or whose renderer is gone, the zoom of
 * each site, the pages that stop answering, and the icon and the sound of the page.
 * @param host - The window.
 * @param id - The tab of the view.
 * @param view - The view.
 * @param adopted - Whether a script made the view's page, which loads already.
 */
function watch(host: WindowHost, id: TabId, view: WebContentsView, adopted: boolean): void {
  const { window, options } = host;
  const contents = view.webContents;
  // What a web page does that keeps it awake, such as media that play.
  options.activity?.()?.watch(contents);
  // The frame preload keeps every document that a web page loads from moving the window. A
  // page that a script opened shows what the script wrote into its first, empty document,
  // in which no preload runs, and every document gets the style sheet again once it is
  // parsed, in case no preload ran in it either.
  if (adopted) keepAppRegionsOut(contents);
  contents.on('dom-ready', () => keepAppRegionsOut(contents));
  // Pages that change their address with the History API, as many web apps do, count as
  // visits too; a jump to an anchor on the same page does not. A private window keeps no
  // history.
  const onVisit = window.isPrivate ? undefined : options.onVisit;
  let visited = '';
  const visit = (address: string): void => {
    if (!/^https?:/i.test(address) || withoutHash(address) === withoutHash(visited)) return;
    visited = address;
    onVisit?.(address, contents.getTitle(), false);
  };
  contents.on('did-navigate', (_event, address) => {
    // The page of a tab that wakes with its history is no new visit.
    const entry = host.entries.get(id);
    if (entry?.view === view && entry.restored === address) {
      visited = address;
      return;
    }
    visited = '';
    visit(address);
  });
  contents.on('did-navigate-in-page', (_event, address, isMainFrame) => {
    if (isMainFrame) visit(address);
  });
  contents.on('page-title-updated', (_event, title) => {
    const address = contents.getURL();
    if (/^https?:/i.test(address)) onVisit?.(address, title, true);
  });
  // A page that could not be loaded, or whose renderer is gone, shows the shell's page
  // for it instead of an empty one.
  contents.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
    if (!isMainFrame) return;
    // A load that a new navigation stopped is no error, unless HTTPS-First stopped it
    // because its secure address gave no answer in time.
    if (code === -3) {
      const slow = options.insecureAddressFor?.(contents, failed, true);
      if (slow !== undefined) {
        setProblem(host, id, {
          kind: 'insecure',
          code: 'ERR_TIMED_OUT',
          url: slow,
          proceed: true,
        });
      }
      return;
    }
    const name = /^[A-Z0-9_]{1,64}$/.test(description) ? description : 'ERR_FAILED';
    // A site that HTTPS-First could not load securely offers its insecure address after a
    // warning. Without a name or a network, the insecure address would not load either.
    const insecure =
      code === -105 || code === -106
        ? undefined
        : options.insecureAddressFor?.(contents, failed, false);
    if (insecure !== undefined) {
      setProblem(host, id, { kind: 'insecure', code: name, url: insecure, proceed: true });
      return;
    }
    const certificate = code <= -200 && code > -300;
    setProblem(host, id, {
      kind: certificate ? 'certificate' : 'error',
      code: name,
      url: failed,
      proceed: certificate && (options.certificateOverride?.() ?? false),
    });
  });
  // A page that a script opened may close itself; its tab goes with it. A tab that goes to
  // sleep lets go of its view before the view closes.
  contents.once('destroyed', () => {
    if (!window.window.isDestroyed() && host.entries.get(id)?.view === view) {
      window.tabs.close(id);
    }
  });
  // Electron reports only the process of the page itself, and the tab has nothing to show
  // once it ended, however it ended: with the sandbox of Linux, a renderer that crashed can
  // count as one that exited cleanly.
  contents.on('render-process-gone', (_event, details) => {
    if (window.window.isDestroyed() || contents.isDestroyed()) return;
    const code = details.reason.toUpperCase().replaceAll('-', '_');
    setProblem(host, id, { kind: 'crashed', code, url: contents.getURL(), proceed: false });
  });
  contents.on('did-navigate', (_event, address) => {
    setProblem(host, id, null);
    // A site keeps the zoom it was left at, also after the browser restarts, and other
    // sites get the default zoom. Chromium gives a page the zoom that its site had in this
    // session, or else the default zoom that the tab was made with, which may be old.
    const saved = options.zoomFor?.(address);
    const base = options.defaultZoom?.() ?? 1;
    const factor = contents.getZoomFactor();
    if (sameZoom(factor, host.madeZoom.get(contents) ?? base) || sameZoom(factor, base)) {
      const wanted = saved ?? base;
      if (sameZoom(factor, wanted)) return;
      contents.setZoomFactor(wanted);
      // The tab may have taken the zoom of its page before, when this code followed its view
      // only after the view's other events.
      if (host.entries.get(id)?.view === view) window.tabs.update(id, { zoom: wanted });
    }
  });
  contents.on('unresponsive', () => options.onUnresponsive?.(window, id, contents));
  // Ctrl and the mouse wheel, or a pinch, zoom in steps like the keys.
  contents.on('zoom-changed', (_event, direction) => zoom(host, id, direction === 'in' ? 1 : -1));
  // The find bar of the active tab shows the matches of its search.
  contents.on('found-in-page', (_event, result) => {
    const finding = host.findState();
    if (finding === null || id !== window.tabs.active?.id) return;
    host.setFindState({
      query: finding.query,
      active: result.activeMatchOrdinal,
      matches: result.matches,
    });
  });
  // The icon of the page goes once another page has taken its place: a link that starts a
  // download, or a response without content, leaves the page as it was. This comes after the
  // visit above, which reads `restored` too, also when this code loads after the view.
  contents.on('did-navigate', (_event, address) => {
    const entry = host.entries.get(id);
    if (entry?.view !== view) return;
    // The page of a tab that wakes with its history is the page whose icon the tab shows.
    const restored = entry.restored;
    entry.restored = undefined;
    if (restored !== address) host.dropFavicon(id);
  });
  contents.on('page-favicon-updated', (_event, urls) => void loadFavicon(host, id, view, urls));
  contents.on('audio-state-changed', ({ audible }) => {
    if (host.entries.get(id)?.view !== view) return;
    window.tabs.update(id, { audible });
    // A tab that turns quiet counts as used until now.
    if (!audible) host.usedAt.set(id, host.now());
  });
}

/**
 * Records why a tab shows no page, or that it shows one again. While a tab has a problem,
 * its view is hidden and the shell shows the problem in its place.
 * @param host - The window.
 * @param id - The tab.
 * @param problem - The problem, or `null` once the tab shows its page again.
 */
function setProblem(host: WindowHost, id: TabId, problem: TabProblem | null): void {
  const { window } = host;
  if (problem === null && problemOf(host, id) === null) return;
  // In place of its page, the tab shows no icon of a page.
  if (problem !== null) host.dropFavicon(id);
  window.tabs.update(id, { problem });
  const entry = host.entries.get(id);
  if (entry !== undefined && window.isShown(id) && !window.window.isDestroyed()) {
    host.shownViewOf(entry).setVisible(problem === null);
    // Focusing a view raises its window: a window in the background stays there.
    if (window.window.isFocused()) window.focusContent();
  }
}

/**
 * Zooms a tab's page in or out by one step, or back to the default zoom. The zoom holds
 * for the page's site, in every tab, and is remembered for the next visit.
 * @param host - The window.
 * @param id - The tab.
 * @param direction - 1 to zoom in, -1 to zoom out, 0 for the default zoom.
 */
function zoom(host: WindowHost, id: TabId, direction: 1 | -1 | 0): void {
  const { window, options } = host;
  const contents = host.webContentsOf(id);
  if (contents === undefined) return;
  const current = contents.getZoomFactor();
  const factor =
    direction === 0
      ? (options.defaultZoom?.() ?? 1)
      : direction > 0
        ? (zoomFactors.find((step) => step > current + 0.001) ?? current)
        : (zoomFactors.toReversed().find((step) => step < current - 0.001) ?? current);
  contents.setZoomFactor(factor);
  window.tabs.update(id, { zoom: factor });
  // Chromium zooms the site in every tab that shows it.
  for (const [other, entry] of host.entries) {
    const shown = entry.view.webContents;
    if (other !== id && entry.page === undefined && !shown.isDestroyed()) {
      window.tabs.update(other, { zoom: shown.getZoomFactor() });
    }
  }
  // A private window keeps no zoom for later visits.
  if (!window.isPrivate) options.onZoom?.(contents.getURL(), factor);
}

/**
 * Gives the pages of sites without a zoom of their own a new default zoom.
 * @param host - The window.
 * @param factor - The new default zoom.
 */
function applyDefaultZoom(host: WindowHost, factor: number): void {
  for (const [id, entry] of host.entries) {
    const contents = entry.view.webContents;
    if (entry.page !== undefined || contents.isDestroyed()) continue;
    if (host.options.zoomFor?.(contents.getURL()) !== undefined) continue;
    contents.setZoomFactor(factor);
    host.window.tabs.update(id, { zoom: factor });
  }
}

/**
 * Loads the icon of a tab's page, which the tab shows unless its page changed meanwhile.
 * A tab loads one icon at a time: a newer icon of its page stops the load of the one
 * before, and so does another page.
 * @param host - The window.
 * @param id - The tab.
 * @param view - The view of the page.
 * @param urls - The icons that the page names.
 */
async function loadFavicon(
  host: WindowHost,
  id: TabId,
  view: WebContentsView,
  urls: string[],
): Promise<void> {
  const url = urls.find((candidate) => /^(?:https?:|data:image\/)/i.test(candidate));
  const entry = host.entries.get(id);
  if (url === undefined || entry?.view !== view) return;
  const before = entry.iconLoad;
  const loading = new AbortController();
  entry.iconLoad = loading;
  const { session } = view.webContents;
  const page = view.webContents.getURL();
  const { favicons } = await import('./favicons.ts');
  const loaded = favicons.load(session, url, page, loading.signal);
  // The load before gives way only now, so that a page that names the same icon again
  // does not start its load anew.
  before?.abort();
  const key = await loaded;
  if (entry.iconLoad === loading) entry.iconLoad = undefined;
  if (key !== undefined && !loading.signal.aborted && host.entries.get(id)?.view === view) {
    host.window.tabs.update(id, { favicon: key });
  }
}

/**
 * Takes note of a key that reaches a web page and types text into it: the page may hold
 * changes that it has not saved yet, which keep its tab awake.
 * @param host - The window.
 * @param contents - The web page.
 * @param input - The key, as `before-input-event` gives it.
 */
function typed(host: WindowHost, contents: WebContents, input: Input): void {
  if (typesText(input)) host.options.activity?.()?.typing(contents);
}

/**
 * Looks for text in a tab's page, or for its next or previous match.
 * @param host - The window.
 * @param id - The tab.
 * @param query - The text.
 * @param forward - Whether to look forward.
 * @param next - Whether to go on from the current match.
 */
function find(host: WindowHost, id: TabId, query: string, forward: boolean, next: boolean): void {
  const contents = host.webContentsOf(id);
  const finding = host.findState();
  // Only an open find bar looks; a late request after Escape does not open it again.
  if (contents === undefined || id !== host.window.tabs.active?.id || finding === null) return;
  host.keepQuery(query);
  // Electron's findNext begins a new search: new text starts one, and the next or previous
  // match goes on with it, so Chromium handles a step only after the search it belongs to.
  if (query === '') contents.stopFindInPage('clearSelection');
  else contents.findInPage(query, { forward, findNext: !next });
  // The numbers stay until the page reports those of the new search, so they do not flicker.
  host.setFindState({ ...finding, query });
}

/**
 * Continues to a page whose certificate was refused, once the certificate is accepted.
 * @param host - The window.
 * @param id - The tab.
 * @param accept - Accepts the certificate that the page's web contents were refused.
 */
function proceedUnsafely(
  host: WindowHost,
  id: TabId,
  accept: (contents: WebContents) => boolean,
): void {
  const contents = host.entries.get(id)?.view.webContents;
  if (problemOf(host, id)?.kind === 'certificate' && contents !== undefined && accept(contents)) {
    contents.reload();
  }
}

/**
 * Loads the insecure address of a site without a secure connection, once it is allowed.
 * @param host - The window.
 * @param id - The tab.
 * @param allow - Allows the site's insecure address for the session of the tab's page.
 */
function proceedInsecurely(
  host: WindowHost,
  id: TabId,
  allow: (contents: WebContents, address: string) => void,
): void {
  const problem = problemOf(host, id);
  const contents = host.entries.get(id)?.view.webContents;
  if (problem?.kind !== 'insecure' || contents === undefined) return;
  allow(contents, problem.url);
  contents.loadURL(problem.url).catch(() => undefined);
}

/** Why a tab shows no page, or `null` when it shows one. */
function problemOf(host: WindowHost, id: TabId): TabProblem | null {
  return host.window.tabs.all.find((tab) => tab.id === id)?.problem ?? null;
}

/** An address without its fragment, which names a place on the page. */
function withoutHash(address: string): string {
  const hash = address.indexOf('#');
  return hash === -1 ? address : address.slice(0, hash);
}

/**
 * Gives the current document of a web page the user style sheet that keeps it from marking
 * regions that move the window.
 * @param contents - The web page.
 */
function keepAppRegionsOut(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  // A page that went away meanwhile needs the style sheet no more.
  contents.insertCSS(noAppRegionCss, { cssOrigin: 'user' }).catch(() => undefined);
}
