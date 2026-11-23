import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  parseUrlFilter,
  URLAllowlist,
  URLBlocklist,
  urlFilterLimit,
  urlFilters,
} from '../policy/url-filter.ts';

/** Whether the lists block an address. */
function blocked(blocklist: readonly string[], allowlist: readonly string[], url: string): boolean {
  return urlFilters(blocklist, allowlist).filter.blocks(url);
}

describe('urlFilters', () => {
  // The examples of Chrome's documentation of the filter format.
  it('blocks a host and its subdomains', () => {
    for (const url of [
      'https://example.com/',
      'http://www.example.com/page',
      'https://sub.www.example.com/',
      'https://example.com:8443/x',
    ]) {
      expect(blocked(['example.com'], [], url)).toBe(true);
    }
    expect(blocked(['example.com'], [], 'https://notexample.com/')).toBe(false);
    expect(blocked(['example.com'], [], 'https://example.org/')).toBe(false);
  });

  it('blocks only the host itself after a dot', () => {
    expect(blocked(['.example.com'], [], 'https://example.com/docs')).toBe(true);
    expect(blocked(['.example.com'], [], 'https://www.example.com/')).toBe(false);
    expect(blocked(['.www.example.com'], [], 'https://www.example.com/')).toBe(true);
    expect(blocked(['.www.example.com'], [], 'https://a.www.example.com/')).toBe(false);
    expect(blocked(['mail.example.com'], [], 'https://www.example.com/')).toBe(false);
  });

  it('blocks a scheme', () => {
    expect(blocked(['http://example.com'], [], 'http://www.example.com/')).toBe(true);
    expect(blocked(['http://example.com'], [], 'https://example.com/')).toBe(false);
    expect(blocked(['https://*'], [], 'https://any.example.org/')).toBe(true);
    expect(blocked(['https://*'], [], 'http://any.example.org/')).toBe(false);
    expect(blocked(['ftp:*'], [], 'ftp://files.example.org/')).toBe(true);
  });

  it('blocks every address with *', () => {
    expect(blocked(['*'], [], 'https://example.org/')).toBe(true);
    expect(blocked(['*'], [], 'http://192.168.1.2:8080/')).toBe(true);
    expect(blocked(['*'], [], 'file:///home/user/a.html')).toBe(true);
  });

  it('blocks a port', () => {
    expect(blocked(['*:8080'], [], 'http://example.org:8080/')).toBe(true);
    expect(blocked(['*:8080'], [], 'http://example.org/')).toBe(false);
    // An address without a port has the port of its scheme.
    expect(blocked(['example.org:443'], [], 'https://example.org/')).toBe(true);
    expect(blocked(['example.org:443'], [], 'http://example.org/')).toBe(false);
  });

  it('blocks the start of a path', () => {
    expect(blocked(['example.com/stuff'], [], 'https://example.com/stuff')).toBe(true);
    expect(blocked(['example.com/stuff'], [], 'https://www.example.com/stuff/more')).toBe(true);
    expect(blocked(['example.com/stuff'], [], 'https://example.com/other')).toBe(false);
    expect(blocked(['*/html/crosh.html'], [], 'https://any.example/html/crosh.html')).toBe(true);
    expect(blocked(['example.com/bücher'], [], 'https://example.com/b%C3%BCcher/1')).toBe(true);
  });

  it('blocks an IP address only itself', () => {
    expect(blocked(['192.168.1.2'], [], 'http://192.168.1.2/')).toBe(true);
    expect(blocked(['192.168.1.2'], [], 'http://192.168.1.20/')).toBe(false);
    expect(blocked(['[::1]'], [], 'http://[::1]:8000/')).toBe(true);
  });

  it('blocks by the parameters of the query', () => {
    const list = ['youtube.com/watch?v=V1'];
    expect(blocked(list, [], 'https://www.youtube.com/watch?v=V1')).toBe(true);
    expect(blocked(list, [], 'https://www.youtube.com/watch?t=3&v=V1')).toBe(true);
    expect(blocked(list, [], 'https://www.youtube.com/watch?v=V2')).toBe(false);
    expect(blocked(['example.com?q=start*'], [], 'https://example.com/?q=started')).toBe(true);
    expect(blocked(['example.com?q=start*'], [], 'https://example.com/?q=stop')).toBe(false);
    expect(blocked(['example.com?debug'], [], 'https://example.com/?debug=1')).toBe(true);
    expect(blocked(['example.com?debug'], [], 'https://example.com/?other=1')).toBe(false);
  });

  it('blocks local files by the start of their path', () => {
    expect(blocked(['file://*'], [], 'file:///etc/hosts')).toBe(true);
    expect(blocked(['file:///home/user/private'], [], 'file:///home/user/private/a.txt')).toBe(
      true,
    );
    expect(blocked(['file:///home/user/private'], [], 'file:///home/user/public.txt')).toBe(false);
    expect(blocked(['example.com'], [], 'file:///home/user/example.com')).toBe(false);
  });

  it('reads filters of local files of Windows as Chromium writes their addresses', () => {
    // Chromium writes the drive in upper case and the folders with `/`, as Chrome reads the
    // filters.
    const file = 'file:///C:/Users/x.html';
    for (const filter of [
      'file:///c:/Users/',
      'file:///C:\\Users\\',
      'file://c:/Users',
      'file:///c|/Users/',
    ]) {
      expect(blocked([filter], [], file)).toBe(true);
    }
    expect(blocked(['file:///c:/Users/'], [], 'file:///C:/Windows/x.html')).toBe(false);
    expect(blocked(['file:///D:/'], [], file)).toBe(false);
    expect(parseUrlFilter('file:///c:\\Users\\Me', false)?.path).toBe('/C:/Users/Me');
    // A server of the path does not count.
    expect(parseUrlFilter('file://server/share/', false)?.path).toBe('/share/');
  });

  it('lets the allowlist make exceptions', () => {
    const blocklist = ['blocked.qa.test', 'example.com'];
    const allowlist = ['open.blocked.qa.test'];
    expect(blocked(blocklist, allowlist, 'http://blocked.qa.test:8000/')).toBe(true);
    expect(blocked(blocklist, allowlist, 'http://www.blocked.qa.test:8000/')).toBe(true);
    expect(blocked(blocklist, allowlist, 'http://open.blocked.qa.test:8000/')).toBe(false);
    expect(blocked(blocklist, allowlist, 'http://a.open.blocked.qa.test/')).toBe(false);
    // Everything blocked but a few sites, as Chrome's documentation shows.
    expect(blocked(['*'], ['mail.example.com'], 'https://mail.example.com/inbox')).toBe(false);
    expect(blocked(['*'], ['mail.example.com'], 'https://example.com/')).toBe(true);
  });

  it('decides by the most specific filter, and the allowlist on a tie', () => {
    // A host without its subdomains counts more than a longer one with them.
    expect(blocked(['www.example.com'], ['.www.example.com'], 'https://www.example.com/')).toBe(
      false,
    );
    expect(blocked(['.www.example.com'], ['www.example.com'], 'https://www.example.com/')).toBe(
      true,
    );
    // Then the longer host, the longer path and the more conditions on the query.
    expect(blocked(['a.example.com'], ['example.com'], 'https://a.example.com/')).toBe(true);
    expect(blocked(['example.com/a/b'], ['example.com/a'], 'https://example.com/a/b')).toBe(true);
    expect(blocked(['example.com/a'], ['example.com/a/b'], 'https://example.com/a/b')).toBe(false);
    expect(
      blocked(['example.com?a=1&b=2'], ['example.com?a=1'], 'https://example.com/?a=1&b=2'),
    ).toBe(true);
    // A scheme or a port alone does not make a filter more specific: the allowlist wins.
    expect(blocked(['https://example.com'], ['example.com'], 'https://example.com/')).toBe(false);
    expect(blocked(['example.com'], ['example.com'], 'https://example.com/')).toBe(false);
    expect(blocked(['*'], ['*'], 'https://example.com/')).toBe(false);
    // Any other filter counts more than `*`.
    expect(blocked(['https://*'], ['*'], 'https://example.com/')).toBe(true);
  });

  it('never blocks the browser’s own pages', () => {
    expect(blocked(['*'], [], 'app://settings/')).toBe(false);
    expect(blocked(['*'], [], 'about:blank')).toBe(false);
    expect(blocked(['settings'], [], 'app://settings/')).toBe(false);
  });

  it('leaves the internal pages of Chromium to filters of their own, as Chrome does with *', () => {
    // The PDF viewer runs as an extension, in a frame of the page that shows the PDF.
    const viewer = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html';
    expect(blocked(['*'], [], viewer)).toBe(false);
    expect(blocked(['*'], [], 'devtools://devtools/bundled/devtools_app.html')).toBe(false);
    expect(blocked(['*'], [], 'chrome-search://local-ntp/')).toBe(false);
    // A filter that names them blocks them, and `*` still blocks other schemes.
    expect(blocked(['chrome-extension://*'], [], viewer)).toBe(true);
    expect(blocked(['*', 'devtools://*'], [], 'devtools://devtools/')).toBe(true);
    expect(blocked(['*'], [], 'chrome://gpu/')).toBe(true);
  });

  it('blocks blobs by the address inside them', () => {
    expect(blocked(['example.com'], [], 'blob:https://example.com/0c3f1d6b')).toBe(true);
    expect(blocked(['example.com'], [], 'blob:https://example.org/0c3f1d6b')).toBe(false);
  });

  it('names the entries that are no filters or come after the limit', () => {
    const many = Array.from({ length: urlFilterLimit + 2 }, (_, index) => `host${index}.test`);
    const { filter, ignored, counts } = urlFilters(
      ['example.com', '', 'a b', 'example.com:99999'],
      many,
    );
    expect(counts).toEqual({ URLBlocklist: 1, URLAllowlist: urlFilterLimit });
    expect(ignored).toEqual([
      { policy: 'URLBlocklist', positions: [2, 3, 4], reason: 'not a filter' },
      {
        policy: 'URLAllowlist',
        positions: [urlFilterLimit + 1, urlFilterLimit + 2],
        reason: 'beyond the limit',
      },
    ]);
    // The other entries count all the same.
    expect(filter.blocks('https://example.com/')).toBe(true);
    expect(filter.blocks(`https://host${String(urlFilterLimit - 1)}.test/`)).toBe(false);
  });

  it('blocks nothing without entries', () => {
    expect(urlFilters([], []).filter.blocks('https://example.com/')).toBe(false);
    expect(blocked([], ['example.com'], 'https://example.org/')).toBe(false);
  });
});

/** The Punycode of the one international name of the tests, and lower case for the others. */
function punycode(host: string): string {
  return host.toLowerCase() === 'bücher.example' ? 'xn--bcher-kva.example' : host.toLowerCase();
}

describe('parseUrlFilter', () => {
  it('reads the parts of a filter', () => {
    expect(parseUrlFilter('https://.Example.COM:8443/path?a=1&b=x*&c', false)).toEqual({
      scheme: 'https',
      host: 'example.com',
      subdomains: false,
      port: 8443,
      path: '/path',
      query: [
        { key: 'a', value: '1', prefix: false },
        { key: 'b', value: 'x', prefix: true },
        { key: 'c', value: undefined, prefix: false },
      ],
      allow: false,
    });
  });

  it('takes international host names in the form that the browser gives it', () => {
    expect(parseUrlFilter('Bücher.example', true, punycode)).toMatchObject({
      host: 'xn--bcher-kva.example',
      subdomains: true,
      allow: true,
    });
    expect(
      urlFilters(['bücher.example'], [], punycode).filter.blocks(
        'https://www.xn--bcher-kva.example/',
      ),
    ).toBe(true);
    // Without that form, such a name is no host.
    expect(parseUrlFilter('bücher.example', false)).toBeUndefined();
  });

  it.each([
    '',
    '  ',
    'a b',
    'example.com:0',
    'example.com:65536',
    'example.com:x',
    ':80',
    '*.example.com',
    'http://',
  ])('refuses %j', (filter) => {
    expect(parseUrlFilter(filter, false)).toBeUndefined();
  });
});

describe('URLBlocklist and URLAllowlist', () => {
  it('take lists of filters, also more than the limit', () => {
    const many = Array.from({ length: urlFilterLimit + 1 }, () => 'example.com');
    expect(v.safeParse(URLBlocklist.schema, many).success).toBe(true);
    expect(v.safeParse(URLAllowlist.schema, ['a b']).success).toBe(true);
    expect(v.safeParse(URLBlocklist.schema, 'example.com').success).toBe(false);
  });

  it('take long entries too, which keep the other entries of the list', () => {
    // A deep link with a long query, as Chrome takes it: one entry must not spoil the list.
    const deep = `example.org/watch?list=${'x'.repeat(2100)}`;
    expect(v.safeParse(URLBlocklist.schema, ['social.example', deep]).success).toBe(true);
    expect(v.safeParse(URLAllowlist.schema, [deep]).success).toBe(true);
    const { filter, ignored } = urlFilters(['social.example', deep], []);
    expect(ignored).toEqual([]);
    expect(filter.blocks('https://social.example/')).toBe(true);
    expect(filter.blocks(`https://example.org/watch?list=${'x'.repeat(2100)}`)).toBe(true);
  });
});
