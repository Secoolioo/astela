import { createHash } from 'node:crypto';

/** The part of a session that loads icons. */
export interface IconSession {
  /** Loads an address the way the session's pages load it. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** Icons larger than this are not shown, so that the tabs stay light. */
const maxIconBytes = 100_000;
/** How many icons the browser keeps; the oldest unused one goes first. */
const maxIcons = 256;
/** How long loading an icon may take. */
const iconTimeout = 10_000;

/**
 * The type of an image by its first bytes, or `undefined` if it is no image that the shell
 * shows. The type that a server sends is not trusted, as many send icons as text or bytes.
 * @param bytes - The image.
 */
export function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...values: number[]): boolean => values.every((value, i) => bytes[i] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  const head = new TextDecoder().decode(bytes.subarray(0, 512));
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head))
    return 'image/svg+xml';
  return undefined;
}

/**
 * The page icons that the tabs show. An icon is loaded once without cookies, checked by its
 * bytes and kept as a `data:` address under a short key, which the state of the shell
 * carries instead of the icon.
 */
export class FaviconStore {
  /** Icons by key, the most recently used last. */
  private readonly icons = new Map<string, string>();
  /** Keys of the addresses that were loaded, and loads that run. */
  private readonly loads = new Map<string, Promise<string | undefined>>();

  /**
   * Loads the icon of a page.
   * @param session - The session of the page, so the icon comes the way the page came.
   * @param url - The address of the icon, `http(s):` or `data:`.
   * @returns The icon's key, or `undefined` if there is no icon that the shell shows.
   */
  load(session: IconSession, url: string): Promise<string | undefined> {
    const known = this.loads.get(url);
    if (known !== undefined) return known;
    const loading = this.read(session, url)
      .then((bytes) => (bytes === undefined ? undefined : this.keep(bytes)))
      .catch(() => undefined);
    this.loads.set(url, loading);
    // Only the most recent addresses are remembered, like the icons.
    if (this.loads.size > maxIcons) {
      const oldest = this.loads.keys().next().value;
      if (oldest !== undefined) this.loads.delete(oldest);
    }
    return loading;
  }

  /**
   * An icon as a `data:` address.
   * @param key - The key that {@link load} returned.
   */
  get(key: string): string | undefined {
    const icon = this.icons.get(key);
    if (icon !== undefined) {
      this.icons.delete(key);
      this.icons.set(key, icon);
    }
    return icon;
  }

  private async read(session: IconSession, url: string): Promise<Uint8Array | undefined> {
    if (/^data:image\/[\w.+-]+;base64,/i.test(url)) {
      const data = url.slice(url.indexOf(',') + 1);
      return data.length > (maxIconBytes * 4) / 3 + 4 ? undefined : Buffer.from(data, 'base64');
    }
    if (!/^https?:/i.test(url)) return undefined;
    const response = await session.fetch(url, {
      credentials: 'omit',
      signal: AbortSignal.timeout(iconTimeout),
    });
    const size = Number(response.headers.get('content-length') ?? '0');
    if (!response.ok || size > maxIconBytes) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > maxIconBytes ? undefined : bytes;
  }

  private keep(bytes: Uint8Array): string | undefined {
    const type = imageType(bytes);
    if (type === undefined || bytes.length === 0) return undefined;
    const key = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    this.icons.delete(key);
    this.icons.set(key, `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
    if (this.icons.size > maxIcons) {
      const oldest = this.icons.keys().next().value;
      if (oldest !== undefined) this.icons.delete(oldest);
    }
    return key;
  }
}

/** The icons of all windows. */
export const favicons = new FaviconStore();
