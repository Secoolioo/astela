import type { OmniboxTarget } from '../domain/navigation/omnibox.ts';
import {
  suggestionsFor,
  type Suggestion,
  type SuggestionSource,
} from '../domain/navigation/suggestions.ts';
import type { TabId } from '../domain/tabs/tab-service.ts';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../platform/electron/overlay.ts';
import { ChooseSuggestion } from '../shared/ipc/overlay-contracts.ts';
import { ShellCommand } from '../shared/ipc/shell-contracts.ts';
import { existingOverlay, overlayBySender, overlayOf, track, windowOfOverlay } from './overlays.ts';

/** What the suggestions of the address bar need from the browser process. */
export interface SuggestionDependencies {
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  /** The windows, to find the one of a suggestion that was clicked. */
  readonly windows: () => readonly BrowserWindowController[];
  /** What Enter would do with the text. */
  readonly target: (text: string) => Promise<OmniboxTarget | undefined>;
  /** Visited pages that match the text, the most relevant first. */
  readonly history: (text: string) => Promise<readonly SuggestionSource[]>;
  /** The bookmarks. */
  readonly bookmarks: () => readonly SuggestionSource[];
}

/** Where the list goes: below the address bar, as wide as it, and the height of a row. */
export interface SuggestionPlace {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly rowHeight: number;
}

/** Space around the list for its shadow, in CSS pixels. */
const margin = 12;

/** The suggestions that a window shows, and the newest request for them. */
interface Shown {
  items: readonly Suggestion[];
  selected: number;
  request: number;
  /** The tab whose address bar the suggestions are for, where a chosen one opens. */
  tabId: TabId | undefined;
}

const shown = new WeakMap<BrowserWindowController, Shown>();
let connected = false;
let requests = 0;

/**
 * Shows the suggestions for text typed in the address bar of a window, or closes them when
 * there are none. An answer that comes after a newer request is dropped.
 * @param window - The window.
 * @param text - What was typed.
 * @param place - Where the list goes.
 * @param deps - Where suggestions come from.
 * @param tabId - The tab whose address bar the text is typed in; without it, the tab that the
 *   shell asked for last, which the shell does not know yet.
 */
export async function suggest(
  window: BrowserWindowController,
  text: string,
  place: SuggestionPlace,
  deps: SuggestionDependencies,
  tabId?: TabId,
): Promise<void> {
  if (!connected) connect(deps);
  const request = ++requests;
  const state = shown.get(window) ?? { items: [], selected: -1, request, tabId: undefined };
  state.request = request;
  shown.set(window, state);
  const [target, history] = await Promise.all([
    deps.target(text).catch(() => undefined),
    deps.history(text).catch(() => []),
  ]);
  if (state.request !== request || window.window.isDestroyed()) return;
  // The text is for the tab of the address bar, which is not always the active tab: after a
  // click on New tab, before the shell knows the new tab, a page may put another tab in front.
  const own = tabId ?? window.openedByShell ?? window.tabs.active?.id;
  const items = suggestionsFor(text, {
    target,
    tabs: window.tabs.all
      .filter((tab) => tab.id !== own)
      .map(({ id, title, url }) => ({ id, title, url })),
    bookmarks: deps.bookmarks(),
    history,
  });
  if (items.length === 0) {
    close(window);
    return;
  }
  const overlay = overlayOf(window, deps.overlay, deps.router);
  // A question or a popover that the overlay shows keeps it.
  if (overlay.content !== null && overlay.content.kind !== 'suggestions') return;
  state.items = items;
  state.selected = -1;
  state.tabId = own;
  const bounds = {
    x: Math.max(0, place.x - margin),
    y: place.y,
    width: place.width + 2 * margin,
    height: items.length * place.rowHeight + 2 * margin,
  };
  const content = { kind: 'suggestions' as const, items: items.map(view), selected: -1 };
  if (overlay.content?.kind === 'suggestions') overlay.update(content, bounds);
  else overlay.open(content, () => shown.delete(window), bounds);
  track(window, overlay);
}

/**
 * Marks the next or the previous suggestion, as the arrow keys do: past the last or the first
 * one, none is marked, and the next step starts again at the other end.
 * @param window - The window.
 * @param step - 1 for the next suggestion, -1 for the previous one.
 * @returns The place of the marked suggestion, or -1.
 */
export function select(window: BrowserWindowController, step: -1 | 1): number {
  const state = shown.get(window);
  const overlay = state === undefined ? undefined : existingOverlay(window);
  if (state === undefined || overlay?.content?.kind !== 'suggestions') return -1;
  const places = state.items.length + 1;
  state.selected = ((state.selected + 1 + step + places) % places) - 1;
  overlay.update({ kind: 'suggestions', items: state.items.map(view), selected: state.selected });
  return state.selected;
}

/**
 * Opens the marked suggestion, as Enter does.
 * @param window - The window.
 * @returns Whether a suggestion was marked; the shell opens what was typed otherwise.
 */
export function accept(window: BrowserWindowController): boolean {
  const state = shown.get(window);
  const item = state === undefined ? undefined : state.items[state.selected];
  close(window);
  if (item === undefined) return false;
  open(window, item, state?.tabId);
  return true;
}

/**
 * Closes the suggestions of a window.
 * @param window - The window.
 */
export function close(window: BrowserWindowController): void {
  // Answers to requests that are still on their way are dropped.
  const state = shown.get(window);
  if (state !== undefined) state.request = -1;
  shown.delete(window);
  const overlay = existingOverlay(window);
  if (overlay?.content?.kind === 'suggestions') overlay.close();
}

/**
 * Opens a suggestion: the tab it names, or its address in the tab whose address bar it was
 * for, or in the active tab once that tab closed.
 */
function open(window: BrowserWindowController, item: Suggestion, tabId: TabId | undefined): void {
  if (item.kind === 'tab' && item.tabId !== undefined) {
    if (window.tabs.all.some((tab) => tab.id === item.tabId)) window.tabs.activate(item.tabId);
  } else {
    const target = window.tabs.all.find((tab) => tab.id === tabId) ?? window.tabs.active;
    if (target === undefined) window.tabs.open(item.url);
    else window.tabs.navigate(target.id, item.url);
  }
  window.focusContent();
  connectedRouter?.publish(ShellCommand, window.shellContents, 'omnibox.done');
}

let connectedRouter: IpcRouter | undefined;

function connect(deps: SuggestionDependencies): void {
  connected = true;
  connectedRouter = deps.router;
  deps.router.handle(ChooseSuggestion, ({ index }, { sender }) => {
    const overlay = overlayBySender(sender.id);
    const window = overlay === undefined ? undefined : windowOfOverlay(deps.windows(), overlay);
    const state = window === undefined ? undefined : shown.get(window);
    const item = state?.items[index];
    if (window === undefined || item === undefined) return null;
    close(window);
    open(window, item, state?.tabId);
    return null;
  });
}

function view({ kind, title, url }: Suggestion): {
  kind: Suggestion['kind'];
  title: string;
  url: string;
} {
  return { kind, title: title.slice(0, 1024), url: url.slice(0, 8192) };
}
