import * as v from 'valibot';
import { tabPageOf } from '../../shared/internal-pages.ts';
import { clampRatio } from '../../shared/split-view.ts';
import {
  currentEntry,
  currentOnly,
  parseTabHistory,
  sessionLimits,
  TabHistoryShape,
  trimHistory,
} from '../tabs/tab-history.ts';
import type { TabHistory } from '../tabs/view-history.ts';
import type { WindowBounds } from '../windows/window-bounds.ts';

/** A flag of a tab or a window, such as whether it is pinned. */
const Flag = v.boolean();

/** Where a window was on the screens. */
const Bounds = v.object({
  x: v.pipe(v.number(), v.integer()),
  y: v.pipe(v.number(), v.integer()),
  width: v.pipe(v.number(), v.integer(), v.minValue(1)),
  height: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

/**
 * Two tabs that a window showed side by side: the index of the left one among the tabs of the
 * window, the right one being the next, and the share of the width that the left one took.
 */
const SessionSplit = v.object({
  start: v.pipe(v.number(), v.integer(), v.minValue(0)),
  ratio: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
});

/** Two tabs that a window showed side by side. */
type SessionSplit = v.InferOutput<typeof SessionSplit>;

/**
 * The tabs of the open windows, and where the windows were, as the session keeps them. The
 * format stays at version 1: a field that a later version adds is optional, and objects of
 * version 1 ignore the fields they do not know, so 0.1.0-beta.6 still reads the session of a
 * later version with every tab, such as after a rollback. Since 0.1.0-beta.7, a tab keeps its
 * back and forward history (`history`): its views with their entries, within the limits of
 * the session; and a window whether people put it in full screen (`fullScreen`), which a
 * page in full screen does not count as, and the pairs of tabs that it showed side by side
 * (`splits`). The windows come in the order in which they were used, the window used last at
 * the end.
 */
export const SessionSnapshot = v.object({
  version: v.literal(1),
  windows: v.array(
    v.object({
      tabs: v.array(
        v.object({
          url: v.pipe(v.string(), v.maxLength(8192)),
          title: v.pipe(v.string(), v.maxLength(1024)),
          pinned: v.optional(v.boolean()),
          history: v.optional(TabHistoryShape),
        }),
      ),
      active: v.pipe(v.number(), v.integer(), v.minValue(0)),
      bounds: v.optional(Bounds),
      maximized: v.optional(v.boolean()),
      fullScreen: v.optional(v.boolean()),
      splits: v.optional(v.array(SessionSplit)),
    }),
  ),
});

/** The tabs of the open windows, and where the windows were, as the session keeps them. */
export type SessionSnapshot = v.InferOutput<typeof SessionSnapshot>;

/** The longest title and address a session keeps; longer titles are cut, longer addresses dropped. */
const titleLimit = 1024;
const urlLimit = 8192;

/** One window of a session. */
export type SessionWindow = SessionSnapshot['windows'][number];

/**
 * What a window of a session keeps besides its tabs and its active tab, such as where it
 * was. Every field is optional, so a session without it reads as before.
 */
export type SessionWindowExtras = Omit<SessionWindow, 'tabs' | 'active'>;

/**
 * Tells whether a session keeps a tab: web pages and the browser's own pages that open in
 * tabs, except the setup guide, which opens on its own when it is due.
 * @param url - The tab's address.
 */
export function keepsUrl(url: string): boolean {
  const page = tabPageOf(url);
  if (page !== undefined) return page !== 'setup';
  return url.length <= urlLimit && /^https?:\/\/[^\s]+$/i.test(url);
}

/** A tab as a session keeps it. */
type SessionTab = SessionWindow['tabs'][number];

/** A tab that a session is to keep, with its history as far as it is known. */
export interface KeptTab {
  readonly url: string;
  readonly title: string;
  readonly pinned?: boolean;
  readonly history?: TabHistory | undefined;
}

/**
 * The histories as a session keeps them, by the history of a tab: open tabs give the same
 * history again until their page changes, so each one is cut to the limits only once.
 */
const trimmed = new WeakMap<TabHistory, TabHistory | null>();

/**
 * The history that a session keeps of a tab: within the limits of the session, and only when
 * it shows the tab's address.
 * @param tab - The tab.
 */
function keptHistory(tab: KeptTab): TabHistory | undefined {
  const { history } = tab;
  if (history === undefined) return undefined;
  let kept = trimmed.get(history);
  if (kept === undefined) {
    kept = trimHistory(history, sessionLimits) ?? null;
    trimmed.set(history, kept);
  }
  return kept !== null && currentEntry(kept)?.url === tab.url ? kept : undefined;
}

/**
 * Checks an optional field of a tab or a window of a session on its own, so that a field
 * that cannot be kept costs only itself, and not the tab or the window that holds it.
 * @param schema - What the field must be.
 * @param value - The field, such as what the session file holds for it.
 * @returns The field, or `undefined` when it is missing or not what it must be.
 */
function optionalField<T>(schema: v.GenericSchema<unknown, T>, value: unknown): T | undefined {
  if (value === undefined) return undefined;
  const field = v.safeParse(schema, value);
  return field.success ? field.output : undefined;
}

/**
 * The split views of a window as a session keeps them, with the places of their tabs among
 * the tabs that the session keeps. A pair goes when one of its tabs is not kept, when its tabs
 * are no longer neighbours, when one of them is pinned, or when it shares a tab with a pair
 * before it; a share outside its limits is clamped.
 * @param splits - The pairs, with the places of their left tabs among all tabs of the window.
 * @param places - The place of each tab among the kept tabs, or -1 for a tab that is not kept.
 * @param tabs - The kept tabs.
 */
function keptSplits(
  splits: readonly SessionSplit[],
  places: readonly number[],
  tabs: readonly SessionTab[],
): SessionSplit[] {
  const kept: SessionSplit[] = [];
  for (const pair of splits) {
    const start = places[pair.start] ?? -1;
    const end = places[pair.start + 1] ?? -1;
    const neighbours = start !== -1 && end === start + 1;
    const pinned = tabs[start]?.pinned === true || tabs[end]?.pinned === true;
    const overlaps = kept.some((other) => Math.abs(other.start - start) < 2);
    if (neighbours && !pinned && !overlaps) kept.push({ start, ratio: clampRatio(pair.ratio) });
  }
  return kept;
}

/**
 * The window of a session for some tabs: tabs that a session does not keep are dropped,
 * titles are cut to their limit, and the active tab and the split views move with the tabs
 * that stay.
 * @param tabs - The window's tabs, in order; `undefined` for a tab that could not be read.
 * @param active - Index of the active tab among them, or -1.
 * @param extras - What else the window keeps, such as where it is and its split views, with
 *   the places of their tabs among `tabs`, as far as it is known.
 * @returns The window, or `undefined` when no tab is left.
 */
export function sessionWindow(
  tabs: readonly (KeptTab | undefined)[],
  active: number,
  extras: SessionWindowExtras = {},
): SessionWindow | undefined {
  const kept: SessionTab[] = [];
  const places: number[] = [];
  let keptActive = 0;
  tabs.forEach((tab, index) => {
    places.push(-1);
    if (tab === undefined || !keepsUrl(tab.url)) return;
    places[index] = kept.length;
    if (index === active) keptActive = kept.length;
    const history = keptHistory(tab);
    kept.push({
      url: tab.url,
      title: tab.title.slice(0, titleLimit),
      ...(tab.pinned === true ? { pinned: true } : {}),
      ...(history === undefined ? {} : { history }),
    });
  });
  if (kept.length === 0) return undefined;
  const bounds = optionalField(Bounds, extras.bounds);
  // A session without split views writes no field for them, as before.
  const splits = keptSplits(extras.splits ?? [], places, kept);
  return {
    tabs: kept,
    active: keptActive,
    ...(bounds === undefined ? {} : { bounds }),
    ...(extras.maximized === undefined ? {} : { maximized: extras.maximized }),
    ...(extras.fullScreen === undefined ? {} : { fullScreen: extras.fullScreen }),
    ...(splits.length === 0 ? {} : { splits }),
  };
}

/**
 * A session whose tabs keep only the entry that they show, with its page state, as after the
 * whole history was cleared.
 * @param session - The session.
 */
export function withoutTabHistories(session: SessionSnapshot): SessionSnapshot {
  return {
    version: session.version,
    windows: session.windows.map((window) =>
      Object.assign({}, window, {
        tabs: window.tabs.map((tab) =>
          tab.history === undefined
            ? tab
            : Object.assign({}, tab, { history: currentOnly(tab.history) }),
        ),
      }),
    ),
  };
}

/** Why a start brings the last session back: people asked for it, or the last run crashed. */
export type SessionStart = 'asked' | 'crash';

/**
 * Whether a start brings the last session back. It does when the startup setting or a restart
 * from the settings page asks for it, and after the last run did not quit normally, as after a
 * crash, unless a mandatory policy sets what the browser opens at start, as on shared
 * computers. A recommended policy is a default that people may change, so it does not keep the
 * session away. The setup guide of a new profile opens instead of a session.
 * @param startup - The setting `startup.page`, with whether a mandatory policy sets it.
 * @param start - Whether a restart asks for the session, whether the last run did not quit
 *   normally, and whether the setup guide opens.
 * @returns Why the session comes back, or `undefined` when it does not.
 */
export function sessionStart(
  startup: { readonly value: string; readonly locked: boolean },
  start: { readonly restart: boolean; readonly unclean: boolean; readonly setup: boolean },
): SessionStart | undefined {
  if (start.setup) return undefined;
  if (startup.value === 'restore' || start.restart) return 'asked';
  return start.unclean && !startup.locked ? 'crash' : undefined;
}

/**
 * How many characters of page states a session file keeps at most: 4 MiB. A file that is not
 * larger holds no more; a larger one goes through `fitSession` of `fit-session.ts` first.
 */
export const sessionBudget = 4 * 1024 * 1024;

const StoredSession = v.object({ version: v.literal(1), windows: v.array(v.unknown()) });
/** A window as the session file holds it; its optional fields are read on their own. */
const StoredWindow = v.object({
  tabs: v.array(v.unknown()),
  active: v.number(),
  bounds: v.optional(v.unknown()),
  maximized: v.optional(v.unknown()),
  fullScreen: v.optional(v.unknown()),
  splits: v.optional(v.unknown()),
});
/** A tab as the session file holds it; its optional fields are read on their own. */
const StoredTab = v.object({
  url: v.string(),
  title: v.string(),
  pinned: v.optional(v.unknown()),
  history: v.optional(v.unknown()),
});

/**
 * Reads a stored tab.
 * @param stored - What the session file holds for the tab.
 * @returns The tab, or `undefined` when its address or title cannot be read.
 */
function storedTab(stored: unknown): KeptTab | undefined {
  const tab = v.safeParse(StoredTab, stored);
  if (!tab.success) return undefined;
  const { url, title, pinned } = tab.output;
  const history =
    tab.output.history === undefined ? undefined : parseTabHistory(tab.output.history, url);
  return {
    url,
    title,
    ...(optionalField(Flag, pinned) === true ? { pinned: true } : {}),
    ...(history === undefined ? {} : { history }),
  };
}

/**
 * Reads a stored session. A tab or window that cannot be read is dropped on its own, and so
 * is an optional field of a tab or window, so one damaged entry never costs the rest of the
 * session. Tabs that a session does not keep and windows without tabs are dropped, and the
 * active tab of each window stays within its tabs.
 * @param data - What the session file contained.
 * @returns The session, or `undefined` when nothing is left to restore.
 */
export function parseSession(data: unknown): SessionSnapshot | undefined {
  const session = v.safeParse(StoredSession, data);
  if (!session.success) {
    return undefined;
  }
  const windows = session.output.windows.flatMap((stored): SessionWindow[] => {
    const window = v.safeParse(StoredWindow, stored);
    if (!window.success) return [];
    // A window whose place cannot be read opens where the system puts it.
    const bounds = optionalField(Bounds, window.output.bounds);
    const maximized = optionalField(Flag, window.output.maximized);
    const fullScreen = optionalField(Flag, window.output.fullScreen);
    // Each pair of a split view is read on its own; one that cannot be read costs only itself.
    const splits = optionalField(v.array(v.unknown()), window.output.splits)?.flatMap(
      (pair) => optionalField(SessionSplit, pair) ?? [],
    );
    const kept = sessionWindow(window.output.tabs.map(storedTab), window.output.active, {
      ...(bounds === undefined ? {} : { bounds }),
      ...(maximized === undefined ? {} : { maximized }),
      ...(fullScreen === undefined ? {} : { fullScreen }),
      ...(splits === undefined ? {} : { splits }),
    });
    return kept === undefined ? [] : [kept];
  });
  return windows.length === 0 ? undefined : { version: 1, windows };
}

/** A tab that opens again, such as from a session, with what it showed. */
export interface RestoredTab {
  readonly url: string;
  /** The title that the tab shows until its page loads and reports its own. */
  readonly title: string;
  readonly pinned?: boolean;
  /** The back and forward history of the tab, whose current entry is the tab's address. */
  readonly history?: TabHistory;
}

/**
 * Where a window that opens again was: its bounds on the screens, and whether it was
 * maximized or in full screen.
 */
export interface RestoredPlace {
  readonly bounds?: WindowBounds;
  readonly maximized?: boolean;
  readonly fullScreen?: boolean;
}

/** A window that opens again, such as from a session, with its tabs. */
export interface RestoredWindow {
  /** The tabs, in their order. */
  readonly tabs: readonly RestoredTab[];
  /**
   * Index of the active tab among them, the only tab that loads at once; the first tab is
   * active when the index is out of range.
   */
  readonly active: number;
  /** Where the window was; it opens where the system puts it when the place is empty. */
  readonly place: RestoredPlace;
  /**
   * The pairs of tabs that the window shows side by side: the index of the left tab, the right
   * one being the next, and the share of the width of the left one.
   */
  readonly splits?: readonly { readonly start: number; readonly ratio: number }[];
}

/**
 * The windows of a session as they open again.
 * @param session - The session, as {@link parseSession} read it.
 */
export function restoredWindows(session: SessionSnapshot): RestoredWindow[] {
  return session.windows.map(({ tabs, active, bounds, maximized, fullScreen, splits }) => ({
    tabs: tabs.map(({ url, title, pinned, history }) => ({
      url,
      title,
      pinned: pinned === true,
      ...(history === undefined ? {} : { history }),
    })),
    active,
    place: {
      ...(bounds === undefined ? {} : { bounds }),
      ...(maximized === undefined ? {} : { maximized }),
      ...(fullScreen === undefined ? {} : { fullScreen }),
    },
    ...(splits === undefined ? {} : { splits }),
  }));
}
