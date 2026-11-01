import { describe, expect, it } from 'vitest';
import { keepsUrl, parseSession, sessionWindow } from '../session/session.ts';

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

  it('rejects broken or empty sessions', () => {
    expect(parseSession(undefined)).toBeUndefined();
    expect(parseSession({ version: 2, windows: [] })).toBeUndefined();
    expect(
      parseSession({ version: 1, windows: [{ tabs: [tab('about:blank')], active: 0 }] }),
    ).toBeUndefined();
  });
});
