import { describe, expect, it } from 'vitest';
import { keepsUrl, parseSession } from '../session/session.ts';

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

  it('rejects broken or empty sessions', () => {
    expect(parseSession(undefined)).toBeUndefined();
    expect(parseSession({ version: 2, windows: [] })).toBeUndefined();
    expect(
      parseSession({ version: 1, windows: [{ tabs: [tab('about:blank')], active: 0 }] }),
    ).toBeUndefined();
  });
});
