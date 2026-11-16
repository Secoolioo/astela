import * as v from 'valibot';
import { tabPageOf, type TabPage } from '../../shared/internal-pages.ts';
import type { HistoryEntry, TabHistory, ViewSnapshot } from './view-history.ts';

/**
 * The kind of view that shows an address: a web view for web pages, or the view of one of the
 * browser's own pages, which only that page may use (ADR 0026).
 */
export type ViewKind = 'web' | TabPage;

/** The longest address and title that a tab's history keeps; longer titles are cut. */
const urlLimit = 8192;
const titleLimit = 1024;

/**
 * The kind of view that shows an address in a tab's history: `web` for web pages, the page
 * for the browser's own pages, and none for the setup guide, which opens on its own when it is
 * due, and for every other address, such as `about:blank`, `data:` or `file:`.
 * @param url - The address.
 */
export function viewKindOf(url: string): ViewKind | undefined {
  if (url.length > urlLimit) return undefined;
  const page = tabPageOf(url);
  if (page !== undefined) return page === 'setup' ? undefined : page;
  return /^https?:\/\/[^\s]+$/i.test(url) ? 'web' : undefined;
}

/**
 * The entry that a tab shows.
 * @param history - The tab's history.
 */
export function currentEntry(history: TabHistory): HistoryEntry | undefined {
  const view = history.views[history.view];
  return view?.entries[view.index];
}

/**
 * Whether a tab can go back and forward in its history.
 * @param history - The tab's history.
 */
export function historyMoves(history: TabHistory): { back: boolean; forward: boolean } {
  const view = history.views[history.view];
  if (view === undefined) return { back: false, forward: false };
  return {
    back: history.view > 0 || view.index > 0,
    forward: history.view < history.views.length - 1 || view.index < view.entries.length - 1,
  };
}

/**
 * The history after a step back or forward, as Back and Forward take it: within the view, or
 * into the view before or after it, at the entry that view showed.
 * @param history - The tab's history.
 * @param direction - -1 for Back, 1 for Forward.
 * @returns The history, or `undefined` at its start or its end.
 */
export function stepHistory(history: TabHistory, direction: -1 | 1): TabHistory | undefined {
  const view = history.views[history.view];
  if (view === undefined) return undefined;
  const index = view.index + direction;
  if (index >= 0 && index < view.entries.length) {
    return { views: history.views.with(history.view, { ...view, index }), view: history.view };
  }
  const next = history.view + direction;
  return next >= 0 && next < history.views.length ? { ...history, view: next } : undefined;
}

/**
 * The history with nothing but the entry that the tab shows, as after the whole history was
 * cleared.
 * @param history - The tab's history.
 */
export function currentOnly(history: TabHistory): TabHistory {
  const entry = currentEntry(history);
  return entry === undefined ? history : { views: [{ entries: [entry], index: 0 }], view: 0 };
}

/** How much of a tab's history is kept. */
export interface HistoryLimits {
  /** Entries before the current one, counted across views. */
  readonly back: number;
  /** Entries after the current one, counted across views. */
  readonly forward: number;
  /** The longest page state of an entry, in characters of its base64 text. */
  readonly pageState: number;
  /** The page states of all entries of the tab together, in characters. */
  readonly tabPageState: number;
}

/** What the session keeps of the history of each tab. */
export const sessionLimits: HistoryLimits = {
  back: 24,
  forward: 24,
  pageState: 32 * 1024,
  tabPageState: 128 * 1024,
};

/** What the browser keeps in memory of the history of a tab without a view. */
export const memoryLimits: HistoryLimits = {
  back: 49,
  forward: 49,
  pageState: 512 * 1024,
  tabPageState: 1024 * 1024,
};

/** A history whose views and entries may be missing, such as one that a file holds. */
interface LooseHistory {
  readonly views: readonly (LooseView | undefined)[];
  readonly view: number;
}

interface LooseView {
  readonly entries: readonly (LooseEntry | undefined)[];
  readonly index: number;
}

interface LooseEntry {
  readonly url: string;
  readonly title: string;
  readonly pageState?: unknown;
}

/** An entry that is kept, with its place in the history. */
interface Kept {
  readonly view: number;
  readonly index: number;
  readonly entry: LooseEntry;
}

/** Whether a page state is base64 text, as Chromium gives it. */
function isBase64(text: string): boolean {
  return text.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(text);
}

/**
 * The histories that {@link trimHistory} gave, with the limits that they are within, so that a
 * history that is cut once, such as one read from the session file, is not cut again.
 */
const fitted = new WeakMap<
  object,
  { readonly limits: HistoryLimits; readonly history: TabHistory }
>();

/** Whether limits keep nothing more than others do. */
function within(limits: HistoryLimits, others: HistoryLimits): boolean {
  return (
    limits.back <= others.back &&
    limits.forward <= others.forward &&
    limits.pageState <= others.pageState &&
    limits.tabPageState <= others.tabPageState
  );
}

/**
 * The part of a tab's history that is kept within limits. Only entries of the kind of their
 * view stay: a web view keeps web pages, and the view of one of the browser's own pages keeps
 * that page, so no entry can reach a view of another kind, whatever a file holds; the kind of
 * a view is that of the entry it shows. Entries with long addresses and the setup guide go,
 * and so do views without entries. Of the rest, the entries within the limits before and
 * after the current one stay, counted across views. Titles are cut to their limit. Page
 * states stay only as base64 text within the limit of an entry, from the current entry
 * outward, the earlier entry before the later one at the same distance, as long as they fit
 * into the limit of the tab; one that does not fit goes, and the next one may still fit. A
 * history that this function gave within the same limits or narrower ones comes back as it is.
 * @param history - The tab's history.
 * @param limits - What is kept.
 * @returns The history, or `undefined` when the entry that the tab shows cannot be kept.
 */
export function trimHistory(history: LooseHistory, limits: HistoryLimits): TabHistory | undefined {
  const known = fitted.get(history);
  if (known !== undefined && within(known.limits, limits)) return known.history;
  const views: Kept[][] = history.views.map((view, at) => {
    const shown = view?.entries[view.index];
    const kind = shown === undefined ? undefined : viewKindOf(shown.url);
    if (view === undefined || kind === undefined) return [];
    return view.entries.flatMap((entry, index) =>
      entry !== undefined && viewKindOf(entry.url) === kind ? [{ view: at, index, entry }] : [],
    );
  });
  const flat = views.flat();
  const shownView = history.views[history.view];
  const current = flat.findIndex(
    (kept) => kept.view === history.view && kept.index === shownView?.index,
  );
  if (current === -1) return undefined;
  const start = Math.max(0, current - limits.back);
  const near = new Set(flat.slice(start, current + limits.forward + 1));
  // Page states from the current entry outward, as long as the tab has room for them.
  const order: Kept[] = [];
  for (let distance = 0; order.length < near.size; distance += 1) {
    for (const position of distance === 0 ? [current] : [current - distance, current + distance]) {
      const kept = flat[position];
      if (kept !== undefined && near.has(kept)) order.push(kept);
    }
  }
  const states = new Map<Kept, string>();
  let room = limits.tabPageState;
  for (const kept of order) {
    const state = kept.entry.pageState;
    if (typeof state !== 'string' || state === '' || state.length > limits.pageState) continue;
    if (state.length > room || !isBase64(state)) continue;
    states.set(kept, state);
    room -= state.length;
  }
  const result: ViewSnapshot[] = [];
  let shown = 0;
  views.forEach((list, at) => {
    const entries = list.filter((kept) => near.has(kept));
    if (entries.length === 0) return;
    const original = history.views[at]?.index ?? 0;
    // A view whose entry went keeps the nearest of the rest: after it for a view before the
    // current one, whose earliest entries went, and before it for a later one.
    const found = entries.findIndex((kept) => kept.index === original);
    const index = found !== -1 ? found : at < history.view ? 0 : entries.length - 1;
    if (at === history.view) shown = result.length;
    result.push({
      entries: entries.map((kept): HistoryEntry => {
        const state = states.get(kept);
        const { url } = kept.entry;
        const title = kept.entry.title.slice(0, titleLimit);
        return state === undefined ? { url, title } : { url, title, pageState: state };
      }),
      index,
    });
  });
  const trimmed = { views: result, view: shown };
  fitted.set(trimmed, { limits, history: trimmed });
  return trimmed;
}

/** An entry as a file holds it; its page state is checked on its own. */
const StoredEntry = v.object({
  url: v.string(),
  title: v.string(),
  pageState: v.optional(v.unknown()),
});
/** A view as a file holds it. */
const StoredView = v.object({
  entries: v.array(v.unknown()),
  index: v.pipe(v.number(), v.integer()),
});
/** A tab's history as a file holds it. */
const StoredHistory = v.object({
  views: v.array(v.unknown()),
  view: v.pipe(v.number(), v.integer()),
});

/**
 * Reads the history of a tab that a session file holds. Views and entries that cannot be read
 * are dropped on their own; the rest is kept within {@link sessionLimits}.
 * @param data - What the file holds for the history.
 * @param url - The address of the tab, which the entry that the history shows must have.
 * @returns The history, or `undefined` when none can be read or it shows another address.
 */
export function parseTabHistory(data: unknown, url: string): TabHistory | undefined {
  const history = v.safeParse(StoredHistory, data);
  if (!history.success) return undefined;
  const views = history.output.views.map((stored): LooseView | undefined => {
    const view = v.safeParse(StoredView, stored);
    if (!view.success) return undefined;
    return {
      entries: view.output.entries.map((entry) => {
        const parsed = v.safeParse(StoredEntry, entry);
        return parsed.success ? parsed.output : undefined;
      }),
      index: view.output.index,
    };
  });
  const kept = trimHistory({ views, view: history.output.view }, sessionLimits);
  return kept !== undefined && currentEntry(kept)?.url === url ? kept : undefined;
}

/** The form of a tab's history in a session, for the type of the session. */
export const TabHistoryShape = v.custom<TabHistory>(
  (input) => v.is(StoredHistory, input),
  'A history of a tab',
);
