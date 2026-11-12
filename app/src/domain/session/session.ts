import * as v from 'valibot';
import { tabPageOf } from '../../shared/internal-pages.ts';
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
 * The tabs of the open windows, and where the windows were, as the session keeps them. The
 * format stays at version 1: a field that a later version adds is optional, and objects of
 * version 1 ignore the fields they do not know, so 0.1.0-beta.6 still reads the session of a
 * later version with every tab, such as after a rollback.
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
        }),
      ),
      active: v.pipe(v.number(), v.integer(), v.minValue(0)),
      bounds: v.optional(Bounds),
      maximized: v.optional(v.boolean()),
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
 * The window of a session for some tabs: tabs that a session does not keep are dropped,
 * titles are cut to their limit, and the active tab moves with the tabs that stay.
 * @param tabs - The window's tabs, in order; `undefined` for a tab that could not be read.
 * @param active - Index of the active tab among them, or -1.
 * @param extras - What else the window keeps, such as where it is, as far as it is known.
 * @returns The window, or `undefined` when no tab is left.
 */
export function sessionWindow(
  tabs: readonly (SessionTab | undefined)[],
  active: number,
  extras: SessionWindowExtras = {},
): SessionWindow | undefined {
  const kept: SessionTab[] = [];
  let keptActive = 0;
  tabs.forEach((tab, index) => {
    if (tab === undefined || !keepsUrl(tab.url)) return;
    if (index === active) keptActive = kept.length;
    kept.push({
      url: tab.url,
      title: tab.title.slice(0, titleLimit),
      ...(tab.pinned === true ? { pinned: true } : {}),
    });
  });
  if (kept.length === 0) return undefined;
  const bounds = optionalField(Bounds, extras.bounds);
  return {
    tabs: kept,
    active: keptActive,
    ...(bounds === undefined ? {} : { bounds }),
    ...(extras.maximized === undefined ? {} : { maximized: extras.maximized }),
  };
}

const StoredSession = v.object({ version: v.literal(1), windows: v.array(v.unknown()) });
/** A window as the session file holds it; its optional fields are read on their own. */
const StoredWindow = v.object({
  tabs: v.array(v.unknown()),
  active: v.number(),
  bounds: v.optional(v.unknown()),
  maximized: v.optional(v.unknown()),
});
/** A tab as the session file holds it; its optional fields are read on their own. */
const StoredTab = v.object({
  url: v.string(),
  title: v.string(),
  pinned: v.optional(v.unknown()),
});

/**
 * Reads a stored tab.
 * @param stored - What the session file holds for the tab.
 * @returns The tab, or `undefined` when its address or title cannot be read.
 */
function storedTab(stored: unknown): SessionTab | undefined {
  const tab = v.safeParse(StoredTab, stored);
  if (!tab.success) return undefined;
  const { url, title, pinned } = tab.output;
  return optionalField(Flag, pinned) === true ? { url, title, pinned: true } : { url, title };
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
    const kept = sessionWindow(window.output.tabs.map(storedTab), window.output.active, {
      ...(bounds === undefined ? {} : { bounds }),
      ...(maximized === undefined ? {} : { maximized }),
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
}

/** Where a window that opens again was: its bounds on the screens, and whether it was maximized. */
export interface RestoredPlace {
  readonly bounds?: WindowBounds;
  readonly maximized?: boolean;
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
}

/**
 * The windows of a session as they open again.
 * @param session - The session, as {@link parseSession} read it.
 */
export function restoredWindows(session: SessionSnapshot): RestoredWindow[] {
  return session.windows.map(({ tabs, active, bounds, maximized }) => ({
    tabs: tabs.map(({ url, title, pinned }) => ({ url, title, pinned: pinned === true })),
    active,
    place: {
      ...(bounds === undefined ? {} : { bounds }),
      ...(maximized === undefined ? {} : { maximized }),
    },
  }));
}
