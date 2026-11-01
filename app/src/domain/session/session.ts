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

/** One window of a session. */
export type SessionWindow = SessionSnapshot['windows'][number];

/**
 * Tells whether a session keeps a tab: web pages and the browser's own pages that open in
 * tabs, except the setup guide, which opens on its own when it is due.
 * @param url - The tab's address.
 */
export function keepsUrl(url: string): boolean {
  const page = tabPageOf(url);
  return page === undefined ? /^https?:\/\/[^\s]+$/i.test(url) : page !== 'setup';
}

/**
 * Reads a stored session. Tabs that a session does not keep and windows without tabs are
 * dropped, and the active tab of each window stays within its tabs.
 * @param data - What the session file contained.
 * @returns The session, or `undefined` when nothing is left to restore.
 */
export function parseSession(data: unknown): SessionSnapshot | undefined {
  const parsed = v.safeParse(SessionSnapshot, data);
  if (!parsed.success) {
    return undefined;
  }
  const windows = parsed.output.windows.flatMap((window): SessionWindow[] => {
    const activeUrl = window.tabs[window.active];
    const tabs = window.tabs.filter((tab) => keepsUrl(tab.url));
    if (tabs.length === 0) {
      return [];
    }
    const active = activeUrl === undefined ? 0 : Math.max(0, tabs.indexOf(activeUrl));
    return [{ tabs, active }];
  });
  return windows.length === 0 ? undefined : { version: 1, windows };
}
