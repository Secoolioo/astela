import { describe, expect, it } from 'vitest';
import { keepsUrl, parseSession, restoredWindows, sessionWindow } from '../session/session.ts';
import { parseBeta6Session } from './beta6-session.ts';

const tab = (url: string): { url: string; title: string } => ({ url, title: url });

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
          { tabs: [tab('app://newtab/')], active: 0 },
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
      { tabs: [{ ...tab('app://newtab/'), pinned: false }], active: 0, place: {} },
    ]);
  });
});

/** A back and forward history of a tab, in the form that a later version keeps it. */
const history = (url: string): unknown => ({
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
          { ...tab('https://a.example/'), group: 'g1', workspace: 'w1' },
          { ...tab('https://b.example/'), group: 'g1', workspace: 'w1', current: true },
          { ...tab('app://settings/'), workspace: 'w1' },
        ],
        active: 3,
        bounds,
        maximized: false,
        fullScreen: true,
        splits: [{ start: 2, ratio: 0.4 }],
        groups: [{ id: 'g1', name: 'Work', color: 'blue', collapsed: false }],
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
    // This version reads the fields it does not know yet the same way.
    expect(parseSession(later)).toEqual(kept);
  });

  it('writes sessions that 0.1.0-beta.6 reads with every tab and the active tab', () => {
    const window = sessionWindow(
      [
        { ...tab('https://mail.example/'), pinned: true },
        tab('app://setup/'),
        { url: 'https://a.example/', title: 'x'.repeat(2000) },
        tab('app://history/'),
      ],
      3,
      { bounds, maximized: true },
    );
    const written: unknown = JSON.parse(JSON.stringify({ version: 1, windows: [window] }));
    expect(written).toEqual({
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
    expect(parseBeta6Session(written)).toEqual(written);
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
