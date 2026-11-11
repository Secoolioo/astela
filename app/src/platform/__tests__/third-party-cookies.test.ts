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

function request(
  url: string,
  page: string,
  resourceType = 'image',
): OnBeforeSendHeadersListenerDetails {
  const contents = { session, getURL: () => page } as unknown as WebContents;
  return {
    url,
    resourceType,
    webContents: contents,
    frame: null,
  } as unknown as OnBeforeSendHeadersListenerDetails;
}

describe('ThirdPartyCookies', () => {
  it('keeps cookies away from requests and responses of other sites only', async () => {
    const cookies = new ThirdPartyCookies({ blocked: () => true, allowedSites: () => [] });
    const page = 'https://www.example.co.uk/article';
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
      await cookies.removedRequestHeaders(request('https://tracker.example/', page, 'mainFrame')),
    ).toBeUndefined();
    const response = request(
      'https://tracker.example/pixel',
      page,
    ) as unknown as OnHeadersReceivedListenerDetails;
    expect(await cookies.removedResponseHeaders(response)).toEqual(['set-cookie']);
  });

  it('leaves cookies when blocking is off and on the pages of allowed sites', async () => {
    let blocked = false;
    const cookies = new ThirdPartyCookies({
      blocked: () => blocked,
      allowedSites: () => ['example.org'],
    });
    expect(
      await cookies.removedRequestHeaders(
        request('https://tracker.example/', 'https://example.com/'),
      ),
    ).toBeUndefined();
    blocked = true;
    expect(
      await cookies.removedRequestHeaders(
        request('https://login.example/', 'https://app.example.org/'),
      ),
    ).toBeUndefined();
    expect(
      await cookies.blocksFrame('https://tracker.example/', 'https://example.com/', session),
    ).toBe(true);
    expect(
      await cookies.blocksFrame('https://example.com/frame', 'https://www.example.com/', session),
    ).toBe(false);
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
