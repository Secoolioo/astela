/**
 * How 0.1.0-beta.6 reads `session.json`, frozen: a copy of app/src/domain/session/session.ts
 * and of the tab pages of app/src/shared/internal-pages.ts at the tag v0.1.0-beta.6. To
 * compare them: `git show v0.1.0-beta.6:app/src/domain/session/session.ts`.
 * After a rollback to 0.1.0-beta.6, this code reads the session that a later version wrote,
 * so the tests check that such a session keeps every tab and the active tab here. Never
 * change this copy to follow the code of later versions.
 */
import * as v from 'valibot';

/** The internal pages that 0.1.0-beta.6 opens in tabs. */
const tabPages = ['newtab', 'settings', 'setup', 'history', 'bookmarks'] as const;

function tabPageOf(url: string): (typeof tabPages)[number] | undefined {
  const host = /^app:\/\/([^/?#]*)/i.exec(url)?.[1]?.toLowerCase();
  return tabPages.find((page) => page === host);
}

const Bounds = v.object({
  x: v.pipe(v.number(), v.integer()),
  y: v.pipe(v.number(), v.integer()),
  width: v.pipe(v.number(), v.integer(), v.minValue(1)),
  height: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

const SessionSnapshot = v.object({
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

/** A session as 0.1.0-beta.6 reads it. */
export type Beta6Session = v.InferOutput<typeof SessionSnapshot>;

type SessionWindow = Beta6Session['windows'][number];
type SessionTab = SessionWindow['tabs'][number];

const titleLimit = 1024;
const urlLimit = 8192;

function keepsUrl(url: string): boolean {
  const page = tabPageOf(url);
  if (page !== undefined) return page !== 'setup';
  return url.length <= urlLimit && /^https?:\/\/[^\s]+$/i.test(url);
}

function sessionWindow(
  tabs: readonly (SessionTab | undefined)[],
  active: number,
  place: Pick<SessionWindow, 'bounds' | 'maximized'> = {},
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
  const bounds = place.bounds === undefined ? undefined : v.safeParse(Bounds, place.bounds);
  return {
    tabs: kept,
    active: keptActive,
    ...(bounds?.success === true ? { bounds: bounds.output } : {}),
    ...(place.maximized === undefined ? {} : { maximized: place.maximized }),
  };
}

const StoredSession = v.object({ version: v.literal(1), windows: v.array(v.unknown()) });
const StoredWindow = v.object({
  tabs: v.array(v.unknown()),
  active: v.number(),
  bounds: v.optional(v.unknown()),
  maximized: v.optional(v.unknown()),
});
const StoredTab = v.object({
  url: v.string(),
  title: v.string(),
  pinned: v.optional(v.boolean()),
});

/**
 * Reads a session as 0.1.0-beta.6 does.
 * @param data - What the session file contained.
 * @returns The session, or `undefined` when 0.1.0-beta.6 restores nothing of it.
 */
export function parseBeta6Session(data: unknown): Beta6Session | undefined {
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
    const { bounds, maximized } = window.output;
    const kept = sessionWindow(tabs, window.output.active, {
      ...(v.is(Bounds, bounds) ? { bounds } : {}),
      ...(typeof maximized === 'boolean' ? { maximized } : {}),
    });
    return kept === undefined ? [] : [kept];
  });
  return windows.length === 0 ? undefined : { version: 1, windows };
}
