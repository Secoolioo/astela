import type { WebContents, WebContentsView, WebFrameMain } from 'electron';
import { is } from 'valibot';
import {
  onlyShown,
  type DormantTab,
  type LaterWindowCommand,
  type TabAction,
  type TabEntry,
  type WindowCommands,
  type WindowHost,
} from './browser-window.ts';
import type { CommandContext } from '../../domain/commands/availability.ts';
import { clampRatio } from '../../shared/split-view.ts';
import type { OverlayAnchor } from '../../shared/ipc/overlay-anchor.ts';
import {
  currentEntry,
  currentOnly,
  historyMoves,
  memoryLimits,
  trimHistory,
} from '../../domain/tabs/tab-history.ts';
import { stepHistory } from '../../domain/tabs/history-steps.ts';
import type { SleepMode, TabId } from '../../domain/tabs/tab-service.ts';
import type { TabHistory } from '../../domain/tabs/view-history.ts';
import type { SleepCandidate } from '../../domain/tabs/tab-sleep.ts';
import { pageUrl, tabPageOf, type TabPage } from '../../shared/internal-pages.ts';
import { ShellCommand } from '../../shared/ipc/shell-contracts.ts';

/**
 * The commands of the windows that load later: those of the tabs, the pages and the browser
 * itself, the buttons of the toolbar, the items of the menu of a tab, what decides which
 * commands can run, and what puts tabs to sleep. The window runs the commands that move the
 * focus at once, so that the keys typed right after them follow the focus; this code loads
 * with the first other command, or once the shell of the first window has loaded. A command
 * that comes while it loads waits for it, in its order. The menus, the command palette and the
 * timer of sleeping tabs load only once this code is there (`WindowManager.laterCode`).
 */
export const windowCommands: WindowCommands = {
  run,
  resizeSplit,
  paneOf,
  renewView,
  canSleep,
  sleep,
  sleepCandidates,
  pageAction,
  context,
  openPage,
  forgetHistories,
  tabAction,
  leavePage,
};

/**
 * Runs a window command that does not move the focus at once.
 * @param host - The window.
 * @param command - The command.
 */
function run(host: WindowHost, command: LaterWindowCommand): void {
  const { window, options } = host;
  const active = window.tabs.active;
  // The shortcuts that go to the next tab, or to a tab by its place, count the listed tabs.
  const listed = window.tabs.listed;
  const index = active === undefined ? -1 : listed.indexOf(active);
  switch (command) {
    case 'tab.close':
      if (active !== undefined) window.tabs.close(active.id);
      break;
    case 'tab.reopen':
      window.tabs.reopenClosed();
      break;
    case 'tab.duplicate':
      if (active !== undefined) tabAction(host, active.id, 'duplicate');
      break;
    case 'tab.closeOthers':
      if (active !== undefined) tabAction(host, active.id, 'closeOthers');
      break;
    case 'tab.closeRight':
      if (active !== undefined) tabAction(host, active.id, 'closeRight');
      break;
    case 'tab.next':
    case 'tab.previous': {
      const step = command === 'tab.next' ? 1 : -1;
      const next = listed[(index + step + listed.length) % listed.length];
      if (next !== undefined) window.tabs.activate(next.id);
      break;
    }
    case 'tab.select1':
    case 'tab.select2':
    case 'tab.select3':
    case 'tab.select4':
    case 'tab.select5':
    case 'tab.select6':
    case 'tab.select7':
    case 'tab.select8':
    case 'tab.selectLast': {
      const target =
        command === 'tab.selectLast' ? listed.at(-1) : listed[Number(command.slice(-1)) - 1];
      if (target !== undefined) window.tabs.activate(target.id);
      break;
    }
    case 'tab.moveLeft':
    case 'tab.moveRight':
      if (active !== undefined) window.tabs.step(active.id, command === 'tab.moveRight' ? 1 : -1);
      break;
    case 'tab.pin':
      if (active !== undefined) window.tabs.pin(active.id, !active.pinned);
      break;
    case 'tab.mute':
      if (active !== undefined) window.setMuted(active.id, !active.muted);
      break;
    case 'split.swap':
      if (active !== undefined && window.splitView()) window.tabs.swapSplit(active.id);
      break;
    case 'page.reload':
    case 'page.back':
    case 'page.forward':
      if (active !== undefined) {
        const action =
          command === 'page.reload' ? 'reload' : command === 'page.back' ? 'back' : 'forward';
        window.tabs.run(active.id, action);
      }
      break;
    case 'page.home':
      if (active !== undefined) window.goHome(active.id);
      break;
    case 'focus.nextPane':
    case 'focus.previousPane':
      // The toolbar and the page are the two panes, so either key goes from one to the other.
      // The shell draws the problem of a page in the page's place, and goes between the problem
      // and the address bar itself.
      if (!window.shellContents.isFocused()) window.focusShell('omnibox.focus');
      else if (active !== undefined && active.problem !== null) window.focusShell('focus.pane');
      else window.focusContent(true);
      break;
    case 'settings.open':
      openPage(host, 'settings', '');
      break;
    case 'history.open':
      openPage(host, 'history', '');
      break;
    case 'bookmarks.open':
      openPage(host, 'bookmarks', '');
      break;
    case 'bookmarks.toggleBar':
      options.toggleBookmarksBar?.();
      break;
    case 'toolbar.toggleAutoHide':
      options.toggleAutoHideToolbar?.();
      break;
    case 'downloads.open':
      options.showDownloads?.(window);
      break;
    case 'window.new':
      options.openWindow?.(window);
      break;
    case 'window.newPrivate':
      options.openPrivateWindow?.();
      break;
    case 'bookmark.toggle':
      // Only web pages get bookmarks; the browser's own pages have their own commands. The
      // shell opens the popover of the star at the star, or at the menu button without it.
      if (active !== undefined && /^https?:/i.test(active.url)) {
        options.router.publish(ShellCommand, window.shell.webContents, 'bookmark.edit');
      }
      break;
    case 'zoom.in':
    case 'zoom.out':
    case 'zoom.reset':
      if (active !== undefined) {
        window.zoom(active.id, command === 'zoom.in' ? 1 : command === 'zoom.out' ? -1 : 0);
      }
      break;
    case 'reader.toggle':
      if (active !== undefined) options.onReaderCommand?.(window, active.id);
      break;
    case 'media.pictureInPicture':
      if (active !== undefined) options.onPictureInPictureCommand?.(window, active.id);
      break;
    case 'page.reloadHard':
    case 'page.print':
    case 'page.save':
    case 'page.source':
    case 'devtools.toggle': {
      // These work on web pages; the browser's own pages keep them to themselves.
      const contents = active === undefined ? undefined : host.webContentsOf(active.id);
      if (contents === undefined || active === undefined) break;
      // A cover, such as the reader view, prints what it shows; the other tools are the page's.
      const cover = host.entries.get(active.id)?.cover;
      if (command === 'page.reloadHard') {
        window.uncover(active.id, 'reloaded');
        contents.reloadIgnoringCache();
      } else {
        options.onPageCommand?.(
          window,
          command,
          command === 'page.print' && cover !== undefined ? cover.view.webContents : contents,
        );
      }
      break;
    }
    case 'app.about':
    case 'app.quit':
      options.onAppCommand?.(window, command);
      break;
  }
}

/**
 * Moves the focus on to the first control of the toolbar when Tab leaves the end of a page, or
 * to its last control when Shift+Tab leaves the start, as the page's preload reports. Only the
 * top frame of the page that has the focus hands it on.
 * @param host - The window.
 * @param view - The view of the page.
 * @param frame - The frame that reported it.
 * @param reverse - Whether Shift+Tab left the start.
 */
function leavePage(
  host: WindowHost,
  view: WebContentsView,
  frame: WebFrameMain | null,
  reverse: unknown,
): void {
  if (typeof reverse !== 'boolean' || frame === null || frame.parent !== null) return;
  // A page in full screen covers the toolbar, so the keys go round the page there.
  if (!view.webContents.isFocused() || host.coveringTab() !== undefined) return;
  // A frame of the page that took the focus keeps it.
  const focused = view.webContents.focusedFrame;
  if (focused !== null && focused.parent !== null) return;
  host.window.focusShell(reverse ? 'focus.last' : 'focus.first');
}

/**
 * Whether a tab may go to sleep now: it has a view whose page is not shown, plays no sound, has
 * no video in picture in picture and is not busy otherwise, such as with a camera, a download
 * or a page that it opened. The browser leaves pinned tabs awake, and pages that people typed
 * into since they loaded; people may put them to sleep.
 * @param host - The window.
 * @param id - The tab.
 * @param mode - Whether people ask for it, or the browser does after the tab was not used.
 */
function canSleep(host: WindowHost, id: TabId, mode: SleepMode): boolean {
  const { window } = host;
  const entry = host.entries.get(id);
  const tab = window.tabs.get(id);
  // A page that closed itself left its view without contents.
  const contents: WebContents | undefined = entry?.view.webContents;
  if (entry === undefined || tab === undefined) return false;
  if (contents === undefined || contents.isDestroyed()) return false;
  if (window.isShown(id) || window.tabs.shown.includes(id) || tab.audible) return false;
  if (tab.pictureInPicture === 'open') return false;
  if (mode === 'auto' && tab.pinned) return false;
  return host.options.activity?.()?.awakeReason(contents, mode) === undefined;
}

/**
 * Puts a tab that the window does not show to sleep: its view closes, and it keeps its history
 * with the page states of now, such as the scroll position.
 * @param host - The window.
 * @param id - The tab.
 * @param mode - Whether people ask for it, or the browser does after the tab was not used.
 * @returns Whether the tab goes to sleep; a tab that is busy stays awake.
 */
function sleep(host: WindowHost, id: TabId, mode: SleepMode): boolean {
  const { window } = host;
  const entry = host.entries.get(id);
  const tab = window.tabs.get(id);
  // The browser tries a tab that stays awake again only after another while.
  if (mode === 'auto') host.triedAt.set(id, host.now());
  if (entry === undefined || tab === undefined || !canSleep(host, id, mode)) return false;
  const history = window.historyOf(id, true);
  const kept = history === undefined ? undefined : trimHistory(history, memoryLimits);
  // The page is not asked whether it may close: Electron would give it a user gesture to ask
  // (ADR 0053). A page with changes that people typed stays awake by itself instead.
  putToSleep(host, id, entry, {
    url: (kept === undefined ? undefined : currentEntry(kept)?.url) ?? tab.url,
    history: kept,
  });
  return true;
}

/**
 * The tabs of the window as candidates to sleep, with since when each was not used: since it
 * was last shown, opened, quiet again or busy otherwise.
 * @param host - The window.
 */
function sleepCandidates(host: WindowHost): SleepCandidate[] {
  const { window } = host;
  const activity = host.options.activity?.();
  return window.tabs.allTabs.map((tab) => {
    // A page that closed itself left its view without contents.
    const contents: WebContents | undefined = host.entries.get(tab.id)?.view.webContents;
    const live = contents !== undefined && !contents.isDestroyed();
    const busyAt = live ? activity?.lastBusyAt(contents) : undefined;
    return {
      id: tab.id,
      live,
      shown: window.isShown(tab.id) || window.tabs.shown.includes(tab.id),
      pinned: tab.pinned,
      busy:
        tab.audible ||
        tab.pictureInPicture === 'open' ||
        (live && activity?.busy(contents) === true),
      idleSince: Math.max(host.usedAt.get(tab.id) ?? 0, busyAt ?? 0),
      triedAt: host.triedAt.get(tab.id),
    };
  });
}

/**
 * Runs a history or loading action of a tab. A tab without a view has nothing to stop, and
 * loads only once: at the entry that Back or Forward lead to, and once for a reload.
 * @param host - The window.
 * @param id - The tab.
 * @param action - What to do.
 */
function pageAction(
  host: WindowHost,
  id: TabId,
  action: 'back' | 'forward' | 'reload' | 'stop',
): void {
  const dormant = host.dormant.get(id);
  if (dormant !== undefined) {
    // A tab without a view has nothing to stop. It loads only once: at the entry that Back or
    // Forward lead to, and once for a reload, also in the background.
    if (action === 'stop') return;
    if (action === 'back' || action === 'forward') {
      const stepped =
        dormant.history === undefined
          ? undefined
          : stepHistory(dormant.history, action === 'back' ? -1 : 1);
      const target = stepped === undefined ? undefined : currentEntry(stepped);
      if (stepped === undefined || target === undefined) return;
      host.dormant.set(id, { url: target.url, history: stepped });
    }
    host.wake(id);
    return;
  }
  const entry = host.entries.get(id);
  if (entry === undefined) {
    return;
  }
  // Back ends a cover over the page, such as the reader view, which leaves the page as it was;
  // Forward and Reload end it, and act on the page.
  const covered = entry.cover !== undefined && action !== 'stop';
  if (covered) {
    host.window.uncover(
      id,
      action === 'reload' ? 'reloaded' : action === 'back' ? 'closed' : 'navigated',
    );
  }
  const contents = entry.view.webContents;
  const history = contents.navigationHistory;
  // Entries that go once a load ends lead nowhere.
  const steps = entry.clearing !== true;
  switch (action) {
    case 'back':
      if (covered) break;
      if (steps && history.canGoBack()) history.goBack();
      else host.restore(id, entry, entry.history.goBack(host.snapshot(entry)));
      break;
    case 'forward':
      if (steps && history.canGoForward()) history.goForward();
      else host.restore(id, entry, entry.history.goForward(host.snapshot(entry)));
      break;
    case 'reload':
      contents.reload();
      break;
    case 'stop':
      contents.stop();
      break;
  }
  // Pages take no focus by themselves when they load: the page of the active tab gets it, as
  // after the buttons of the toolbar, also the page that a cover showed over. A window in the
  // background stays there.
  const { window } = host;
  if (action !== 'stop' && id === window.tabs.active?.id && window.window.isFocused()) {
    window.focusContent();
  }
}

/**
 * What decides which commands can run in the window now, for `availableCommands` and
 * `canRun` of `domain/commands/availability.ts`.
 * @param host - The window.
 */
function context(host: WindowHost): CommandContext {
  const { window, options } = host;
  const active = window.tabs.active;
  return {
    tabs: window.tabs.all.map(
      ({ id, url, pinned, canGoBack, canGoForward, muted, group, reader, pictureInPicture }) => ({
        url,
        pinned,
        canGoBack,
        canGoForward,
        muted,
        split: host.sideOf(id),
        group,
        reader,
        pictureInPicture,
      }),
    ),
    activeIndex: active === undefined ? -1 : window.tabs.all.indexOf(active),
    canReopen: window.tabs.canReopen,
    finding: window.findOpen,
    webPage: window.activeShowsWebPage,
    privateWindows: options.privateWindows?.() ?? true,
    developerTools: options.developerTools?.() ?? true,
    palette: options.openPalette !== undefined && (options.commandPalette?.() ?? true),
    splitView: window.splitView(),
    reader: options.reader?.() ?? false,
    pictureInPicture: options.pictureInPicture?.() ?? false,
    workspaces: host.workspaceList()?.length ?? 0,
    autoHide: window.tabStripPosition() === 'top' && options.autoHideToolbar?.().locked === false,
  };
}

/**
 * Shows an internal page: the tab that already shows it, or else the active tab if it
 * shows the new tab page, or else a new tab. A fragment names a place of the page, such as
 * a row of the settings, which the page shows also when its tab is open already.
 * @param host - The window.
 * @param page - The page.
 * @param fragment - `#` and the name of the place, such as `#tabs.position`; without it,
 *   a tab that shows the page stays where it is.
 */
function openPage(host: WindowHost, page: TabPage, fragment: string): void {
  const { tabs } = host.window;
  const url = pageUrl(page) + fragment;
  const open = tabs.all.find((tab) => tabPageOf(tab.url) === page);
  const active = tabs.active;
  if (open !== undefined) {
    tabs.activate(open.id);
    if (fragment === '') return;
    // A page sees no change of its address when it shows that address already.
    if (open.url === url) revealPlace(host, open.id, page, fragment);
    else tabs.navigate(open.id, url);
  } else if (active !== undefined && active.url === host.options.newTabUrl) {
    tabs.navigate(active.id, url);
  } else {
    tabs.open(url);
  }
}

/**
 * Tells the settings page of a tab to show the row or the section that its address names
 * once more, and gives the page the focus.
 * @param host - The window.
 * @param id - The tab.
 * @param page - The page that the tab shows.
 * @param fragment - `#` and the name of the place.
 */
function revealPlace(host: WindowHost, id: TabId, page: TabPage, fragment: string): void {
  const { options } = host;
  const contents = host.entries.get(id)?.view.webContents;
  if (page !== 'settings' || contents === undefined || contents.isDestroyed()) return;
  let place: string;
  try {
    place = decodeURIComponent(fragment.slice(1));
  } catch {
    return;
  }
  contents.focus();
  // The contracts of the settings page load with it, not with the window.
  void import('../../shared/ipc/settings-contracts.ts')
    .then(({ SettingsReveal }) => {
      // Only the name of a row or a section goes to the page.
      const payload = { id: place };
      if (is(SettingsReveal.payload, payload)) {
        options.router.publish(SettingsReveal, contents, payload);
      }
    })
    .catch((error: unknown) =>
      options.logger.debug('The settings did not show their row', { error: String(error) }),
    );
}

/**
 * Forgets the back and forward history of every tab, as when the whole history is cleared:
 * each tab keeps only the entry that it shows.
 * @param host - The window.
 */
function forgetHistories(host: WindowHost): void {
  for (const [id, entry] of host.entries) {
    entry.history.clear();
    entry.cache = undefined;
    const contents: WebContents | undefined = entry.view.webContents;
    if (contents === undefined || contents.isDestroyed()) continue;
    // A view that waits to restore its history restores only what it shows.
    const job = host.waiting.get(contents);
    if (job?.restore !== undefined) job.restore = onlyShown(job.restore);
    entry.clearing = true;
    host.sync(id, contents);
  }
  for (const [id, dormant] of host.dormant) {
    if (dormant.history !== undefined) {
      host.dormant.set(id, { url: dormant.url, history: currentOnly(dormant.history) });
    }
    host.window.tabs.update(id, { canGoBack: false, canGoForward: false });
  }
}

/**
 * Runs an item of the menu of a tab.
 * @param host - The window.
 * @param id - The tab.
 * @param action - What to do with it.
 */
function tabAction(host: WindowHost, id: TabId, action: TabAction): void {
  const { tabs } = host.window;
  const tab = tabs.get(id);
  if (tab === undefined) return;
  switch (action) {
    case 'newTabRight':
      tabs.open(host.options.newTabUrl, { after: id });
      break;
    case 'duplicate':
      tabs.open(tab.url, { after: id, title: tab.title });
      break;
    case 'close':
      tabs.close(id);
      break;
    case 'closeOthers':
    case 'closeRight': {
      // The other tab of a split view stays with the tab, and pinned tabs stay; they are
      // closed one by one. The tabs to the right start after the split view.
      const unit = tabs.unitOf(id);
      const end = Math.max(
        ...unit.map((member) => tabs.all.findIndex((other) => other.id === member)),
      );
      const closing = tabs.all.filter(
        (other, place) =>
          !unit.includes(other.id) && !other.pinned && (action === 'closeOthers' || place > end),
      );
      if (closing.length > 0) tabs.activate(id);
      for (const other of closing) tabs.close(other.id);
      break;
    }
    case 'split': {
      // The tab joins the active tab on its side; the menu of the active tab opens a new tab
      // beside it.
      const active = tabs.active;
      if (!host.window.splitView() || active === undefined) break;
      if (active.id === id) {
        if (tabs.splitOf(id) === undefined && !tab.pinned) host.splitWithNewTab(id);
      } else if (tabs.split(active.id, id)) {
        tabs.activate(id);
      }
      break;
    }
    case 'endSplit':
      tabs.unsplit(id);
      break;
    case 'swapSplit':
      tabs.swapSplit(id);
      break;
  }
}

/**
 * Moves the divider of the split view that the content area shows. While it moves, only the
 * pages follow; the share counts, for the state of the shell and the session, once the
 * divider is let go.
 * @param host - The window.
 * @param tabId - A tab of the split view.
 * @param ratio - The share of the left side.
 * @param done - Whether the divider was let go, or moved by a key.
 */
function resizeSplit(host: WindowHost, tabId: TabId, ratio: number, done: boolean): void {
  const { tabs } = host.window;
  const pair = tabs.splitOf(tabId);
  const shown = host.shownSplit();
  if (pair === undefined || shown?.start !== pair.start || shown.end !== pair.end) return;
  if (!done) {
    host.setPreviewRatio(clampRatio(ratio));
    host.layout();
    return;
  }
  host.setPreviewRatio(undefined);
  tabs.resizeSplit(tabId, ratio);
  host.layout();
}

/**
 * Where the page of a tab lies in the window while the content area shows a split view, so
 * that a question of the page shows over its side.
 * @param host - The window.
 * @param contents - The page.
 * @returns The bounds of its side, or `undefined` while the content area shows one page.
 */
function paneOf(host: WindowHost, contents: WebContents): OverlayAnchor | undefined {
  const id = host.window.tabIdOf(contents);
  const entry = id === undefined ? undefined : host.entries.get(id);
  if (entry === undefined || host.shown.length < 2 || host.coveringTab() !== undefined) {
    return undefined;
  }
  const view = host.shownViewOf(entry);
  if (!host.shown.includes(view)) return undefined;
  const { x, y, width, height } = view.getBounds();
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(0, width),
    height: Math.max(0, height),
  };
}

/**
 * Closes the view of a tab that the window does not show, which gets a new one once it shows,
 * such as in the partition of the workspace that it moved into: it keeps the entries of its
 * back and forward history, without the states of their pages, which belong to the partition
 * that it leaves.
 * @param host - The window.
 * @param id - The tab.
 * @param history - The history of the tab, whose entries the new view loads.
 */
function renewView(host: WindowHost, id: TabId, history: TabHistory | undefined): void {
  const { tabs } = host.window;
  const tab = tabs.get(id);
  if (tab === undefined || tabs.shown.includes(id)) return;
  const plain = history && trimHistory(history, { ...memoryLimits, pageState: 0, tabPageState: 0 });
  const dormant = { url: (plain && currentEntry(plain)?.url) ?? tab.url, history: plain };
  const entry = host.entries.get(id);
  if (entry === undefined) host.dormant.set(id, dormant);
  else putToSleep(host, id, entry, dormant);
}

/**
 * Closes the view of a tab, which keeps its history until it wakes, and shows the tab as a tab
 * that sleeps, with its title and icon. It has no page, and so no article and no video, until
 * it has woken and its page was checked. A reader view over its page ends as one that comes
 * back once the tab has woken.
 * @param host - The window.
 * @param id - The tab.
 * @param entry - The view of the tab.
 * @param dormant - What the tab keeps until it wakes.
 */
function putToSleep(host: WindowHost, id: TabId, entry: TabEntry, dormant: DormantTab): void {
  host.window.uncover(id, 'slept');
  host.dropView(id, entry);
  host.dormant.set(id, dormant);
  const moves =
    dormant.history === undefined ? { back: false, forward: false } : historyMoves(dormant.history);
  host.window.tabs.update(id, {
    sleeping: true,
    loading: false,
    audible: false,
    problem: null,
    reader: 'none',
    pictureInPicture: 'none',
    canGoBack: moves.back,
    canGoForward: moves.forward,
  });
}
