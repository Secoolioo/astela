import { describe, expect, it } from 'vitest';
import {
  currentEntry,
  currentOnly,
  historyMoves,
  memoryLimits,
  parseTabHistory,
  sessionLimits,
  stepHistory,
  trimHistory,
  viewKindOf,
} from '../tabs/tab-history.ts';
import type { HistoryEntry, TabHistory, ViewSnapshot } from '../tabs/view-history.ts';

const entry = (url: string, pageState?: string): HistoryEntry =>
  pageState === undefined ? { url, title: url } : { url, title: url, pageState };

const view = (index: number, ...entries: HistoryEntry[]): ViewSnapshot => ({ entries, index });

/** A page state of base64 text with this many characters. */
const state = (length: number): string => 'A'.repeat(length);

/** The lengths of the page states of a history, entry by entry. */
const states = (history: TabHistory | undefined): unknown =>
  history?.views.flatMap((each) => each.entries.map((one) => one.pageState?.length ?? 0));

/** The addresses of a history, view by view, with the entry that each view shows. */
const urls = (history: TabHistory | undefined): unknown =>
  history?.views.map((each) => [each.entries.map((one) => one.url), each.index]);

describe('tab history', () => {
  it('tells which kind of view shows an address', () => {
    expect(viewKindOf('https://a.example/')).toBe('web');
    expect(viewKindOf('http://127.0.0.1:8080/page')).toBe('web');
    expect(viewKindOf('app://newtab/')).toBe('newtab');
    expect(viewKindOf('app://settings/#tabs.position')).toBe('settings');
    expect(viewKindOf('app://history/')).toBe('history');
    expect(viewKindOf('app://setup/')).toBeUndefined();
    expect(viewKindOf('app://shell/')).toBeUndefined();
    expect(viewKindOf('about:blank')).toBeUndefined();
    expect(viewKindOf('data:text/html,hi')).toBeUndefined();
    expect(viewKindOf('file:///etc/passwd')).toBeUndefined();
    expect(viewKindOf(`https://a.example/${'p'.repeat(8200)}`)).toBeUndefined();
  });

  it('keeps 24 entries back and forward across views, and drops views without entries', () => {
    const many = (prefix: string, count: number): HistoryEntry[] =>
      Array.from({ length: count }, (_, at) => entry(`https://${prefix}${at}.example/`));
    const history: TabHistory = {
      views: [
        view(0, entry('app://newtab/')),
        view(19, ...many('a', 20)),
        view(0, entry('app://history/')),
        view(5, ...many('b', 10)),
        view(0, entry('app://settings/')),
        view(29, ...many('c', 30)),
      ],
      view: 3,
    };
    const kept = trimHistory(history, sessionLimits);
    expect(urls(kept)).toEqual([
      [
        many('a', 20)
          .slice(2)
          .map((one) => one.url),
        17,
      ],
      [['app://history/'], 0],
      [many('b', 10).map((one) => one.url), 5],
      [['app://settings/'], 0],
      // A later view whose shown entry went shows the last one that stays.
      [
        many('c', 30)
          .slice(0, 19)
          .map((one) => one.url),
        18,
      ],
    ]);
    expect(kept?.view).toBe(2);
    expect(currentEntry(kept ?? history)?.url).toBe('https://b5.example/');
    // With fewer entries, the views on the way go, and so does one beyond the limit.
    expect(urls(trimHistory(history, { ...sessionLimits, back: 2, forward: 5 }))).toEqual([
      [
        many('b', 10)
          .slice(3)
          .map((one) => one.url),
        2,
      ],
      [['app://settings/'], 0],
    ]);
  });

  it('keeps only entries of the kind of their view, and no setup guide', () => {
    const history: TabHistory = {
      views: [
        view(0, entry('app://setup/')),
        view(
          1,
          entry('app://settings/'),
          entry('app://settings/#tabs.position'),
          entry('https://web.example/'),
          entry('app://history/'),
        ),
        view(
          2,
          entry('about:blank'),
          entry('app://settings/'),
          entry('https://a.example/'),
          entry('file:///etc/passwd'),
          entry('data:text/html,x'),
          entry(`https://long.example/${'p'.repeat(8200)}`),
          entry('https://b.example/'),
        ),
      ],
      view: 2,
    };
    expect(urls(trimHistory(history, sessionLimits))).toEqual([
      [['app://settings/', 'app://settings/#tabs.position'], 1],
      [['https://a.example/', 'https://b.example/'], 0],
    ]);
    // A web page restored into the view of an internal page, or the other way, never stays.
    expect(
      trimHistory(
        { views: [view(0, entry('app://newtab/'), entry('https://a.example/'))], view: 0 },
        sessionLimits,
      ),
    ).toEqual({ views: [view(0, entry('app://newtab/'))], view: 0 });
  });

  it('gives nothing back when the entry that the tab shows cannot be kept', () => {
    expect(trimHistory({ views: [view(0, entry('about:blank'))], view: 0 }, sessionLimits)).toBe(
      undefined,
    );
    expect(trimHistory({ views: [view(0, entry('app://setup/'))], view: 0 }, sessionLimits)).toBe(
      undefined,
    );
    expect(
      trimHistory({ views: [view(3, entry('https://a.example/'))], view: 0 }, sessionLimits),
    ).toBe(undefined);
    expect(
      trimHistory({ views: [view(0, entry('https://a.example/'))], view: 1 }, sessionLimits),
    ).toBe(undefined);
    expect(trimHistory({ views: [], view: 0 }, sessionLimits)).toBeUndefined();
  });

  it('cuts titles to 1024 characters', () => {
    const kept = trimHistory(
      { views: [view(0, { url: 'https://a.example/', title: 't'.repeat(2000) })], view: 0 },
      sessionLimits,
    );
    expect(kept?.views[0]?.entries[0]?.title).toHaveLength(1024);
  });

  it('keeps base64 page states of up to 32 KiB, from the current entry outward, up to 128 KiB per tab', () => {
    const large = 30 * 1024;
    const history: TabHistory = {
      views: [
        view(
          3,
          entry('https://a.example/', state(large)),
          entry('https://b.example/', state(large)),
          entry('https://c.example/', state(large)),
          entry('https://d.example/', state(large)),
          entry('https://e.example/', state(large)),
          entry('https://f.example/', state(large)),
          entry('https://g.example/', state(1024)),
        ),
      ],
      view: 0,
    };
    // d, then c before e at the same distance, then b, before the room of the tab runs out;
    // g still fits after f, nearer to d, did not.
    expect(states(trimHistory(history, sessionLimits))).toEqual([
      0,
      large,
      large,
      large,
      large,
      0,
      1024,
    ]);
    const odd: TabHistory = {
      views: [
        view(
          2,
          entry('https://a.example/', 'not base64!'),
          entry('https://b.example/', state(33 * 1024)),
          entry('https://c.example/', 'QUJD'),
          entry('https://d.example/', 'QUJ'),
          entry('https://e.example/', ''),
        ),
      ],
      view: 0,
    };
    expect(states(trimHistory(odd, sessionLimits))).toEqual([0, 0, 4, 0, 0]);
    // Memory keeps more than the session: up to 512 KiB per entry.
    expect(states(trimHistory(odd, memoryLimits))).toEqual([0, 33 * 1024, 4, 0, 0]);
  });

  it('steps back and forward within a view and across views, and stops at the ends', () => {
    const history: TabHistory = {
      views: [
        view(0, entry('app://newtab/')),
        view(
          1,
          entry('https://a.example/'),
          entry('https://b.example/'),
          entry('https://c.example/'),
        ),
      ],
      view: 1,
    };
    expect(historyMoves(history)).toEqual({ back: true, forward: true });
    const back = stepHistory(history, -1);
    expect(back === undefined ? undefined : currentEntry(back)?.url).toBe('https://a.example/');
    const first = back === undefined ? undefined : stepHistory(back, -1);
    expect(first === undefined ? undefined : currentEntry(first)?.url).toBe('app://newtab/');
    expect(first === undefined ? 'none' : stepHistory(first, -1)).toBeUndefined();
    expect(first === undefined ? undefined : historyMoves(first)).toEqual({
      back: false,
      forward: true,
    });
    // Forward into the view after shows the entry that the view showed.
    const forward = first === undefined ? undefined : stepHistory(first, 1);
    expect(forward === undefined ? undefined : currentEntry(forward)?.url).toBe(
      'https://a.example/',
    );
    const last = stepHistory(history, 1);
    expect(last === undefined ? undefined : currentEntry(last)?.url).toBe('https://c.example/');
    expect(last === undefined ? 'none' : stepHistory(last, 1)).toBeUndefined();
    expect(historyMoves({ views: [view(0, entry('https://a.example/'))], view: 0 })).toEqual({
      back: false,
      forward: false,
    });
  });

  it('keeps only the entry that the tab shows when the history is cleared', () => {
    const history: TabHistory = {
      views: [
        view(0, entry('app://newtab/')),
        view(0, entry('https://a.example/', 'QUJD'), entry('https://b.example/')),
      ],
      view: 1,
    };
    expect(currentOnly(history)).toEqual({
      views: [view(0, entry('https://a.example/', 'QUJD'))],
      view: 0,
    });
  });

  it('gives a history that it cut back as it is, also for wider limits, so that it cuts once', () => {
    const history: TabHistory = {
      views: [
        view(0, entry('app://newtab/')),
        view(1, entry('https://a.example/', 'QUJD'), entry('https://b.example/', 'REVG')),
      ],
      view: 1,
    };
    const once = trimHistory(history, sessionLimits);
    expect(once).toEqual(history);
    expect(once).not.toBe(history);
    expect(trimHistory(once ?? history, sessionLimits)).toBe(once);
    expect(trimHistory(once ?? history, memoryLimits)).toBe(once);
    // A history within wider limits is cut again for narrower ones.
    const wide = trimHistory(history, memoryLimits);
    expect(trimHistory(wide ?? history, sessionLimits)).not.toBe(wide);
    expect(trimHistory(wide ?? history, sessionLimits)).toEqual(once);
    // So is a history that only looks the same.
    expect(trimHistory({ ...(once ?? history) }, sessionLimits)).not.toBe(once);
    // What the session file holds is cut once, and no more on its way into a tab.
    const read = parseTabHistory(JSON.parse(JSON.stringify(history)), 'https://b.example/');
    expect(trimHistory(read ?? history, memoryLimits)).toBe(read);
  });

  it('reads the history of a session file, and drops what it cannot read', () => {
    const stored = {
      views: [
        { entries: [{ url: 'app://newtab/', title: 'New tab' }, { url: 42 }], index: 0 },
        'not a view',
        {
          entries: [
            { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
            { url: 'https://b.example/', title: 'B', pageState: 7 },
          ],
          index: 1,
        },
      ],
      view: 2,
    };
    expect(parseTabHistory(stored, 'https://b.example/')).toEqual({
      views: [
        view(0, { url: 'app://newtab/', title: 'New tab' }),
        view(
          1,
          { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
          {
            url: 'https://b.example/',
            title: 'B',
          },
        ),
      ],
      view: 1,
    });
    // A history must show the tab's own address.
    expect(parseTabHistory(stored, 'https://a.example/')).toBeUndefined();
    for (const broken of [
      undefined,
      null,
      'history',
      { views: 'x', view: 0 },
      { views: [], view: 0.5 },
    ]) {
      expect(parseTabHistory(broken, 'https://a.example/')).toBeUndefined();
    }
  });
});
