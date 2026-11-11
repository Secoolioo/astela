import { FiltersEngine } from '@ghostery/adblocker';
import type {
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
} from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import { ContentBlocker } from '../blocker/content-blocker.ts';
import { resourceUrl } from '../blocker/resource-protocol.ts';
import {
  addHeaders,
  RequestPipeline,
  type RequestInterceptor,
} from '../electron/request-pipeline.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const logger = (): SinkLogger =>
  new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });

function dataDir(filters: string, popups?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blocker-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'engine.bin'),
    FiltersEngine.parse(filters, { loadExtendedSelectors: true }).serialize(),
  );
  if (popups !== undefined) {
    writeFileSync(join(dir, 'popups.bin'), FiltersEngine.parse(popups).serialize());
  }
  return dir;
}

const request = (
  url: string,
  resourceType: string,
  webContentsId = 3,
): OnBeforeRequestListenerDetails =>
  ({
    url,
    resourceType,
    webContentsId,
    referrer: 'https://news.example/',
    frame: null,
  }) as unknown as OnBeforeRequestListenerDetails;

describe('ContentBlocker', () => {
  it('cancels matching subresources, counts them and leaves pages alone', async () => {
    const onBlocked = vi.fn();
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => true,
      onBlocked,
      logger: logger(),
    });
    expect(await blocker.beforeRequest(request('https://ads.example/a.js', 'script'))).toEqual({
      cancel: true,
    });
    expect(onBlocked).toHaveBeenCalledWith(3);
    expect(await blocker.beforeRequest(request('https://news.example/app.js', 'script'))).toBe(
      undefined,
    );
    expect(await blocker.beforeRequest(request('https://ads.example/', 'mainFrame'))).toBe(
      undefined,
    );
    expect(await blocker.beforeRequest(request('data:text/plain,x', 'image'))).toBe(undefined);
  });

  it('judges the first requests of a new page by that page, not by the one before it', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      // The blocker is off on the page before, which the tab still reports.
      enabled: (page) => !page.startsWith('https://allowed.example/'),
      logger: logger(),
    });
    const early = {
      ...request('https://ads.example/a.js', 'script'),
      webContents: { getURL: () => 'https://allowed.example/' },
    } as unknown as OnBeforeRequestListenerDetails;
    expect(await blocker.beforeRequest(early)).toEqual({ cancel: true });
    const unknown = {
      ...early,
      frame: { top: { url: '' } },
    } as unknown as OnBeforeRequestListenerDetails;
    expect(await blocker.beforeRequest(unknown)).toEqual({ cancel: true });
    // The top frame can still be the page before, until the browser knows the new one.
    const stale = {
      ...early,
      frame: { parent: null, top: { url: 'https://allowed.example/' } },
    } as unknown as OnBeforeRequestListenerDetails;
    expect(await blocker.beforeRequest(stale)).toEqual({ cancel: true });
    // A request of an embedded frame belongs to the top page, whatever frame made it.
    const embedded = {
      ...early,
      referrer: 'https://widget.example/',
      frame: { parent: {}, top: { url: 'https://allowed.example/' } },
    } as unknown as OnBeforeRequestListenerDetails;
    expect(await blocker.beforeRequest(embedded)).toBe(undefined);
    // Without a referrer, the tab's address is all there is.
    const noReferrer = { ...early, referrer: '' };
    expect(await blocker.beforeRequest(noReferrer)).toBe(undefined);
  });

  it('loads the engine with the first web page, not before', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => true,
      logger: logger(),
    });
    const load = vi.spyOn(blocker, 'load');
    expect(await blocker.beforeRequest(request('app://newtab/', 'mainFrame'))).toBe(undefined);
    expect(load).not.toHaveBeenCalled();
    expect(await blocker.beforeRequest(request('https://news.example/', 'mainFrame'))).toBe(
      undefined,
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('blocks nothing when it is off or its data is missing', async () => {
    let enabled = false;
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => enabled,
      logger: logger(),
    });
    expect(await blocker.beforeRequest(request('https://ads.example/a.js', 'script'))).toBe(
      undefined,
    );
    enabled = true;
    expect(await blocker.beforeRequest(request('https://ads.example/a.js', 'script'))).toEqual({
      cancel: true,
    });
    const missing = new ContentBlocker({
      dataDir: join(tmpdir(), 'no-such-blocker-data'),
      enabled: () => true,
      logger: logger(),
    });
    expect(await missing.load()).toBe(undefined);
    expect(await missing.beforeRequest(request('https://ads.example/a.js', 'script'))).toBe(
      undefined,
    );
  });
});

describe('ContentBlocker cosmetics', () => {
  it('gives frames their hiding rules and scriptlets, and hides reported elements', async () => {
    const dir = dataDir('news.example##.banner\n##.generic-ad\n');
    let enabled = true;
    const blocker = new ContentBlocker({ dataDir: dir, enabled: () => enabled, logger: logger() });
    expect(blocker.frameRules('https://news.example/')).toEqual({
      styles: '',
      scripts: [],
      extended: [],
      elements: false,
    });
    const loading = blocker.load();
    expect(blocker.loading()).toBe(loading);
    await loading;
    expect(blocker.loading()).toBeUndefined();
    const rules = blocker.frameRules('https://news.example/a');
    expect(rules.styles).toContain('.banner');
    expect(rules.elements).toBe(true);
    expect(blocker.frameRules('https://other.example/').styles).not.toContain('.banner');
    const report = { classes: ['generic-ad', 'content'], ids: [], hrefs: [] };
    expect(
      blocker.elementRules('https://other.example/', 'https://other.example/', report),
    ).toContain('.generic-ad');
    expect(blocker.frameRules('app://settings/').elements).toBe(false);
    enabled = false;
    expect(blocker.frameRules('https://news.example/a').styles).toBe('');
    expect(blocker.elementRules('https://other.example/', 'https://other.example/', report)).toBe(
      '',
    );
  });
});

describe('ContentBlocker procedural rules', () => {
  it('gives frames the procedural rules of their address', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('news.example##.promo:has-text(Sponsored)\nnews.example##.box:remove()\n'),
      enabled: () => true,
      logger: logger(),
    });
    await blocker.load();
    const { extended } = blocker.frameRules('https://news.example/a');
    expect(extended).toHaveLength(2);
    expect(extended.some((rule) => typeof rule.attribute === 'string')).toBe(true);
    expect(extended.some((rule) => rule.directive !== undefined)).toBe(true);
    expect(blocker.frameRules('https://other.example/').extended).toEqual([]);
  });
});

describe('RequestPipeline', () => {
  it('asks the interceptors in order and lets the first decision win', async () => {
    let listener: ((details: unknown, callback: (response: unknown) => void) => void) | undefined;
    const session = {
      webRequest: {
        onBeforeRequest: (fn: typeof listener) => (listener = fn),
        onBeforeSendHeaders: () => undefined,
        onHeadersReceived: () => undefined,
      },
    } as unknown as Session;
    const pipeline = new RequestPipeline();
    const first: RequestInterceptor = { beforeRequest: () => undefined };
    const second: RequestInterceptor = { beforeRequest: () => Promise.resolve({ cancel: true }) };
    const unused = vi.fn();
    const third: RequestInterceptor = { beforeRequest: unused };
    pipeline.add(first);
    pipeline.add(second);
    pipeline.add(third);
    pipeline.attach(session);
    const response = await new Promise((done) => listener?.({ url: 'https://a.example/' }, done));
    expect(response).toEqual({ cancel: true });
    expect(unused).not.toHaveBeenCalled();
    const failing = new RequestPipeline();
    failing.add({ beforeRequest: () => Promise.reject(new Error('broken')) });
    failing.attach(session);
    expect(await new Promise((done) => listener?.({ url: 'https://a.example/' }, done))).toEqual(
      {},
    );
  });

  it('removes the headers that the interceptors name from requests and responses', async () => {
    type Listener = (details: unknown, callback: (response: unknown) => void) => void;
    const listeners: { send?: Listener; received?: Listener } = {};
    const sessionOf = (): Session =>
      ({
        webRequest: {
          onBeforeRequest: () => undefined,
          onBeforeSendHeaders: (fn: Listener) => (listeners.send = fn),
          onHeadersReceived: (fn: Listener) => (listeners.received = fn),
        },
      }) as unknown as Session;
    const call = (to: Listener | undefined, details: unknown): Promise<unknown> =>
      new Promise((done) => to?.(details, done));
    const pipeline = new RequestPipeline();
    pipeline.add({
      beforeRequest: () => undefined,
      removedRequestHeaders: () => Promise.resolve(['cookie']),
      removedResponseHeaders: () => ['Set-Cookie'],
      headersReceived: () => ({ 'content-security-policy': ["script-src 'none'"] }),
    });
    pipeline.add({ beforeRequest: () => undefined, removedRequestHeaders: () => undefined });
    pipeline.attach(sessionOf());
    const url = 'https://a.example/';
    expect(
      await call(listeners.send, { url, requestHeaders: { Cookie: 'a=1', Accept: '*/*' } }),
    ).toEqual({ requestHeaders: { Accept: '*/*' } });
    expect(await call(listeners.send, { url, requestHeaders: { Accept: '*/*' } })).toEqual({
      requestHeaders: { Accept: '*/*' },
    });
    expect(
      await call(listeners.received, {
        url,
        responseHeaders: { 'set-cookie': ['a=1'], 'Content-Type': ['text/html'] },
      }),
    ).toEqual({
      responseHeaders: {
        'Content-Type': ['text/html'],
        'content-security-policy': ["script-src 'none'"],
      },
    });
    // An interceptor that fails at once lets the request go on as it was, instead of holding it.
    const failing = new RequestPipeline();
    failing.add({
      beforeRequest: () => undefined,
      removedRequestHeaders: () => {
        throw new Error('broken');
      },
      removedResponseHeaders: () => {
        throw new Error('broken');
      },
    });
    failing.attach(sessionOf());
    expect(await call(listeners.send, { url, requestHeaders: { Cookie: 'a=1' } })).toEqual({});
    expect(
      await call(listeners.received, { url, responseHeaders: { 'set-cookie': ['a=1'] } }),
    ).toEqual({});
  });
});

const response = (url: string, resourceType: string): OnHeadersReceivedListenerDetails =>
  ({ url, resourceType, responseHeaders: {} }) as unknown as OnHeadersReceivedListenerDetails;

describe('content blocker rewrites', () => {
  it('removes every tracking parameter that the lists name, and keeps the others as they were', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('$removeparam=gclid\n$removeparam=fbclid\n$removeparam=utm_source\n'),
      enabled: () => true,
      logger: logger(),
    });
    // A request of a page waits for the engine; the page itself does not.
    expect(
      await blocker.beforeRequest(request('https://cdn.example/a.js?q=%20&gclid=1', 'script')),
    ).toEqual({ redirectURL: 'https://cdn.example/a.js?q=%20' });
    const page = async (url: string): Promise<unknown> =>
      blocker.beforeRequest(request(url, 'mainFrame'));
    // The engine would merge filters that look alike into one, which names one parameter.
    for (const name of ['gclid', 'fbclid', 'utm_source']) {
      expect(await page(`https://shop.example/p?id=1&${name}=x`)).toEqual({
        redirectURL: 'https://shop.example/p?id=1',
      });
    }
    // Values that are encoded already stay exactly as the page wrote them.
    expect(
      await page('https://shop.example/s?q=caf%C3%A9%20au%20lait&gclid=1&next=%2Fa%3Fb%3D1'),
    ).toEqual({
      redirectURL: 'https://shop.example/s?q=caf%C3%A9%20au%20lait&next=%2Fa%3Fb%3D1',
    });
    expect(await page('https://shop.example/s?q=a+b&fbclid=1#top')).toEqual({
      redirectURL: 'https://shop.example/s?q=a+b#top',
    });
  });

  it('judges a request that a style sheet of a page starts by that page', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||fonts.example^\n'),
      enabled: (page) => !page.startsWith('https://www.allowed.example'),
      logger: logger(),
    });
    // A style sheet names itself as the referrer of the fonts that it loads; the origin of the
    // document that started the request is the page.
    const font = {
      ...request('https://fonts.example/a.woff2', 'font'),
      referrer: 'https://styles.example/site.css',
      initiatorOrigin: 'https://www.allowed.example',
    } as unknown as OnBeforeRequestListenerDetails;
    expect(await blocker.beforeRequest(font)).toBe(undefined);
    const elsewhere = {
      ...request('https://fonts.example/a.woff2', 'font'),
      referrer: 'https://styles.example/site.css',
      initiatorOrigin: 'https://news.example',
    } as unknown as OnBeforeRequestListenerDetails;
    expect(await blocker.beforeRequest(elsewhere)).toEqual({ cancel: true });
  });

  it('serves a stand-in for a redirect filter and removes tracking parameters', async () => {
    const onBlocked = vi.fn();
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example/tag.js$script,redirect=noop.js\n$removeparam=utm_source\n'),
      enabled: () => true,
      onBlocked,
      logger: logger(),
    });
    // These data carry no resources, so the engine names its empty stand-in of the same type.
    expect(await blocker.beforeRequest(request('https://ads.example/tag.js', 'script'))).toEqual({
      redirectURL: resourceUrl('MIME_TYPE_STUB.js'),
    });
    expect(onBlocked).toHaveBeenCalledWith(3);
    expect(
      await blocker.beforeRequest(request('https://cdn.example/a.js?utm_source=x&b=2', 'script')),
    ).toEqual({ redirectURL: 'https://cdn.example/a.js?b=2' });
    // A page's own address loses the parameter once the engine is there; the page still loads.
    expect(
      await blocker.beforeRequest(request('https://news.example/?utm_source=x', 'mainFrame')),
    ).toEqual({ redirectURL: 'https://news.example/' });
    expect(await blocker.beforeRequest(request('https://news.example/', 'mainFrame'))).toBe(
      undefined,
    );
    expect(blocker.resource('MIME_TYPE_STUB.js')?.contentType).toBe('application/javascript');
  });

  it('adds the policy of a $csp filter to a page, and nothing to other responses', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir("||news.example^$csp=script-src 'none'\n"),
      enabled: () => true,
      logger: logger(),
    });
    await blocker.load();
    expect(blocker.headersReceived(response('https://news.example/', 'mainFrame'))).toEqual({
      'Content-Security-Policy': ["script-src 'none'"],
    });
    expect(blocker.headersReceived(response('https://news.example/a.js', 'script'))).toBe(
      undefined,
    );
    expect(blocker.headersReceived(response('https://other.example/', 'mainFrame'))).toBe(
      undefined,
    );
  });

  it('adds header values next to the values of the server', () => {
    expect(
      addHeaders(
        { 'content-security-policy': ['default-src *'], 'x-a': ['1'] },
        { 'Content-Security-Policy': ["script-src 'none'"], 'X-B': ['2'] },
      ),
    ).toEqual({
      'content-security-policy': ['default-src *', "script-src 'none'"],
      'x-a': ['1'],
      'X-B': ['2'],
    });
  });
});

describe('content blocker popups and domains', () => {
  it('blocks the popups that the popup filters name, except on allowed sites', async () => {
    let allowed = false;
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n', '||popunder.example^\n'),
      enabled: (url) => !(allowed && url.startsWith('https://news.example/')),
      logger: logger(),
    });
    // Nothing is known before the engine has loaded.
    expect(blocker.blocksPopup('https://popunder.example/', 'https://news.example/')).toBe(false);
    await blocker.load();
    expect(blocker.blocksPopup('https://popunder.example/x', 'https://news.example/')).toBe(true);
    expect(blocker.blocksPopup('https://shop.example/', 'https://news.example/')).toBe(false);
    expect(blocker.blocksPopup('app://settings/', 'https://news.example/')).toBe(false);
    allowed = true;
    expect(blocker.blocksPopup('https://popunder.example/x', 'https://news.example/')).toBe(false);
  });

  it('blocks popups that their filters name only from other sites', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n', '||popunder.example^$third-party\n'),
      enabled: () => true,
      logger: logger(),
    });
    await blocker.load();
    expect(blocker.blocksPopup('https://popunder.example/x', 'https://news.example/')).toBe(true);
    expect(blocker.blocksPopup('https://popunder.example/x', 'https://popunder.example/')).toBe(
      false,
    );
  });

  it('blocks no popups when the data has no popup filters', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||popunder.example^$popup\n'),
      enabled: () => true,
      logger: logger(),
    });
    await blocker.load();
    expect(blocker.blocksPopup('https://popunder.example/', 'https://news.example/')).toBe(false);
  });

  it('finds the registrable domain of a page once the engine has loaded', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => true,
      logger: logger(),
    });
    expect(blocker.domainOf('https://www.example.co.uk/a')).toBe(undefined);
    await blocker.load();
    expect(blocker.domainOf('https://www.example.co.uk/a')).toBe('example.co.uk');
    expect(blocker.domainOf('https://news.example.com/')).toBe('example.com');
    // Sites on hosting platforms are sites of their own, not parts of the platform.
    expect(blocker.domainOf('https://alice.github.io/')).toBe('alice.github.io');
    expect(blocker.domainOf('https://shop.foo.blogspot.com/x')).toBe('foo.blogspot.com');
    expect(blocker.domainOf('http://127.0.0.1:8080/page.html')).toBe('127.0.0.1');
    expect(blocker.domainOf('app://settings/')).toBe(undefined);
  });
});

describe('content blocker optional lists', () => {
  it('adds the engines of the optional lists that are on, and only those', async () => {
    const dir = dataDir('||ads.example^\n');
    writeFileSync(
      join(dir, 'cookies.bin'),
      FiltersEngine.parse('||cmp.example^\nnews.example###cookie-notice\n').serialize(),
    );
    let extras: ('cookies' | 'annoyances')[] = [];
    const blocker = new ContentBlocker({
      dataDir: dir,
      enabled: () => true,
      extras: () => extras,
      logger: logger(),
    });
    await blocker.load();
    const consent = request('https://cmp.example/banner.js', 'script');
    expect(await blocker.beforeRequest(consent)).toBe(undefined);
    expect(blocker.frameRules('https://news.example/').styles).not.toContain('#cookie-notice');
    extras = ['cookies', 'annoyances'];
    // The engine of a group that was just turned on loads; data without it changes nothing.
    await blocker.loadExtras();
    expect(await blocker.beforeRequest(consent)).toEqual({ cancel: true });
    expect(blocker.frameRules('https://news.example/').styles).toContain('#cookie-notice');
    expect(blocker.frameRules('https://news.example/').styles).toContain('display: none');
    extras = [];
    expect(await blocker.beforeRequest(consent)).toBe(undefined);
  });
});
