import { describe, expect, it } from 'vitest';
import { FaviconStore, imageType, type IconSession } from '../electron/favicons.ts';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ico = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);

/** A session whose icons are the given responses, which records what it loads and how. */
function session(responses: Record<string, Response>): IconSession & {
  readonly loads: { url: string; init: RequestInit | undefined }[];
} {
  const loads: { url: string; init: RequestInit | undefined }[] = [];
  return {
    loads,
    fetch: (url, init) => {
      loads.push({ url, init });
      return Promise.resolve(responses[url] ?? new Response(null, { status: 404 }));
    },
  };
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
    const key = await store.load(web, 'https://site.example/favicon.ico');
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(await store.load(web, 'https://site.example/favicon.ico')).toBe(key);
    expect(web.loads).toHaveLength(1);
    expect(web.loads[0]?.init?.credentials).toBe('omit');
    expect(store.get(key ?? '')).toBe(
      `data:image/x-icon;base64,${Buffer.from(ico).toString('base64')}`,
    );
  });

  it('takes icons that pages give as data addresses', async () => {
    const store = new FaviconStore();
    const address = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    const key = await store.load(session({}), address);
    expect(store.get(key ?? '')).toBe(address);
  });

  it('refuses what is no image, too large, missing or of another scheme', async () => {
    const store = new FaviconStore();
    const web = session({
      'https://site.example/page.html': new Response('<html></html>'),
      'https://site.example/large.png': new Response(
        Uint8Array.from({ length: 200_000 }, (_, i) => png[i] ?? 0),
      ),
    });
    expect(await store.load(web, 'https://site.example/page.html')).toBeUndefined();
    expect(await store.load(web, 'https://site.example/large.png')).toBeUndefined();
    expect(await store.load(web, 'https://site.example/missing.png')).toBeUndefined();
    expect(await store.load(web, 'file:///etc/passwd')).toBeUndefined();
  });
});
