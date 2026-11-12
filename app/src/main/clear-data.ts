import type { Session } from 'electron';
import type { DataClient } from '../platform/electron/data-service-client.ts';

/** The length of each time range of clearing, in milliseconds; `all` has none. */
const ranges = {
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 28 * 24 * 60 * 60 * 1000,
  all: 0,
} as const;

/** What to clear, and since when. */
export interface ClearRequest {
  readonly range: keyof typeof ranges;
  readonly history: boolean;
  readonly cookies: boolean;
  readonly cache: boolean;
}

/**
 * Clears browsing data of regular windows: the history of the time range, and all cookies,
 * storage and the cache of web pages, which Chromium clears only as a whole. Sign-ins with
 * HTTP authentication go with the cookies, as they would keep a site signed in.
 * @param request - What to clear, and since when.
 * @param data - The data service, which keeps the history.
 * @param web - The session of web pages.
 * @param now - The current time in milliseconds since 1970.
 */
export async function clearBrowsingData(
  request: ClearRequest,
  data: Pick<DataClient, 'call'>,
  web: Session,
  now: number,
): Promise<void> {
  const length = ranges[request.range];
  if (request.history) await data.call('clearHistorySince', length === 0 ? 0 : now - length);
  if (request.cookies) {
    await web.clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'serviceworkers',
        'cachestorage',
      ],
    });
    await web.clearAuthCache();
    await web.cookies.flushStore();
  }
  if (request.cache) await web.clearCache();
}
