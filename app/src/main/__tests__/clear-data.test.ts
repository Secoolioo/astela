import type { Session } from 'electron';
import { describe, expect, it } from 'vitest';
import type { DataClient } from '../../platform/electron/data-service-client.ts';
import { clearBrowsingData } from '../clear-data.ts';

/** A data service and a session that record what was cleared. */
function fakes(): { data: DataClient; web: Session; cleared: unknown[][] } {
  const cleared: unknown[][] = [];
  const data = {
    call: (method: string, ...params: unknown[]) => {
      cleared.push([method, ...params]);
      return Promise.resolve();
    },
  } as unknown as DataClient;
  const web = {
    clearStorageData: (options: unknown) => {
      cleared.push(['storage', options]);
      return Promise.resolve();
    },
    clearCache: () => {
      cleared.push(['cache']);
      return Promise.resolve();
    },
    cookies: { flushStore: () => Promise.resolve() },
  } as unknown as Session;
  return { data, web, cleared };
}

describe('clearBrowsingData', () => {
  it('clears the history of the time range, and all cookies, site data and the cache', async () => {
    const { data, web, cleared } = fakes();
    const now = 100_000_000;
    await clearBrowsingData(
      { range: 'day', history: true, cookies: true, cache: true },
      data,
      web,
      now,
    );
    expect(cleared).toEqual([
      ['clearHistorySince', now - 24 * 60 * 60 * 1000],
      [
        'storage',
        {
          storages: expect.arrayContaining([
            'cookies',
            'localstorage',
            'indexdb',
            'serviceworkers',
          ]),
        },
      ],
      ['cache'],
    ]);
  });

  it('clears the whole history and only the kinds of data that were chosen', async () => {
    const all = fakes();
    await clearBrowsingData(
      { range: 'all', history: true, cookies: false, cache: false },
      all.data,
      all.web,
      5,
    );
    expect(all.cleared).toEqual([['clearHistorySince', 0]]);
    const cache = fakes();
    await clearBrowsingData(
      { range: 'hour', history: false, cookies: false, cache: true },
      cache.data,
      cache.web,
      5,
    );
    expect(cache.cleared).toEqual([['cache']]);
  });
});
