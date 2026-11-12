import type {
  OnBeforeSendHeadersListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebContents,
} from 'electron';
import { describe, expect, it } from 'vitest';
import { withoutHeaders } from '../electron/request-pipeline.ts';
import { ThirdPartyCookies } from '../electron/third-party-cookies.ts';

const session = {} as Session;

/** A request of a page, whose origin the frame of the request gives, or else its tab. */
function request(
  url: string,
  pageOrigin: string,
  resourceType = 'image',
  frameTop?: string,
): OnBeforeSendHeadersListenerDetails {
  const contents = { session, mainFrame: { origin: pageOrigin } } as unknown as WebContents;
  return {
    url,
    resourceType,
    webContents: contents,
    frame: frameTop === undefined ? null : { top: { origin: frameTop } },
  } as unknown as OnBeforeSendHeadersListenerDetails;
}

describe('ThirdPartyCookies', () => {
  it('keeps cookies away from requests and responses of other sites only', async () => {
    const cookies = new ThirdPartyCookies({ blocked: () => true });
    const page = 'https://www.example.co.uk';
    expect(
      await cookies.removedRequestHeaders(request('https://tracker.example/pixel', page)),
    ).toEqual(['cookie']);
    expect(
      await cookies.removedRequestHeaders(request('https://static.example.co.uk/a.js', page)),
    ).toBeUndefined();
    expect(await cookies.removedRequestHeaders(request('https://other.co.uk/a.js', page))).toEqual([
      'cookie',
    ]);
    expect(
      await cookies.removedRequestHeaders(request('wss://tracker.example/socket', page)),
    ).toEqual(['cookie']);
    expect(
      await cookies.removedRequestHeaders(request('https://tracker.example/', page, 'mainFrame')),
    ).toBeUndefined();
    const response = request(
      'https://tracker.example/pixel',
      page,
    ) as unknown as OnHeadersReceivedListenerDetails;
    expect(await cookies.removedResponseHeaders(response)).toEqual(['set-cookie']);
  });

  it('takes the page from the origin of the frame, also for pages without an address', async () => {
    const cookies = new ThirdPartyCookies({ blocked: () => true });
    // A `blob:` page or an `about:blank` popup has the origin of the page that made it.
    expect(
      await cookies.removedRequestHeaders(
        request('https://tracker.example/pixel', 'null', 'image', 'https://news.example'),
      ),
    ).toEqual(['cookie']);
    expect(
      await cookies.removedRequestHeaders(
        request('https://cdn.news.example/a.js', 'null', 'image', 'https://news.example'),
      ),
    ).toBeUndefined();
    // A page with an opaque origin is no first party, so every site is another one.
    expect(
      await cookies.removedRequestHeaders(request('https://news.example/a.js', 'null')),
    ).toEqual(['cookie']);
    // Addresses without a site carry no cookies to keep away.
    expect(
      await cookies.removedRequestHeaders(request('data:text/plain,a', 'https://news.example')),
    ).toBeUndefined();
  });

  it('leaves cookies when blocking is off, and tells which frames get none', async () => {
    let blocked = false;
    const cookies = new ThirdPartyCookies({ blocked: () => blocked });
    expect(
      await cookies.removedRequestHeaders(
        request('https://tracker.example/', 'https://example.com'),
      ),
    ).toBeUndefined();
    expect(
      await cookies.blocksFrame('https://tracker.example', 'https://example.com', session),
    ).toBe(false);
    blocked = true;
    expect(
      await cookies.blocksFrame('https://tracker.example', 'https://example.com', session),
    ).toBe(true);
    expect(
      await cookies.blocksFrame('https://example.com', 'https://www.example.com', session),
    ).toBe(false);
    // A frame with an opaque origin cannot use cookies at all.
    expect(await cookies.blocksFrame('null', 'https://example.com', session)).toBe(false);
    expect(await cookies.blocksFrame('https://tracker.example', 'null', session)).toBe(true);
  });
});

describe('withoutHeaders', () => {
  it('removes headers whatever their spelling', () => {
    expect(
      withoutHeaders({ Cookie: 'a=1', 'User-Agent': 'x', 'set-cookie': 'b' }, [
        'cookie',
        'Set-Cookie',
      ]),
    ).toEqual({
      'User-Agent': 'x',
    });
  });
});
