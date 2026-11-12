import { describe, expect, it } from 'vitest';
import { FaviconStore, imageType, type IconSession } from '../electron/favicons.ts';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ico = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
/** The page that the icons belong to, unless a test names another. */
const page = 'https://site.example/news/today.html#top';

/** A response, or what makes one for each request. */
type Answer = Response | ((init: RequestInit | undefined) => Response | Promise<Response>);

/** A session whose icons are the given answers, which records what it loads and how. */
function session(answers: Readonly<Record<string, Answer>> = {}): IconSession & {
  readonly loads: { url: string; init: RequestInit | undefined }[];
} {
  const loads: { url: string; init: RequestInit | undefined }[] = [];
  return {
    loads,
    fetch: (url, init) => {
      loads.push({ url, init });
      const answer = answers[url];
      if (answer === undefined) return Promise.resolve(new Response(null, { status: 404 }));
      return Promise.resolve(typeof answer === 'function' ? answer(init) : answer.clone());
    },
  };
}

/** The address of an icon that the sessions of the tests do not have. */
function missing(i: number): string {
  return `https://site.example/missing-${String(i)}.png`;
}

/** A response that does not come, and fails once its request is stopped. */
function pending(init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('The request was stopped.', 'AbortError')),
    );
  });
}

/** A body that gives a part each time it is read, without an end, and notes what it did. */
function endless(first: Uint8Array): {
  readonly body: ReadableStream<Uint8Array>;
  readonly pulls: () => number;
  readonly cancelled: () => boolean;
} {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull: (controller) => {
        pulls += 1;
        const part = new Uint8Array(16_384);
        if (pulls === 1) part.set(first);
        controller.enqueue(part);
      },
      cancel: () => {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, pulls: () => pulls, cancelled: () => cancelled };
}

describe('imageType', () => {
  it('tells images by their bytes, not by what a server says', () => {
    expect(imageType(png)).toBe('image/png');
    expect(imageType(ico)).toBe('image/x-icon');
    expect(imageType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x">'))).toBe(
      'image/svg+xml',
    );
    expect(imageType(new TextEncoder().encode('<html><script>'))).toBeUndefined();
  });
});

describe('FaviconStore', () => {
  it('keeps an icon under a key, loaded once and without cookies', async () => {
    const store = new FaviconStore();
    const web = session({
      'https://site.example/favicon.ico': new Response(ico, {
        headers: { 'content-type': 'text/plain' },
      }),
    });
    const key = await store.load(web, 'https://site.example/favicon.ico', page);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(await store.load(web, 'https://site.example/favicon.ico', page)).toBe(key);
    expect(web.loads).toHaveLength(1);
    expect(web.loads[0]?.init?.credentials).toBe('omit');
    expect(store.get(web, key ?? '')).toBe(
      `data:image/x-icon;base64,${Buffer.from(ico).toString('base64')}`,
    );
  });

  it('takes icons that pages give as data addresses', async () => {
    const store = new FaviconStore();
    const web = session();
    const address = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    const key = await store.load(web, address, page);
    expect(store.get(web, key ?? '')).toBe(address);
    expect(await store.load(web, address, page)).toBe(key);
    expect(web.loads).toHaveLength(0);
  });

  it('refuses what is no image, too large, missing or of another scheme', async () => {
    const store = new FaviconStore();
    const web = session({
      'https://site.example/page.html': new Response('<html></html>'),
      'https://site.example/large.png': new Response(
        Uint8Array.from({ length: 200_000 }, (_, i) => png[i] ?? 0),
      ),
    });
    expect(await store.load(web, 'https://site.example/page.html', page)).toBeUndefined();
    expect(await store.load(web, 'https://site.example/large.png', page)).toBeUndefined();
    expect(await store.load(web, 'https://site.example/missing.png', page)).toBeUndefined();
    expect(await store.load(web, 'file:///etc/passwd', page)).toBeUndefined();
    expect(await store.load(web, 'data:text/html;base64,PGh0bWw+', page)).toBeUndefined();
    expect(web.loads).toHaveLength(3);
  });

  it('loads an icon like an image of its page, and no insecure icon of a secure page', async () => {
    const store = new FaviconStore();
    const web = session({
      'https://site.example/icon.png': new Response(png),
      'https://cdn.example/icon.png': new Response(png),
      'http://plain.example/icon.png': new Response(png),
      'https://cdn.example/other.png': new Response(png),
    });
    await store.load(
      web,
      'https://site.example/icon.png',
      'https://user:secret@site.example/news/today.html?day=1#top',
    );
    await store.load(web, 'https://cdn.example/icon.png', page);
    await store.load(web, 'http://plain.example/icon.png', 'http://plain.example/');
    await store.load(web, 'https://cdn.example/other.png', 'about:blank');
    // An insecure icon of a secure page would be mixed content.
    expect(await store.load(web, 'http://cdn.example/mixed.png', page)).toBeUndefined();
    expect(
      web.loads.map(({ url, init }) => {
        const headers = new Headers(init?.headers);
        return [
          url,
          headers.get('referer'),
          headers.get('sec-fetch-dest'),
          init?.referrerPolicy,
          init?.credentials,
        ];
      }),
    ).toEqual([
      [
        'https://site.example/icon.png',
        'https://site.example/news/today.html?day=1',
        'image',
        'strict-origin-when-cross-origin',
        'omit',
      ],
      [
        'https://cdn.example/icon.png',
        'https://site.example/',
        'image',
        'strict-origin-when-cross-origin',
        'omit',
      ],
      [
        'http://plain.example/icon.png',
        'http://plain.example/',
        'image',
        'strict-origin-when-cross-origin',
        'omit',
      ],
      ['https://cdn.example/other.png', null, 'image', 'strict-origin-when-cross-origin', 'omit'],
    ]);
  });

  it('keeps the icons of each session apart and forgets those of a session that ended', async () => {
    const answers = {
      'https://site.example/favicon.ico': new Response(ico),
      'https://site.example/slow.png': pending,
    };
    const regular = session(answers);
    const privateWeb = session(answers);
    const store = new FaviconStore();
    const url = 'https://site.example/favicon.ico';
    const key = await store.load(regular, url, page);
    // The other session asks the site itself, so the site cannot tell from a request that
    // does not come that the icon was shown in the other session.
    expect(await store.load(privateWeb, url, page)).toBe(key);
    expect([regular.loads.length, privateWeb.loads.length]).toEqual([1, 1]);
    const running = store.load(privateWeb, 'https://site.example/slow.png', page);
    store.forget(privateWeb);
    expect(await running).toBeUndefined();
    expect(privateWeb.loads[1]?.init?.signal?.aborted).toBe(true);
    expect(store.get(privateWeb, key ?? '')).toBeUndefined();
    expect(await store.load(privateWeb, url, page)).toBeUndefined();
    expect(privateWeb.loads).toHaveLength(2);
    expect(store.get(regular, key ?? '')).toBe(
      `data:image/x-icon;base64,${Buffer.from(ico).toString('base64')}`,
    );
  });

  it('loads an icon again for another site, but not for another page of the same site', async () => {
    const store = new FaviconStore();
    const web = session({ 'https://icons.example/shared.ico': new Response(ico) });
    const url = 'https://icons.example/shared.ico';
    const key = await store.load(web, url, 'https://news.example/today');
    expect(await store.load(web, url, 'https://news.example/yesterday')).toBe(key);
    expect(web.loads).toHaveLength(1);
    expect(await store.load(web, url, 'https://shop.example/')).toBe(key);
    expect(web.loads).toHaveLength(2);
  });

  it('stops reading an icon that grows past the limit, and stops its request', async () => {
    const store = new FaviconStore();
    const stream = endless(png);
    const web = session({ 'https://site.example/endless.png': () => new Response(stream.body) });
    expect(await store.load(web, 'https://site.example/endless.png', page)).toBeUndefined();
    // 100 KB are seven parts of 16 KB: the eighth is never asked for.
    expect(stream.pulls()).toBe(7);
    expect(stream.cancelled()).toBe(true);
    expect(web.loads[0]?.init?.signal?.aborted).toBe(true);
  });

  it('refuses an icon whose declared size is too large without reading it', async () => {
    const store = new FaviconStore();
    const stream = endless(png);
    const web = session({
      'https://site.example/large.png': () =>
        new Response(stream.body, { headers: { 'content-length': '200000' } }),
    });
    expect(await store.load(web, 'https://site.example/large.png', page)).toBeUndefined();
    expect(stream.pulls()).toBe(0);
    expect(web.loads[0]?.init?.signal?.aborted).toBe(true);
  });

  it('tries an icon again a while after it could not be loaded', async () => {
    let now = 0;
    let available = false;
    const store = new FaviconStore(() => now);
    const url = 'https://site.example/favicon.ico';
    const web = session({
      [url]: () => (available ? new Response(ico) : new Response(null, { status: 503 })),
    });
    expect(await store.load(web, url, page)).toBeUndefined();
    available = true;
    // Other pages of the site shortly after do not ask again.
    now = 59_999;
    expect(await store.load(web, url, page)).toBeUndefined();
    expect(web.loads).toHaveLength(1);
    now = 60_000;
    const key = await store.load(web, url, page);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(await store.load(web, url, page)).toBe(key);
    expect(web.loads).toHaveLength(2);
  });

  it('shares the load of an icon among its tabs and stops it when none waits any more', async () => {
    const store = new FaviconStore();
    const url = 'https://site.example/slow.png';
    const web = session({ [url]: pending });
    const first = new AbortController();
    const second = new AbortController();
    const one = store.load(web, url, page, first.signal);
    const other = store.load(web, url, page, second.signal);
    expect(web.loads).toHaveLength(1);
    const request = web.loads[0]?.init?.signal;
    first.abort();
    expect(await one).toBeUndefined();
    expect(request?.aborted).toBe(false);
    second.abort();
    expect(await other).toBeUndefined();
    expect(request?.aborted).toBe(true);
    // A tab that asks later loads the icon anew; a tab that gave up before asks nothing.
    const later = new AbortController();
    void store.load(web, url, page, later.signal);
    expect(web.loads).toHaveLength(2);
    expect(await store.load(web, url, page, AbortSignal.abort())).toBeUndefined();
    expect(web.loads).toHaveLength(2);
    later.abort();
  });

  it('keeps nothing of icons that it refused, so they push out no other address', async () => {
    const store = new FaviconStore();
    const url = 'https://site.example/favicon.ico';
    const web = session({ [url]: new Response(ico) });
    await store.load(web, url, page);
    const large = 'A'.repeat(140_000);
    for (let i = 0; i < 300; i += 1) {
      expect(
        await store.load(web, `data:image/png;base64,${String(i)}${large}`, page),
      ).toBeUndefined();
    }
    await store.load(web, url, page);
    expect(web.loads).toHaveLength(1);
  });

  it('remembers the most recent addresses only, and keeps loads that run', async () => {
    const store = new FaviconStore(() => 0);
    const slow = 'https://site.example/slow.png';
    const web = session({ [slow]: pending });
    const waiting = new AbortController();
    void store.load(web, slow, page, waiting.signal);
    for (let i = 0; i <= 256; i += 1) await store.load(web, missing(i), page);
    expect(web.loads).toHaveLength(258);
    // The load that runs is still shared, the oldest failure is forgotten, a newer one is not.
    void store.load(web, slow, page, waiting.signal);
    await store.load(web, missing(0), page);
    await store.load(web, missing(256), page);
    expect(web.loads.slice(258).map(({ url }) => url)).toEqual([missing(0)]);
    waiting.abort();
  });

  it('loads an icon again once the session no longer has it', async () => {
    const store = new FaviconStore();
    const url = 'https://site.example/favicon.ico';
    const web = session({ [url]: new Response(ico) });
    const key = await store.load(web, url, page);
    // Newer icons of pages push the oldest one out.
    for (let i = 0; i < 256; i += 1) {
      const icon = Buffer.from([...png, i]).toString('base64');
      await store.load(web, `data:image/png;base64,${icon}`, page);
    }
    expect(store.get(web, key ?? '')).toBeUndefined();
    expect(await store.load(web, url, page)).toBe(key);
    expect(web.loads).toHaveLength(2);
  });
});
