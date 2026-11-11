import type {
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
} from 'electron';
import { describe, expect, it } from 'vitest';
import { HttpsFirst } from '../electron/https-first.ts';

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
  it('sends a page to the secure address and offers the insecure one when that fails', () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    expect(https.beforeRequest(request(contents, 1, 'http://example.org/a'))).toEqual({
      redirectURL: 'https://example.org/a',
    });
    // The redirected request keeps its id and is not changed again.
    expect(https.beforeRequest(request(contents, 1, 'https://example.org/a'))).toBeUndefined();
    expect(https.insecureAddressFor(contents, 'https://other.example/')).toBeUndefined();
    expect(https.insecureAddressFor(contents, 'https://example.org/a')).toBe(
      'http://example.org/a',
    );
    expect(https.insecureAddressFor(contents, 'https://example.org/a')).toBeUndefined();
  });

  it('stops a secure address that sends the page back to the insecure one', () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    https.beforeRequest(request(contents, 7, 'http://example.org/'));
    https.headersReceived(response(contents, 7, 301));
    expect(https.beforeRequest(request(contents, 7, 'http://example.org/'))).toEqual({
      cancel: true,
    });
    expect(https.insecureAddressFor(contents, 'http://example.org/')).toBe('http://example.org/');
  });

  it('forgets a navigation that loaded securely or that another one replaced', () => {
    const https = new HttpsFirst({ enabled: () => true, allowlist: () => [] });
    const contents = page();
    https.beforeRequest(request(contents, 1, 'http://example.org/'));
    https.headersReceived(response(contents, 1, 200));
    expect(https.insecureAddressFor(contents, 'https://example.org/')).toBeUndefined();
    https.beforeRequest(request(contents, 2, 'http://example.org/'));
    https.beforeRequest(request(contents, 3, 'https://other.example/'));
    expect(https.insecureAddressFor(contents, 'https://example.org/')).toBeUndefined();
    // A new navigation to the insecure address of the same site is upgraded again.
    expect(https.beforeRequest(request(contents, 4, 'http://example.org/'))).toEqual({
      redirectURL: 'https://example.org/',
    });
  });

  it('leaves sites alone when it is off, after continuing, and for other requests', () => {
    let enabled = false;
    const https = new HttpsFirst({ enabled: () => enabled, allowlist: () => ['intranet.example'] });
    const contents = page();
    expect(https.beforeRequest(request(contents, 1, 'http://example.org/'))).toBeUndefined();
    enabled = true;
    expect(https.beforeRequest(request(contents, 2, 'http://intranet.example/'))).toBeUndefined();
    https.allow(contents, 'http://example.org/page');
    expect(https.beforeRequest(request(contents, 3, 'http://example.org/'))).toBeUndefined();
    // Another session, such as that of a private window, has its own exceptions.
    const other = { session: {} as Session } as unknown as WebContents;
    expect(https.beforeRequest(request(other, 4, 'http://example.org/'))).toEqual({
      redirectURL: 'https://example.org/',
    });
    const image = { ...request(contents, 5, 'http://cdn.example/a.png'), resourceType: 'image' };
    expect(https.beforeRequest(image as OnBeforeRequestListenerDetails)).toBeUndefined();
  });
});
