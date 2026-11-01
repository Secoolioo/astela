import * as v from 'valibot';
import { tabPageOf } from '../../shared/internal-pages.ts';

/** The tabs of the open windows, as the session keeps them across starts. */
export const SessionSnapshot = v.object({
  version: v.literal(1),
  windows: v.array(
    v.object({
      tabs: v.array(
        v.object({
          url: v.pipe(v.string(), v.maxLength(8192)),
          title: v.pipe(v.string(), v.maxLength(1024)),
        }),
      ),
      active: v.pipe(v.number(), v.integer(), v.minValue(0)),
    }),
  ),
});

/** The tabs of the open windows, as the session keeps them across starts. */
export type SessionSnapshot = v.InferOutput<typeof SessionSnapshot>;

/** The longest title and address a session keeps; longer titles are cut, longer addresses dropped. */
const titleLimit = 1024;
const urlLimit = 8192;

/** One window of a session. */
export type SessionWindow = SessionSnapshot['windows'][number];

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
 * The window of a session for some tabs: tabs that a session does not keep are dropped,
 * titles are cut to their limit, and the active tab moves with the tabs that stay.
 * @param tabs - The window's tabs, in order; `undefined` for a tab that could not be read.
 * @param active - Index of the active tab among them, or -1.
 * @returns The window, or `undefined` when no tab is left.
 */
export function sessionWindow(
  tabs: readonly (SessionTab | undefined)[],
  active: number,
): SessionWindow | undefined {
  const kept: SessionTab[] = [];
  let keptActive = 0;
  tabs.forEach((tab, index) => {
    if (tab === undefined || !keepsUrl(tab.url)) return;
    if (index === active) keptActive = kept.length;
    kept.push({ url: tab.url, title: tab.title.slice(0, titleLimit) });
  });
  return kept.length === 0 ? undefined : { tabs: kept, active: keptActive };
}

const StoredSession = v.object({ version: v.literal(1), windows: v.array(v.unknown()) });
const StoredWindow = v.object({ tabs: v.array(v.unknown()), active: v.number() });
const StoredTab = v.object({ url: v.string(), title: v.string() });

/**
 * Reads a stored session. A tab or window that cannot be read is dropped on its own, so
 * one damaged entry never costs the rest of the session. Tabs that a session does not keep
 * and windows without tabs are dropped, and the active tab of each window stays within its
 * tabs.
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
    const tabs = window.output.tabs.map((tab) => {
      const parsed = v.safeParse(StoredTab, tab);
      return parsed.success ? parsed.output : undefined;
    });
    const kept = sessionWindow(tabs, window.output.active);
    return kept === undefined ? [] : [kept];
  });
  return windows.length === 0 ? undefined : { version: 1, windows };
}
