import { describe, expect, it } from 'vitest';
import { fitSession } from '../session/fit-session.ts';
import {
  keepsUrl,
  parseSession,
  restoredWindows,
  sessionStart,
  sessionWindow,
  withoutTabHistories,
  type SessionSnapshot,
} from '../session/session.ts';
import { memoryLimits, trimHistory } from '../tabs/tab-history.ts';
import type { TabHistory } from '../tabs/view-history.ts';
import { parseBeta6Session } from './beta6-session.ts';

const tab = (url: string): { url: string; title: string } => ({ url, title: url });

/** A tab with two entries, each with a page state of this many characters. */
const withStates = (
  url: string,
  size: number,
): SessionSnapshot['windows'][number]['tabs'][number] => ({
  ...tab(url),
  history: {
    views: [
      {
        entries: [
          { url: `${url}before`, title: 'before', pageState: 'A'.repeat(size) },
          { url, title: url, pageState: 'B'.repeat(size) },
        ],
        index: 1,
      },
    ],
    view: 0,
  },
});
/** The lengths of the page states of each tab of a session, entry by entry. */
const states = (session: SessionSnapshot): number[][] =>
  session.windows.flatMap((window) =>
    window.tabs.map((one) =>
      (one.history?.views ?? []).flatMap((view) =>
        view.entries.map((entry) => entry.pageState?.length ?? 0),
      ),
    ),
  );

/** The startup setting as people set it. */
const user = (value: string): { value: string; locked: boolean } => ({ value, locked: false });
/** The startup setting as a mandatory policy sets it. */
const policy = (value: string): { value: string; locked: boolean } => ({ value, locked: true });

describe('session', () => {
  it('keeps web pages and internal tab pages except the setup guide', () => {
    expect(keepsUrl('https://news.example/a')).toBe(true);
    expect(keepsUrl('http://127.0.0.1:8080/')).toBe(true);
    expect(keepsUrl('app://newtab/')).toBe(true);
    expect(keepsUrl('app://settings/')).toBe(true);
    expect(keepsUrl('app://setup/')).toBe(false);
    expect(keepsUrl('app://shell/')).toBe(false);
    expect(keepsUrl('about:blank')).toBe(false);
    expect(keepsUrl('file:///etc/passwd')).toBe(false);
  });

  it('drops what it does not keep and moves the active tab with it', () => {
    const session = parseSession({
      version: 1,
      windows: [
        {
          tabs: [tab('about:blank'), tab('https://a.example/'), tab('https://b.example/')],
          active: 2,
        },
        { tabs: [tab('app://setup/')], active: 0 },
        { tabs: [tab('https://c.example/')], active: 7 },
      ],
    });
    expect(session).toEqual({
      version: 1,
      windows: [
        { tabs: [tab('https://a.example/'), tab('https://b.example/')], active: 1 },
        { tabs: [tab('https://c.example/')], active: 0 },
      ],
    });
  });

  it('keeps which tabs are pinned', () => {
    const pinned = { ...tab('https://mail.example/'), pinned: true };
    expect(
      parseSession({
        version: 1,
        windows: [{ tabs: [pinned, { ...tab('https://a.example/'), pinned: false }], active: 1 }],
      }),
    ).toEqual({ version: 1, windows: [{ tabs: [pinned, tab('https://a.example/')], active: 1 }] });
    expect(sessionWindow([pinned], 0)).toEqual({ tabs: [pinned], active: 0 });
  });

  it('keeps the rest of a session when one tab or window cannot be read', () => {
    const long = 'x'.repeat(5000);
    const session = parseSession({
      version: 1,
      windows: [
        {
          tabs: [
            { url: 'https://a.example/', title: long },
            { url: 42, title: 'broken' },
            { url: `https://b.example/${'p'.repeat(9000)}`, title: 'long address' },
            tab('https://c.example/'),
          ],
          active: 3,
        },
        { tabs: 'not a list', active: 0 },
      ],
    });
    expect(session).toEqual({
      version: 1,
      windows: [
        {
          tabs: [{ url: 'https://a.example/', title: 'x'.repeat(1024) }, tab('https://c.example/')],
          active: 1,
        },
      ],
    });
  });

  it('builds the window of a session from tabs, with the active tab among those it keeps', () => {
    expect(
      sessionWindow([tab('about:blank'), tab('https://a.example/'), tab('https://b.example/')], 2),
    ).toEqual({ tabs: [tab('https://a.example/'), tab('https://b.example/')], active: 1 });
    expect(sessionWindow([tab('https://a.example/')], -1)).toEqual({
      tabs: [tab('https://a.example/')],
      active: 0,
    });
    expect(sessionWindow([tab('app://setup/')], 0)).toBeUndefined();
  });

  it('keeps where each window was, and drops a place that cannot be read', () => {
    const bounds = { x: 10, y: 20, width: 1200, height: 800 };
    expect(sessionWindow([tab('https://a.example/')], 0, { bounds, maximized: true })).toEqual({
      tabs: [tab('https://a.example/')],
      active: 0,
      bounds,
      maximized: true,
    });
    expect(
      parseSession({
        version: 1,
        windows: [
          { tabs: [tab('https://a.example/')], active: 0, bounds, maximized: false },
          { tabs: [tab('https://b.example/')], active: 0, bounds: { x: 'a' }, maximized: 1 },
        ],
      }),
    ).toEqual({
      version: 1,
      windows: [
        { tabs: [tab('https://a.example/')], active: 0, bounds, maximized: false },
        { tabs: [tab('https://b.example/')], active: 0 },
      ],
    });
  });

  it('rejects broken or empty sessions', () => {
    expect(parseSession(undefined)).toBeUndefined();
    expect(parseSession({ version: 2, windows: [] })).toBeUndefined();
    expect(
      parseSession({ version: 1, windows: [{ tabs: [tab('about:blank')], active: 0 }] }),
    ).toBeUndefined();
  });

  it('reads each optional field of a tab and a window on its own, and drops only a broken one', () => {
    const bounds = { x: 10, y: 20, width: 1200, height: 800 };
    expect(
      parseSession({
        version: 1,
        windows: [
          {
            tabs: [
              { ...tab('https://a.example/'), pinned: 'yes' },
              { ...tab('https://b.example/'), pinned: true },
              { ...tab('https://c.example/'), pinned: null },
            ],
            active: 2,
            bounds: { ...bounds, width: 0 },
            maximized: true,
          },
          { tabs: [tab('https://d.example/')], active: 0, bounds, maximized: 'no' },
        ],
      }),
    ).toEqual({
      version: 1,
      windows: [
        {
          tabs: [
            tab('https://a.example/'),
            { ...tab('https://b.example/'), pinned: true },
            tab('https://c.example/'),
          ],
          active: 2,
          maximized: true,
        },
        { tabs: [tab('https://d.example/')], active: 0, bounds },
      ],
    });
  });

  it('keeps the back and forward history of each tab, within limits, when it shows the tab', () => {
    const history: TabHistory = {
      views: [
        { entries: [{ url: 'app://newtab/', title: 'New tab' }], index: 0 },
        {
          entries: [
            { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
            { url: 'file:///etc/passwd', title: 'File' },
            { url: 'https://b.example/', title: 'b'.repeat(2000) },
          ],
          index: 2,
        },
      ],
      view: 1,
    };
    const kept: TabHistory = {
      views: [
        { entries: [{ url: 'app://newtab/', title: 'New tab' }], index: 0 },
        {
          entries: [
            { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
            { url: 'https://b.example/', title: 'b'.repeat(1024) },
          ],
          index: 1,
        },
      ],
      view: 1,
    };
    const window = sessionWindow(
      [
        { ...tab('https://b.example/'), history },
        // A history that shows another address than the tab's is not kept.
        { ...tab('https://c.example/'), history },
        { ...tab('https://d.example/'), history: undefined },
      ],
      0,
    );
    expect(window).toEqual({
      tabs: [
        { ...tab('https://b.example/'), history: kept },
        tab('https://c.example/'),
        tab('https://d.example/'),
      ],
      active: 0,
    });
    // The session file holds the same, and reads back as it was written.
    const written: unknown = JSON.parse(JSON.stringify({ version: 1, windows: [window] }));
    expect(parseSession(written)).toEqual({ version: 1, windows: [window] });
    expect(
      parseSession({
        version: 1,
        windows: [
          {
            tabs: [
              { ...tab('https://b.example/'), history: { views: 'broken', view: 0 } },
              { ...tab('https://c.example/'), history: kept },
            ],
            active: 0,
          },
        ],
      }),
    ).toEqual({
      version: 1,
      windows: [{ tabs: [tab('https://b.example/'), tab('https://c.example/')], active: 0 }],
    });
  });

  it('cuts each history of a session file once on its way into the tabs', () => {
    const history: TabHistory = {
      views: [
        { entries: [{ url: 'app://newtab/', title: 'New tab' }], index: 0 },
        {
          entries: [
            { url: 'https://a.example/', title: 'A', pageState: 'QUJD' },
            { url: 'https://b.example/', title: 'B', pageState: 'REVG' },
          ],
          index: 1,
        },
      ],
      view: 1,
    };
    const session = parseSession({
      version: 1,
      windows: [{ tabs: [{ ...tab('https://b.example/'), history }], active: 0 }],
    });
    const [restored] = restoredWindows(session ?? { version: 1, windows: [] });
    const read = restored?.tabs[0]?.history;
    expect(read).toEqual(history);
    // A tab that opens with it keeps it within the limits of memory as it is.
    expect(trimHistory(read ?? history, memoryLimits)).toBe(read);
    // And the session that keeps the tab again takes it as it is.
    expect(
      sessionWindow([{ ...tab('https://b.example/'), history: read }], 0)?.tabs[0]?.history,
    ).toBe(read);
  });

  it('keeps only the entry that each tab shows once the whole history is cleared', () => {
    const session: SessionSnapshot = {
      version: 1,
      windows: [
        {
          tabs: [withStates('https://a.example/', 4), tab('https://b.example/')],
          active: 1,
          maximized: true,
        },
      ],
    };
    expect(withoutTabHistories(session)).toEqual({
      version: 1,
      windows: [
        {
          tabs: [
            {
              ...tab('https://a.example/'),
              history: {
                views: [
                  {
                    entries: [
                      { url: 'https://a.example/', title: 'https://a.example/', pageState: 'BBBB' },
                    ],
                    index: 0,
                  },
                ],
                view: 0,
              },
            },
            tab('https://b.example/'),
          ],
          active: 1,
          maximized: true,
        },
      ],
    });
  });

  it('brings the last session back when asked, and after a crash unless a mandatory policy sets the start', () => {
    const run = { restart: false, unclean: false, setup: false };
    expect(sessionStart(user('restore'), run)).toBe('asked');
    expect(sessionStart(user('newtab'), run)).toBeUndefined();
    expect(sessionStart(user('newtab'), { ...run, restart: true })).toBe('asked');
    expect(sessionStart(user('newtab'), { ...run, unclean: true })).toBe('crash');
    expect(sessionStart(user('pages'), { ...run, unclean: true })).toBe('crash');
    expect(sessionStart(policy('newtab'), { ...run, unclean: true })).toBeUndefined();
    expect(sessionStart(policy('pages'), { ...run, unclean: true })).toBeUndefined();
    expect(sessionStart(policy('restore'), { ...run, unclean: true })).toBe('asked');
    expect(sessionStart(user('restore'), { ...run, unclean: true, setup: true })).toBeUndefined();
  });

  it('keeps whether a window was in full screen, when it is a flag', () => {
    expect(sessionWindow([tab('https://a.example/')], 0, { fullScreen: true })).toEqual({
      tabs: [tab('https://a.example/')],
      active: 0,
      fullScreen: true,
    });
    expect(
      parseSession({
        version: 1,
        windows: [
          { tabs: [tab('https://a.example/')], active: 0, fullScreen: true },
          { tabs: [tab('https://b.example/')], active: 0, fullScreen: 'yes' },
          { tabs: [tab('https://c.example/')], active: 0, fullScreen: false },
        ],
      }),
    ).toEqual({
      version: 1,
      windows: [
        { tabs: [tab('https://a.example/')], active: 0, fullScreen: true },
        { tabs: [tab('https://b.example/')], active: 0 },
        { tabs: [tab('https://c.example/')], active: 0, fullScreen: false },
      ],
    });
  });

  it('fits the page states of a session into its budget, keeping what the active tabs show', () => {
    const session: SessionSnapshot = {
      version: 1,
      windows: [
        {
          tabs: [withStates('https://a.example/', 100), withStates('https://b.example/', 100)],
          active: 1,
        },
        { tabs: [withStates('https://c.example/', 100)], active: 0 },
      ],
    };
    expect(fitSession(session, 600)).toBe(session);
    // First the entries that the tabs do not show, of the tab that is not active first.
    expect(states(fitSession(session, 500))).toEqual([
      [0, 100],
      [100, 100],
      [100, 100],
    ]);
    expect(states(fitSession(session, 300))).toEqual([
      [0, 100],
      [0, 100],
      [0, 100],
    ]);
    // Then what the tabs that are not active show; the active tabs keep theirs.
    expect(states(fitSession(session, 250))).toEqual([
      [0, 0],
      [0, 100],
      [0, 100],
    ]);
    expect(states(fitSession(session, 0))).toEqual([
      [0, 0],
      [0, 100],
      [0, 100],
    ]);
    // What the session holds besides the page states stays.
    expect(
      fitSession(session, 0).windows.map((window) => window.tabs.map((one) => one.url)),
    ).toEqual([['https://a.example/', 'https://b.example/'], ['https://c.example/']]);
  });

  it('opens the windows of a session again with their tabs, their active tab and their place', () => {
    const bounds = { x: 10, y: 20, width: 1200, height: 800 };
    expect(
      restoredWindows({
        version: 1,
        windows: [
          {
            tabs: [{ ...tab('https://mail.example/'), pinned: true }, tab('https://a.example/')],
            active: 1,
            bounds,
            maximized: false,
          },
          {
            tabs: [{ ...tab('https://b.example/'), history: shown('https://b.example/') }],
            active: 0,
            fullScreen: true,
          },
        ],
      }),
    ).toEqual([
      {
        tabs: [
          { ...tab('https://mail.example/'), pinned: true },
          { ...tab('https://a.example/'), pinned: false },
        ],
        active: 1,
        place: { bounds, maximized: false },
      },
      {
        tabs: [
          { ...tab('https://b.example/'), pinned: false, history: shown('https://b.example/') },
        ],
        active: 0,
        place: { fullScreen: true },
      },
    ]);
  });
});

/** A history of a tab that shows only its address. */
const shown = (url: string): TabHistory => ({
  views: [{ entries: [{ url, title: url }], index: 0 }],
  view: 0,
});

/** A back and forward history of a tab, as the browser writes it. */
const history = (url: string): TabHistory => ({
  views: [
    { entries: [{ url: 'app://newtab/', title: 'New tab' }], index: 0 },
    { entries: [{ url, title: url, pageState: 'AAAA' }], index: 0 },
  ],
  view: 1,
});

describe('sessions and 0.1.0-beta.6', () => {
  const bounds = { x: 10, y: 20, width: 1200, height: 800 };
  /**
   * A session with the fields that later versions add to tabs and windows: the back and
   * forward history of a tab, a window in full screen, the pairs of a split view, tab groups,
   * and the tabs of two workspaces, those of the hidden one with the mark of their active tab.
   * Whoever writes one of these fields for real makes it here what the browser writes.
   */
  const work = { id: 'g1', name: 'Work', color: 'blue', collapsed: false } as const;
  const later = {
    version: 1,
    windows: [
      {
        tabs: [
          { ...tab('https://mail.example/'), pinned: true, workspace: 'default' },
          {
            ...tab('https://news.example/'),
            workspace: 'default',
            current: true,
            history: history('https://news.example/'),
          },
          { ...tab('https://a.example/'), group: work, workspace: 'w1' },
          { ...tab('https://b.example/'), group: work, workspace: 'w1', current: true },
          { ...tab('app://settings/'), workspace: 'w1' },
        ],
        active: 3,
        bounds,
        maximized: false,
        fullScreen: true,
        splits: [{ start: 2, ratio: 0.4 }],
        workspace: 'w1',
      },
      {
        tabs: [{ ...tab('https://c.example/'), history: history('https://c.example/') }],
        active: 0,
        fullScreen: false,
      },
    ],
  };
  const kept = {
    version: 1,
    windows: [
      {
        tabs: [
          { ...tab('https://mail.example/'), pinned: true },
          tab('https://news.example/'),
          tab('https://a.example/'),
          tab('https://b.example/'),
          tab('app://settings/'),
        ],
        active: 3,
        bounds,
        maximized: false,
      },
      { tabs: [tab('https://c.example/')], active: 0 },
    ],
  };

  it('keeps every tab and the active tab of a session with the fields of later versions', () => {
    expect(parseBeta6Session(later)).toEqual(kept);
    // This version reads the histories, full screen, the split views and the groups of tabs,
    // and the fields it does not know yet the same way as 0.1.0-beta.6.
    expect(parseSession(later)).toEqual({
      version: 1,
      windows: [
        {
          ...kept.windows[0],
          tabs: [
            { ...tab('https://mail.example/'), pinned: true },
            { ...tab('https://news.example/'), history: history('https://news.example/') },
            { ...tab('https://a.example/'), group: work },
            { ...tab('https://b.example/'), group: work },
            tab('app://settings/'),
          ],
          fullScreen: true,
          splits: [{ start: 2, ratio: 0.4 }],
        },
        {
          tabs: [{ ...tab('https://c.example/'), history: history('https://c.example/') }],
          active: 0,
          fullScreen: false,
        },
      ],
    });
  });

  it('writes sessions that 0.1.0-beta.6 reads with every tab and the active tab', () => {
    const window = sessionWindow(
      [
        {
          ...tab('https://mail.example/'),
          pinned: true,
          history: history('https://mail.example/'),
        },
        tab('app://setup/'),
        { url: 'https://a.example/', title: 'x'.repeat(2000), group: work },
        { ...tab('app://history/'), history: shown('app://history/'), group: null },
      ],
      3,
      { bounds, maximized: true, fullScreen: true, splits: [{ start: 2, ratio: 0.35 }] },
    );
    const written: unknown = JSON.parse(JSON.stringify({ version: 1, windows: [window] }));
    expect(written).toEqual({
      version: 1,
      windows: [
        {
          tabs: [
            {
              ...tab('https://mail.example/'),
              pinned: true,
              history: history('https://mail.example/'),
            },
            { url: 'https://a.example/', title: 'x'.repeat(1024), group: work },
            { ...tab('app://history/'), history: shown('app://history/') },
          ],
          active: 2,
          bounds,
          maximized: true,
          fullScreen: true,
          splits: [{ start: 1, ratio: 0.35 }],
        },
      ],
    });
    // 0.1.0-beta.6 reads every tab without its history and its group, and the window without
    // full screen and split views.
    expect(parseBeta6Session(written)).toEqual({
      version: 1,
      windows: [
        {
          tabs: [
            { ...tab('https://mail.example/'), pinned: true },
            { url: 'https://a.example/', title: 'x'.repeat(1024) },
            tab('app://history/'),
          ],
          active: 2,
          bounds,
          maximized: true,
        },
      ],
    });
    expect(parseSession(written)).toEqual(written);
  });

  it('reads the sessions that 0.1.0-beta.6 wrote as they are', () => {
    const files = [
      {
        version: 1,
        windows: [
          {
            tabs: [{ ...tab('https://mail.example/'), pinned: true }, tab('app://newtab/')],
            active: 1,
            bounds,
            maximized: false,
          },
        ],
      },
      {
        version: 1,
        windows: [
          { tabs: [tab('https://a.example/'), tab('app://bookmarks/')], active: 0 },
          { tabs: [tab('https://b.example/')], active: 0, bounds, maximized: true },
        ],
      },
    ];
    for (const file of files) {
      expect(parseBeta6Session(file)).toEqual(file);
      expect(parseSession(file)).toEqual(file);
    }
  });
});

describe('split views in the session', () => {
  const four = ['a', 'b', 'c', 'd'].map((name) => tab(`https://${name}.example/`));

  it('keeps the pairs with their shares, at the places of the tabs that the session keeps', () => {
    const window = sessionWindow([four[0], tab('app://setup/'), ...four.slice(1)], 0, {
      splits: [
        { start: 2, ratio: 0.35 },
        { start: 4, ratio: 0.95 },
      ],
    });
    expect(window?.splits).toEqual([{ start: 1, ratio: 0.35 }]);
    // b|c and d without a partner: a share outside its limits is clamped.
    const clamped = sessionWindow(four, 0, { splits: [{ start: 2, ratio: 0.95 }] });
    expect(clamped?.splits).toEqual([{ start: 2, ratio: 0.8 }]);
    expect(sessionWindow(four, 0, { splits: [{ start: 0, ratio: 0.1 }] })?.splits).toEqual([
      { start: 0, ratio: 0.2 },
    ]);
  });

  it('drops a pair whose tab is not kept, whose tabs are no longer neighbours, a pinned one and one that overlaps', () => {
    const tabs = [
      four[0],
      tab('app://setup/'),
      four[1],
      { ...tab('https://c.example/'), pinned: true },
      four[3],
    ];
    const window = sessionWindow(tabs, 0, {
      splits: [
        // a with the setup guide, which the session does not keep.
        { start: 0, ratio: 0.5 },
        // b with the pinned c.
        { start: 2, ratio: 0.5 },
        // A tab that is not there.
        { start: 9, ratio: 0.5 },
      ],
    });
    expect(window).not.toHaveProperty('splits');
    const overlapping = sessionWindow(four, 0, {
      splits: [
        { start: 0, ratio: 0.5 },
        { start: 1, ratio: 0.6 },
        { start: 2, ratio: 0.7 },
      ],
    });
    expect(overlapping?.splits).toEqual([
      { start: 0, ratio: 0.5 },
      { start: 2, ratio: 0.7 },
    ]);
    // Without pairs, the window has no field for them, as before.
    expect(sessionWindow(four, 0, { splits: [] })).not.toHaveProperty('splits');
    expect(sessionWindow(four, 0)).not.toHaveProperty('splits');
  });

  it('reads each pair on its own, so that a broken one costs nothing else', () => {
    const file = (splits: unknown): unknown => ({
      version: 1,
      windows: [{ tabs: four, active: 1, splits }],
    });
    expect(
      parseSession(
        file([
          { start: 0, ratio: 0.3 },
          { start: 'x' },
          null,
          { start: 2, ratio: 2 },
          { start: 2, ratio: 0.6 },
        ]),
      ),
    ).toEqual({
      version: 1,
      windows: [
        {
          tabs: four,
          active: 1,
          splits: [
            { start: 0, ratio: 0.3 },
            { start: 2, ratio: 0.6 },
          ],
        },
      ],
    });
    // A field that is no list costs only the pairs.
    expect(parseSession(file('broken'))).toEqual({
      version: 1,
      windows: [{ tabs: four, active: 1 }],
    });
  });

  it('opens the pairs again with their windows', () => {
    const session = parseSession({
      version: 1,
      windows: [
        { tabs: four, active: 3, splits: [{ start: 1, ratio: 0.25 }] },
        { tabs: [four[0]], active: 0 },
      ],
    });
    expect(
      session === undefined ? [] : restoredWindows(session).map((window) => window.splits),
    ).toEqual([[{ start: 1, ratio: 0.25 }], undefined]);
  });
});

describe('groups of tabs in the session', () => {
  const news = { id: 'g4', name: 'News', color: 'orange', collapsed: true } as const;

  it('keeps the group of each tab, and drops a group that cannot be read on its own', () => {
    const file = {
      version: 1,
      windows: [
        {
          tabs: [
            { ...tab('https://a.example/'), group: news },
            // A group of a later version may have more fields, which this one leaves out.
            { ...tab('https://b.example/'), group: { ...news, icon: 'star' } },
            { ...tab('https://c.example/'), group: { ...news, color: 'pink' } },
            { ...tab('https://d.example/'), group: { ...news, name: 'x'.repeat(51) } },
            { ...tab('https://e.example/'), group: { ...news, id: '../g4' } },
            { ...tab('https://f.example/'), group: 'g4' },
            { ...tab('https://g.example/'), group: { ...news, collapsed: 'yes' } },
          ],
          active: 1,
        },
      ],
    };
    const session = parseSession(file);
    expect(session?.windows[0]?.tabs).toEqual([
      { ...tab('https://a.example/'), group: news },
      { ...tab('https://b.example/'), group: news },
      ...['c', 'd', 'e', 'f', 'g'].map((name) => tab(`https://${name}.example/`)),
    ]);
    // What this version writes, it reads back as it was.
    const written: unknown = JSON.parse(JSON.stringify(session));
    expect(parseSession(written)).toEqual(session);
  });

  it('opens the tabs again with their groups', () => {
    const session = parseSession({
      version: 1,
      windows: [
        {
          tabs: [tab('https://a.example/'), { ...tab('https://b.example/'), group: news }],
          active: 0,
        },
      ],
    });
    expect(
      session === undefined ? [] : restoredWindows(session)[0]?.tabs.map((one) => one.group),
    ).toEqual([undefined, news]);
  });
});
