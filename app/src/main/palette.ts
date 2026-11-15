import type { WebContents } from 'electron';
import { availableCommands, canRun } from '../domain/commands/availability.ts';
import type { OmniboxTarget } from '../domain/navigation/omnibox.ts';
import {
  paletteResults,
  type PalettePage,
  type PaletteResult,
  type PaletteScope,
  type PaletteSources,
  type PaletteTab,
} from '../domain/palette/results.ts';
import type { TypedText } from '../domain/palette/held-typing.ts';
import type {
  BrowserWindowController,
  PaletteOpening,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import {
  ChoosePaletteItem,
  GetPaletteFavicon,
  OpenPaletteSetting,
  PaletteShortcut,
  QueryPalette,
  RunPaletteCommand,
  type CommandPalette,
  type PaletteItem,
} from '../shared/ipc/overlay-contracts.ts';
import { shortcutsOf, type WindowCommand } from '../shared/shortcuts.ts';
import { overlayBySender, overlayOf, track, windowOfOverlay } from './overlays.ts';

/** What the command palette needs from the browser process. */
export interface PaletteDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  /** The address of the new tab page, whose tab a page from the palette opens in. */
  readonly newTabUrl: string;
  /** What the address bar would do with the text: open an address or search. */
  readonly target: (text: string) => Promise<OmniboxTarget | undefined>;
  /** Visited pages that match the text, the newest first, at most a number of them. */
  readonly history: (text: string, limit: number) => Promise<readonly PalettePage[]>;
  /** The bookmarks, which load with the first search for them. */
  readonly bookmarks: () => Promise<readonly PalettePage[]>;
  /** The keys of the settings that the settings page does not offer on this system. */
  readonly absent: readonly string[];
}

/** A palette that an overlay shows, with the answers that its page may choose from. */
interface PaletteState {
  readonly session: number;
  /** The last answers, by their number, with what each of their results stands for. */
  readonly answers: Map<number, readonly PaletteResult[]>;
  /** Whether the page asked for results, which hands it the keys that were held. */
  queried: boolean;
}

/** How many answers a palette keeps, for a choice in an answer that was just replaced. */
const keptAnswers = 4;
/** How many visited pages the browser process reads, before it leaves out repeated addresses. */
const historyReads = { all: 12, history: 60 } as const;
/** The content of the overlay that a site's question shows, which the palette never replaces. */
const questions = new Set<string>(['permission', 'login', 'screen']);
/** An answer that names nothing, for a palette that closed or opened again meanwhile. */
const noAnswer = { answer: 0, typed: '', enter: false, items: [] } as const;

const states = new WeakMap<WindowOverlay, PaletteState>();
/** The commands that the palette ran last, the newest first, kept only while the browser runs. */
const recent: WindowCommand[] = [];
let sessions = 0;
let answers = 0;
let dependencies: PaletteDependencies | undefined;
const watched = new WeakSet<WebContents>();

/**
 * Opens the command palette of a window in the overlay, at the top of its pages, with
 * everything or the open tabs. The keys typed since the shortcut go to its field when its page
 * asks for its first results. A palette that shows already hears of the shortcut: its own
 * closes it, the other one switches the scope. A site's question that the overlay shows stays,
 * and Escape typed before the palette showed opens nothing. The first call connects the
 * channels of the palette.
 * @param window - The window.
 * @param scope - What the palette searches.
 * @param deps - What the palette needs.
 */
export function openPalette(
  window: BrowserWindowController,
  scope: PaletteOpening,
  deps: PaletteDependencies,
): void {
  if (dependencies === undefined) connect(deps);
  if (window.window.isDestroyed() || window.typingCancelled) {
    window.releaseTyping();
    return;
  }
  const overlay = overlayOf(window, deps.overlay, deps.router);
  const shown = overlay.content;
  if (shown !== null && questions.has(shown.kind)) {
    window.releaseTyping();
    return;
  }
  const open = states.get(overlay);
  if (shown?.kind === 'palette' && open !== undefined) {
    // A palette whose page did not ask yet takes the keys that were held with its first request.
    if (open.queried) window.releaseTyping();
    publishShortcut(overlay, scope, deps.router);
    return;
  }
  const state: PaletteState = { session: ++sessions, answers: new Map(), queried: false };
  overlay.open(contentOf(window, scope, state.session, deps), {
    // What was typed into it stays when a site asks for a permission.
    yieldsToQuestions: false,
    keys: {
      // The page closes the palette, also while an input method composes text in its field.
      escape: 'page',
      // Its own shortcuts close it or switch the scope; every other one closes it and runs.
      onCommand: (command) => {
        if (command !== 'palette.open' && command !== 'tabs.search') return false;
        publishShortcut(overlay, command === 'tabs.search' ? 'tabs' : 'all', deps.router);
        return true;
      },
    },
    onClose: () => {
      if (states.get(overlay) === state) states.delete(overlay);
      window.releaseTyping();
    },
  });
  states.set(overlay, state);
  track(window, overlay);
  closeOnBlur(overlay);
}

/** Tells the page of a palette that one of its shortcuts was pressed. */
function publishShortcut(overlay: WindowOverlay, scope: PaletteOpening, router: IpcRouter): void {
  const contents = overlay.contents;
  if (contents !== undefined && !contents.isDestroyed()) {
    router.publish(PaletteShortcut, contents, scope);
  }
}

/** Closes the palette when its page loses the focus, as when the window loses it. */
function closeOnBlur(overlay: WindowOverlay): void {
  const contents = overlay.contents;
  if (contents === undefined || watched.has(contents)) return;
  watched.add(contents);
  contents.on('blur', () => {
    if (overlay.content?.kind === 'palette') overlay.close();
  });
}

/** The content of the overlay for the palette of a window. */
function contentOf(
  window: BrowserWindowController,
  scope: PaletteOpening,
  session: number,
  deps: PaletteDependencies,
): CommandPalette {
  const table = window.shortcuts();
  // The palette is open already, so its own command is no result.
  const commands: WindowCommand[] = availableCommands(window.commandContext()).filter(
    (command) => command !== 'palette.open',
  );
  const area = window.contentArea();
  const side = window.tabStripPosition();
  return {
    kind: 'palette',
    session,
    scope,
    area: {
      x: coordinate(area.x),
      y: coordinate(area.y),
      width: coordinate(area.width),
      height: coordinate(area.height),
    },
    mac: process.platform === 'darwin',
    vertical: side === 'left' || side === 'right',
    commands: commands.map((id) => ({ id, shortcuts: shortcutsOf(table, id).slice(0, 4) })),
    recent: recent.filter((command) => commands.includes(command)),
    absent: deps.absent.slice(0, 100),
  };
}

/** A coordinate of the window as the contracts of the overlay take it, in whole pixels. */
function coordinate(value: number): number {
  return Math.min(20_000, Math.max(0, Math.round(value)));
}

/** Remembers a command that the palette ran, for its first results the next time. */
function remember(command: WindowCommand): void {
  const index = recent.indexOf(command);
  if (index !== -1) recent.splice(index, 1);
  recent.unshift(command);
  recent.length = Math.min(recent.length, 5);
}

/**
 * The open tabs of the windows of the same kind as a window's, private or not: those of the
 * window first, in the order of its tab strip, then those of the other windows, the window
 * used last first. The tabs of private windows never show in a regular one, and the other way
 * round.
 */
function tabsOf(window: BrowserWindowController, windows: WindowManager): PaletteTab[] {
  const active = window.tabs.active?.id;
  const others = windows.byFocus.filter(
    (other) =>
      other !== window &&
      other.isPrivate === window.isPrivate &&
      !other.closing &&
      !other.window.isDestroyed(),
  );
  return [window, ...others].flatMap((owner) =>
    owner.tabs.all.map((tab): PaletteTab => ({
      windowId: owner.window.id,
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      place: owner !== window ? 'other' : tab.id === active ? 'current' : 'window',
    })),
  );
}

/**
 * Where the results for some text come from. Tab search never reads the history, so it does
 * not start the data service; the bookmarks and the history are read only for a search of
 * everything with text, and for their own scopes.
 */
async function sourcesOf(
  window: BrowserWindowController,
  scope: PaletteScope,
  text: string,
  deps: PaletteDependencies,
): Promise<PaletteSources> {
  const pages = scope === 'all' && text.trim() !== '';
  const [bookmarks, history, target] = await Promise.all([
    pages || scope === 'bookmarks' ? deps.bookmarks().catch(() => []) : [],
    pages || scope === 'history'
      ? deps
          .history(text, scope === 'history' ? historyReads.history : historyReads.all)
          .catch(() => [])
      : [],
    pages ? deps.target(text).catch(() => undefined) : undefined,
  ]);
  const tabs = scope === 'all' || scope === 'tabs' ? tabsOf(window, deps.windows) : [];
  return { tabs, bookmarks, history, target };
}

/** A result as the palette's page gets it, without the ids that only the browser process needs. */
function view(result: PaletteResult): PaletteItem {
  if (result.kind === 'tab') {
    return {
      kind: 'tab',
      title: result.tab.title.slice(0, 1024),
      url: result.tab.url.slice(0, 2048),
      favicon: result.tab.favicon,
      place: result.tab.place,
    };
  }
  if (result.kind === 'search') {
    return { kind: 'search', query: result.query.slice(0, 200), host: hostOf(result.url) };
  }
  if (result.kind === 'url') return { kind: 'url', url: result.url.slice(0, 2048) };
  return { kind: result.kind, title: result.title.slice(0, 1024), url: result.url.slice(0, 2048) };
}

/** The host of an address, such as that of a search engine. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.slice(0, 253);
  } catch {
    return '';
  }
}

/**
 * Shows an open tab: in its window, which comes to the front, out of the dock or the task bar
 * if need be, and whose page gets the focus. A tab that closed meanwhile shows nothing. Every
 * choice of a tab takes this way, so that a tab of another workspace or of a collapsed group
 * can show first once there are such.
 */
function revealTab(from: BrowserWindowController, tab: PaletteTab, windows: WindowManager): void {
  const target = windows.all.find(
    (window) =>
      window.window.id === tab.windowId &&
      window.isPrivate === from.isPrivate &&
      !window.window.isDestroyed(),
  );
  if (target === undefined || !target.tabs.all.some((open) => open.id === tab.tabId)) return;
  target.tabs.activate(tab.tabId);
  if (target !== from) {
    if (target.window.isMinimized()) target.window.restore();
    target.window.focus();
  }
  target.focusContent();
}

/**
 * Opens a page, a search or an address from the palette: in a new tab after the active one,
 * or in the tab of the new tab page, which waits for an address.
 */
function openAddress(window: BrowserWindowController, url: string, newTabUrl: string): void {
  const active = window.tabs.active;
  if (active?.url === newTabUrl) window.tabs.navigate(active.id, url);
  else window.tabs.open(url, active === undefined ? {} : { after: active.id });
  window.focusContent();
}

function connect(deps: PaletteDependencies): void {
  dependencies = deps;
  const { router, windows } = deps;
  /** The palette that the page of an overlay shows, with its window. */
  const paletteOf = (
    sender: number,
  ):
    | { overlay: WindowOverlay; state: PaletteState; window: BrowserWindowController }
    | undefined => {
    const overlay = overlayBySender(sender);
    const state = overlay === undefined ? undefined : states.get(overlay);
    const window = overlay === undefined ? undefined : windowOfOverlay(windows.all, overlay);
    if (overlay?.content?.kind !== 'palette' || state === undefined || window === undefined) {
      return undefined;
    }
    return { overlay, state, window };
  };
  router.handle(QueryPalette, async ({ session, scope, text }, { sender }) => {
    const open = paletteOf(sender.id);
    if (open?.state.session !== session) return noAnswer;
    const { overlay, state, window } = open;
    // The first request of the palette gets what was typed before its field was ready.
    state.queried = true;
    const held: TypedText = window.releaseTyping();
    if (held.cancelled) {
      overlay.close();
      return noAnswer;
    }
    const full = (held.text + text).slice(0, 200);
    const results = paletteResults(full, scope, await sourcesOf(window, scope, full, deps));
    // The palette may have closed while the history was read.
    if (states.get(overlay) !== state || window.window.isDestroyed()) {
      return { ...noAnswer, typed: held.text, enter: held.enter };
    }
    const answer = ++answers;
    state.answers.set(answer, results);
    for (const old of state.answers.keys()) {
      if (state.answers.size <= keptAnswers) break;
      state.answers.delete(old);
    }
    return { answer, typed: held.text, enter: held.enter, items: results.map(view) };
  });
  router.handle(ChoosePaletteItem, ({ answer, index }, { sender }) => {
    const open = paletteOf(sender.id);
    const result = open?.state.answers.get(answer)?.[index];
    if (open === undefined || result === undefined) return null;
    open.overlay.close();
    if (result.kind === 'tab') revealTab(open.window, result.tab, windows);
    else openAddress(open.window, result.url, deps.newTabUrl);
    return null;
  });
  router.handle(RunPaletteCommand, ({ command }, { sender }) => {
    const open = paletteOf(sender.id);
    // The window may have changed since the palette opened.
    if (
      open === undefined ||
      command === 'palette.open' ||
      !canRun(command, open.window.commandContext())
    ) {
      return null;
    }
    // The focus goes back first, so that a command that moves it, such as a new tab, wins.
    open.overlay.close();
    remember(command);
    open.window.execute(command);
    return null;
  });
  router.handle(OpenPaletteSetting, ({ id }, { sender }) => {
    const open = paletteOf(sender.id);
    if (open === undefined) return null;
    open.overlay.close();
    // The settings page only looks the row up; it shows it also when its tab shows it already.
    open.window.openPage('settings', `#${encodeURIComponent(id)}`);
    return null;
  });
  router.handle(GetPaletteFavicon, async ({ key }, { sender }) => {
    const open = paletteOf(sender.id);
    if (open === undefined) return null;
    // The icons of private and regular windows stay apart.
    for (const window of windows.all) {
      if (window.isPrivate !== open.window.isPrivate || window.window.isDestroyed()) continue;
      const icon = await window.favicon(key);
      if (icon !== undefined) return icon;
    }
    return null;
  });
}
