import type { OnBeforeSendHeadersListenerDetails } from 'electron';
import { describe, expect, it } from 'vitest';
import { navigationHints, takesClientHints } from '../electron/client-hints.ts';
import { RequestPipeline } from '../electron/request-pipeline.ts';

/** The name of a system in the hints. */
const platform = (system: NodeJS.Platform): string =>
  navigationHints('156', system)['sec-ch-ua-platform'];

describe('navigationHints', () => {
  it('lists the brands in the order and with the GREASE brand that Blink reports', () => {
    // Both values were seen in requests of Electron 45 and of Chromium 153.
    expect(navigationHints('156.0.8078.80', 'linux')).toEqual({
      'sec-ch-ua': '"Not:A-Brand";v="8", "Chromium";v="156"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Linux"',
    });
    expect(navigationHints('153.0.7204.4', 'win32')['sec-ch-ua']).toBe(
      '"Chromium";v="153", "Not_A Brand";v="8"',
    );
  });

  it('names each system as Chromium does', () => {
    expect([platform('win32'), platform('darwin'), platform('linux'), platform('freebsd')]).toEqual(
      ['"Windows"', '"macOS"', '"Linux"', '"Unknown"'],
    );
  });
});

describe('takesClientHints', () => {
  it('sends hints to secure sites and to the local host only', () => {
    expect(
      [
        'https://example.com/',
        'http://localhost:8080/',
        'http://app.localhost/',
        'http://127.0.0.1:3000/',
        'http://[::1]/',
        'http://example.com/',
        'http://192.168.1.1/',
        'ftp://example.com/',
        'not an address',
      ].map(takesClientHints),
    ).toEqual([true, true, true, true, true, false, false, false, false]);
  });
});

describe('RequestPipeline client hints', () => {
  const hints = navigationHints('156.0.8078.80', 'linux');
  /** What the pipeline sends for a request. */
  const sent = (url: string, resourceType: string, requestHeaders: Record<string, string>) =>
    new Promise((done) => {
      const pipeline = new RequestPipeline(hints);
      pipeline.add({ beforeRequest: () => undefined });
      pipeline.beforeSendHeaders(
        { url, resourceType, requestHeaders } as unknown as OnBeforeSendHeadersListenerDetails,
        done,
      );
    });

  it('puts the hints first for a document and a frame of a secure site', async () => {
    const answer = (await sent('https://example.com/', 'mainFrame', {
      'Upgrade-Insecure-Requests': '1',
      'User-Agent': 'UA',
    })) as { requestHeaders: Record<string, string> };
    expect(Object.entries(answer.requestHeaders)).toEqual([
      ['sec-ch-ua', '"Not:A-Brand";v="8", "Chromium";v="156"'],
      ['sec-ch-ua-mobile', '?0'],
      ['sec-ch-ua-platform', '"Linux"'],
      ['Upgrade-Insecure-Requests', '1'],
      ['User-Agent', 'UA'],
    ]);
    expect(await sent('http://127.0.0.1:8080/frame', 'subFrame', {})).toEqual({
      requestHeaders: hints,
    });
  });

  it('removes the hints once a redirect leads to a site that is not trustworthy', async () => {
    expect(
      await sent('http://example.com/', 'mainFrame', { ...hints, 'User-Agent': 'UA' }),
    ).toEqual({ requestHeaders: { 'User-Agent': 'UA' } });
  });

  it('leaves the requests of a page to Blink', async () => {
    expect(await sent('https://example.com/a.png', 'image', { 'User-Agent': 'UA' })).toEqual({});
  });
});
