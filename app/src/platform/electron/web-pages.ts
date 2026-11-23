import type { Input, WebContents, WebContentsView } from 'electron';
import type { TabId, TabProblem } from '../../domain/tabs/tab-service.ts';
import { noAppRegionCss } from '../../shared/app-region.ts';
import { sameZoom, zoomFactors } from '../../shared/zoom.ts';
import { activates } from '../../domain/navigation/popup-activation.ts';
import { DocumentRequests, documentOf } from '../../domain/blocker/document-requests.ts';
import type { CoverEnd, TabCover, WindowHost, WebPages } from './browser-window.ts';
import { followActivation, pageActivations } from './page-activation.ts';
import { typesText } from './tab-activity.ts';

/** The document that each view of a web page shows, whose blocked requests the shield counts. */
const documents = new WeakMap<WebContents, DocumentRequests>();

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
  cover: coverPage,
  uncover: uncoverPage,
  counts: (contents, document) =>
    documents.get(contents)?.counts(document) ?? (document === undefined || document() !== null),
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
  // The input that people give the page lets it open a window.
  followActivation(contents);
  // The frame preload keeps every document that a web page loads from moving the window. A
  // page that a script opened shows what the script wrote into its first, empty document,
  // in which no preload runs, and every document gets the style sheet again once it is
  // parsed, in case no preload ran in it either.
  if (adopted) keepAppRegionsOut(contents);
  contents.on('dom-ready', () => keepAppRegionsOut(contents));
  // The shield counts the blocked requests of the document on screen, from its commit on, and
  // those that it made before the browser saw it commit; a download or a stop, which commit no
  // document, leaves the count of the page, and what a page that went still sends counts for no
  // page.
  const requests = new DocumentRequests();
  documents.set(contents, requests);
  // The page that a script opened may show its document already.
  if (adopted) requests.opened(documentOf(contents.mainFrame));
  contents.on('did-navigate', () => {
    const blocked = requests.commit(documentOf(contents.mainFrame));
    if (host.entries.get(id)?.view === view) window.tabs.update(id, { blocked });
  });
  // Pages that change their address with the History API, as many web apps do, count as
  // visits too; a jump to an anchor on the same page does not. A private window keeps no
  // history.
  const onVisit = window.isPrivate ? undefined : options.onVisit;
  // Whether the policies of the organization block an address. The history keeps no visit of
  // such a page, which only shows until it is loaded again and stopped, as below.
  const blocked = (address: string): boolean => options.blockedByPolicy?.(address) === true;
  // The blocked address that the tab loaded again past the service worker of its site, below.
  let reloadedPast: string | undefined;
  let visited = '';
  const visit = (address: string): void => {
    if (!/^https?:/i.test(address) || withoutHash(address) === withoutHash(visited)) return;
    if (blocked(address)) return;
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
    if (!isMainFrame) return;
    // A page that shows another path, as web apps do, may show another article; a jump to an
    // anchor of the same page does not.
    const before = visited;
    visit(address);
    if (withoutHash(address) !== withoutHash(before) && host.entries.get(id)?.view === view) {
      window.uncover(id, 'navigated');
      window.tabs.update(id, { reader: 'none' });
      options.onPageEvent?.(window, id, contents, 'changed');
    }
  });
  // The reader view checks the page once its main frame has loaded, but not a page that a
  // policy blocks.
  contents.on('did-frame-finish-load', (_event, isMainFrame) => {
    if (isMainFrame && host.entries.get(id)?.view === view && !blocked(contents.getURL())) {
      options.onPageEvent?.(window, id, contents, 'loaded');
    }
  });
  // Picture in picture looks at the videos of the page again when one plays or pauses, in any
  // of its frames.
  const media = (): void => {
    if (host.entries.get(id)?.view === view) options.onPageEvent?.(window, id, contents, 'media');
  };
  contents.on('media-started-playing', media);
  contents.on('media-paused', media);
  contents.on('page-title-updated', (_event, title) => {
    const address = contents.getURL();
    if (/^https?:/i.test(address) && !blocked(address)) onVisit?.(address, title, true);
  });
  // Frames that a policy blocks do not start, as in Chrome, also those that a service worker of
  // the site would answer without a request that the request pipeline could stop. A frame of a
  // blocked site stays empty.
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && blocked(event.url)) event.preventDefault();
  });
  // A page that could not be loaded, or whose renderer is gone, shows the shell's page
  // for it instead of an empty one.
  contents.on('did-fail-load', (_event, code, description, failed, isMainFrame) => {
    if (!isMainFrame) return;
    reloadedPast = undefined;
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
    // A page that a policy blocks says so, as in Chrome; the request pipeline asks the policies
    // before the content blocker, which stops pages with the same error.
    if (code === -20 && blocked(failed)) {
      setProblem(host, id, blockedPage(failed));
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
  // A page that a policy blocks never gets past the request pipeline, so only a service worker
  // of the site shows one, from its cache. The tab shows that the site is blocked in its place
  // at once, and loads the page again past the service worker, which a reload that bypasses the
  // cache does: the pipeline stops it, and the tab shows the blocked page in the same entry of
  // its history, as for any other blocked page. Should the page show again all the same, it
  // stays hidden.
  contents.on('did-navigate', (_event, address) => {
    if (blocked(address)) {
      setProblem(host, id, blockedPage(address));
      if (reloadedPast !== address) {
        reloadedPast = address;
        setImmediate(() => {
          if (!contents.isDestroyed()) contents.reloadIgnoringCache();
        });
      }
      return;
    }
    reloadedPast = undefined;
    setProblem(host, id, null);
    // Another document ends a cover over the page, and needs a check of its own; the cover tells
    // the same address loaded again from another one. Its videos are gone, and with them a video
    // in picture in picture.
    if (host.entries.get(id)?.view === view) {
      window.uncover(id, 'navigated');
      window.tabs.update(id, { reader: 'none', pictureInPicture: 'none' });
    }
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
  // A page that a policy blocks gets no icon, which the site would hear of.
  contents.on('page-favicon-updated', (_event, urls) => {
    if (!blocked(contents.getURL())) void loadFavicon(host, id, view, urls);
  });
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
  // In place of its page, the tab shows no icon of a page, no cover, no article, no video and
  // no blocked requests; the page gets a check of its own once it has loaded again.
  if (problem !== null) {
    host.dropFavicon(id);
    window.uncover(id, 'gone');
  }
  window.tabs.update(
    id,
    problem === null
      ? { problem }
      : { problem, reader: 'none', pictureInPicture: 'none', blocked: 0 },
  );
  if (window.isShown(id) && !window.window.isDestroyed()) {
    host.layout();
    // Focusing a view raises its window: a window in the background stays there. A problem
    // of the side of a split view without the focus takes no focus.
    if (id === window.tabs.active?.id && window.window.isFocused()) window.focusContent();
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
  // A cover, such as the reader view, zooms by itself; the site keeps its zoom.
  const cover = host.entries.get(id)?.cover;
  if (cover !== undefined) {
    cover.zoomBy(direction);
    window.tabs.update(id, { zoom: cover.zoom });
    return;
  }
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
 * Takes note of a key that reaches a web page, and no shortcut of the browser took: it lets the
 * page open a window, and one that types text means that the page may hold changes that it has
 * not saved yet, which keep its tab awake.
 * @param host - The window.
 * @param contents - The web page.
 * @param input - The key, as `before-input-event` gives it.
 */
function typed(host: WindowHost, contents: WebContents, input: Input): void {
  if (activates(input)) pageActivations.activate(contents);
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
  // A cover, such as the reader view, is searched in place of the page.
  const contents = host.entries.get(id)?.cover?.view.webContents ?? host.webContentsOf(id);
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

/**
 * Covers the web page of a tab with a view, such as the reader view: while the tab shows, the
 * page's view leaves the window and the cover takes its place, with the keys, the context menu,
 * the mouse's back and forward buttons, find and zoom. It takes the focus that the page had, and
 * that of the window when a person asked for it. The page stays alive; a cover whose renderer is
 * gone ends.
 * @param host - The window.
 * @param id - The tab.
 * @param cover - The view and what it does when it ends.
 * @returns Whether the cover shows; not over a page with a problem or one that is covered.
 */
function coverPage(host: WindowHost, id: TabId, cover: TabCover): boolean {
  const { window } = host;
  const entry = host.entries.get(id);
  if (
    entry === undefined ||
    entry.page !== undefined ||
    entry.cover !== undefined ||
    entry.view.webContents.isDestroyed() ||
    problemOf(host, id) !== null
  ) {
    return false;
  }
  const contents = cover.view.webContents;
  host.follow(id, cover.view);
  contents.on('found-in-page', (_event, result) => {
    const finding = host.findState();
    if (finding === null || id !== window.tabs.active?.id || entry.cover !== cover) return;
    host.setFindState({ ...finding, active: result.activeMatchOrdinal, matches: result.matches });
  });
  contents.on('zoom-changed', (_event, direction) => zoom(host, id, direction === 'in' ? 1 : -1));
  // A cover whose own renderer is gone ends; the page under it is as it was.
  contents.on('render-process-gone', () => {
    if (entry.cover === cover) window.uncover(id, 'closed');
  });
  // Over a page, Chromium follows the mouse's back and forward buttons in the page's history;
  // the cover has none, so they go back and forward in the tab, which ends the cover.
  contents.on('before-mouse-event', (event, mouse) => {
    // Electron names these buttons too, although its types know only three.
    const button: string | undefined = mouse.button;
    if (mouse.type !== 'mouseUp' || entry.cover !== cover) return;
    const action =
      button === 'back'
        ? 'back'
        : button === 'forward' && window.tabs.get(id)?.canGoForward === true
          ? 'forward'
          : undefined;
    if (action === undefined) return;
    event.preventDefault();
    // The cover ends once the event is over, not inside it.
    setImmediate(() => window.run(id, action));
  });
  const focused = entry.view.webContents.isFocused();
  entry.cover = cover;
  // A cover that a person asked for closes a popover over the page, as a page that loads does;
  // one that comes back by itself leaves it, such as the suggestions of an address being typed.
  host.swap(entry.view, cover.view, cover.asked ? 'close' : 'keep');
  // Focusing a view raises its window: a window in the background stays there.
  const asked = cover.asked && window.isShown(id) && id === window.tabs.active?.id;
  if ((focused || asked) && window.window.isFocused()) host.focusView(contents);
  window.tabs.update(id, { zoom: cover.zoom, canGoBack: true });
  findAgain(host, id);
  return true;
}

/**
 * Ends the cover of a tab's page: the page shows again where it was, unchanged, and takes the
 * focus that the cover had.
 * @param host - The window.
 * @param id - The tab.
 * @param end - Why the cover ends.
 */
function uncoverPage(host: WindowHost, id: TabId, end: CoverEnd): void {
  const entry = host.entries.get(id);
  const cover = entry?.cover;
  if (entry === undefined || cover === undefined) return;
  const contents = cover.view.webContents;
  const focused = !contents.isDestroyed() && contents.isFocused();
  entry.cover = undefined;
  host.swap(cover.view, entry.view);
  if (!contents.isDestroyed()) contents.stopFindInPage('clearSelection');
  cover.ended(end);
  const page = entry.view.webContents;
  if (!page.isDestroyed()) {
    if (focused) host.focusView(page);
    host.sync(id, page);
    findAgain(host, id);
  }
}

/** Looks for the text of an open find bar again, in what the tab shows now. */
function findAgain(host: WindowHost, id: TabId): void {
  const finding = host.findState();
  if (finding !== null && finding.query !== '') find(host, id, finding.query, true, false);
}

/** What a tab shows in place of a page that the policies of the organization block. */
function blockedPage(url: string): TabProblem {
  return { kind: 'error', code: 'ERR_BLOCKED_BY_ADMINISTRATOR', url, proceed: false };
}

/** Why a tab of any workspace of the window shows no page, or `null` when it shows one. */
function problemOf(host: WindowHost, id: TabId): TabProblem | null {
  return host.window.tabs.get(id)?.problem ?? null;
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
