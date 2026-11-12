import type {
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { HttpsFirst, secureAnswerTimeout } from '../electron/https-first.ts';

const session = {} as Session;
const page = (): WebContents => ({ session }) as unknown as WebContents;

function request(contents: WebContents, id: number, url: string): OnBeforeRequestListenerDetails {
  return {
    id,
    url,
    resourceType: 'mainFrame',
    webContents: contents,
  } as unknown as OnBeforeRequestListenerDetails;
}

function response(
  contents: WebContents,
  id: number,
  statusCode: number,
): OnHeadersReceivedListenerDetails {
  return {
    id,
    statusCode,
    resourceType: 'mainFrame',
    webContents: contents,
  } as unknown as OnHeadersReceivedListenerDetails;
}

describe('HttpsFirst', () => {
  it('sends a page to the secure address and offers the insecure one when that fails', async () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    expect(await https.beforeRequest(request(contents, 1, 'http://example.org/a'))).toEqual({
      redirectURL: 'https://example.org/a',
    });
    // The redirected request keeps its id and is not changed again.
    expect(
      await https.beforeRequest(request(contents, 1, 'https://example.org/a')),
    ).toBeUndefined();
    expect(https.insecureAddressFor(contents, 'https://other.example/')).toBeUndefined();
    expect(https.insecureAddressFor(contents, 'https://example.org/a')).toBe(
      'http://example.org/a',
    );
    expect(https.insecureAddressFor(contents, 'https://example.org/a')).toBeUndefined();
  });

  it('stops a secure address that sends the page back to the insecure one', async () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    await https.beforeRequest(request(contents, 7, 'http://example.org/'));
    https.headersReceived(response(contents, 7, 301));
    expect(await https.beforeRequest(request(contents, 7, 'http://example.org/'))).toEqual({
      cancel: true,
    });
    expect(https.insecureAddressFor(contents, 'http://example.org/')).toBe('http://example.org/');
  });

  it('forgets a navigation that loaded securely or that another one replaced', async () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    await https.beforeRequest(request(contents, 1, 'http://example.org/'));
    https.headersReceived(response(contents, 1, 200));
    expect(https.insecureAddressFor(contents, 'https://example.org/')).toBeUndefined();
    await https.beforeRequest(request(contents, 2, 'http://example.org/'));
    await https.beforeRequest(request(contents, 3, 'https://other.example/'));
    expect(https.insecureAddressFor(contents, 'https://example.org/')).toBeUndefined();
    // A new navigation to the insecure address of the same site is upgraded again.
    expect(await https.beforeRequest(request(contents, 4, 'http://example.org/'))).toEqual({
      redirectURL: 'https://example.org/',
    });
  });

  it('leaves sites alone when it is off, after continuing, and for other requests', async () => {
    let enabled = false;
    const https = new HttpsFirst({ enabled: () => enabled, allowlist: () => ['intranet.example'] });
    const contents = page();
    expect(await https.beforeRequest(request(contents, 1, 'http://example.org/'))).toBeUndefined();
    enabled = true;
    expect(
      await https.beforeRequest(request(contents, 2, 'http://intranet.example/')),
    ).toBeUndefined();
    https.allow(contents, 'http://example.org/page');
    expect(await https.beforeRequest(request(contents, 3, 'http://example.org/'))).toBeUndefined();
    // Another session, such as that of a private window, has its own exceptions.
    const other = { session: {} as Session } as unknown as WebContents;
    expect(await https.beforeRequest(request(other, 4, 'http://example.org/'))).toEqual({
      redirectURL: 'https://example.org/',
    });
    const image = { ...request(contents, 5, 'http://cdn.example/a.png'), resourceType: 'image' };
    expect(await https.beforeRequest(image as OnBeforeRequestListenerDetails)).toBeUndefined();
  });

  it('leaves names under no public suffix, such as those of routers, insecure', async () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    for (const url of ['http://fritz.box/', 'http://speedport.ip/', 'http://printer.corp/']) {
      expect(await https.beforeRequest(request(contents, 1, url))).toBeUndefined();
    }
    expect(await https.beforeRequest(request(contents, 2, 'http://example.co.uk/'))).toEqual({
      redirectURL: 'https://example.co.uk/',
    });
  });

  it('shows the warning when the secure address gives no answer in time', async () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const stop = vi.fn();
    const contents = { session, stop, isDestroyed: () => false } as unknown as WebContents;
    // The list of public suffixes loads before the clock stands still.
    await https.beforeRequest(request(contents, 1, 'http://example.org/a'));
    vi.useFakeTimers();
    try {
      // A load that someone stopped before the time is up shows no warning.
      expect(https.insecureAddressFor(contents, 'https://example.org/a', true)).toBeUndefined();
      await https.beforeRequest(request(contents, 2, 'http://example.org/a'));
      vi.advanceTimersByTime(secureAnswerTimeout);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(https.insecureAddressFor(contents, 'https://example.org/a', true)).toBe(
        'http://example.org/a',
      );
      // An answer in time lets the load go on.
      await https.beforeRequest(request(contents, 3, 'http://example.org/b'));
      https.headersReceived(response(contents, 3, 200));
      vi.advanceTimersByTime(secureAnswerTimeout);
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
