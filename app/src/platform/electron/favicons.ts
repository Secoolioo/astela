import { createHash } from 'node:crypto';

/** The part of a session that loads icons. */
export interface IconSession {
  /** Loads an address the way the session's pages load it. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/** Icons larger than this are not shown, so that the tabs stay light. */
const maxIconBytes = 100_000;
/** How many icons and addresses a session keeps; the oldest unused one goes first. */
const maxIcons = 256;
/** How long loading an icon may take. */
const iconTimeout = 10_000;
/** How long an address whose icon could not be loaded is not asked for again. */
const retryAfter = 60_000;

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

/** A load of an icon that runs, with the number of tabs that wait for it. */
interface Loading {
  readonly result: Promise<string | undefined>;
  /** Stops the load. */
  readonly stop: AbortController;
  waiting: number;
}

/**
 * What a session knows about the icon at an address: its key once it loaded, when it could
 * not be loaded, or the load that runs.
 */
type IconLoad = { readonly key: string } | { readonly failedAt: number } | Loading;

/**
 * The page icons that the tabs show. Each session has icons of its own, so that the pages
 * of private windows and of regular ones see nothing of each other, and the icons of a
 * session go when it ends. An icon is loaded like an image of its page, but without
 * cookies, checked by its bytes and kept as a `data:` address under a short key, which the
 * state of the shell carries instead of the icon.
 */
export class FaviconStore {
  private readonly sessions = new WeakMap<IconSession, SessionIcons>();
  /** Sessions that ended, whose pages get no icons any more. */
  private readonly ended = new WeakSet<IconSession>();
  private readonly now: () => number;

  /** @param now - The current time in milliseconds, which tests can set. */
  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /**
   * Loads the icon of a page.
   * @param session - The session of the page.
   * @param url - The address of the icon, `http(s):` or `data:`.
   * @param page - The address of the page, which the icon is loaded for.
   * @param signal - Gives up the load for the page, such as when the page shows another icon.
   * @returns The icon's key, or `undefined` if there is no icon that the shell shows.
   */
  load(
    session: IconSession,
    url: string,
    page: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (this.ended.has(session)) return Promise.resolve(undefined);
    let icons = this.sessions.get(session);
    if (icons === undefined) {
      icons = new SessionIcons(session, this.now);
      this.sessions.set(session, icons);
    }
    return icons.load(url, page, signal);
  }

  /**
   * An icon as a `data:` address.
   * @param session - The session whose pages showed the icon.
   * @param key - The key that {@link load} returned.
   */
  get(session: IconSession, key: string): string | undefined {
    return this.sessions.get(session)?.get(key);
  }

  /**
   * Stops the loads of a session that ended and forgets its icons, such as those of the
   * private windows after the last of them closed.
   * @param session - The session.
   */
  forget(session: IconSession): void {
    this.ended.add(session);
    this.sessions.get(session)?.clear();
    this.sessions.delete(session);
  }
}

/** The icons of the pages of one session, and what became of the addresses they named. */
class SessionIcons {
  /** Icons by key, the most recently used last. */
  private readonly icons = new Map<string, string>();
  /**
   * What became of the addresses, the most recently used last, by a hash of the page's
   * origin and the address: one site cannot tell from a request that does not come that
   * another site loaded the same icon before, and a long address takes no room.
   */
  private readonly loads = new Map<string, IconLoad>();
  private readonly session: IconSession;
  private readonly now: () => number;

  constructor(session: IconSession, now: () => number) {
    this.session = session;
    this.now = now;
  }

  load(url: string, page: string, signal: AbortSignal | undefined): Promise<string | undefined> {
    if (signal?.aborted === true) return Promise.resolve(undefined);
    // An icon in the address needs no request, so nothing of its address is kept.
    if (/^data:/i.test(url)) return Promise.resolve(this.fromData(url));
    const address = iconAddress(url, page);
    if (address === undefined) return Promise.resolve(undefined);
    const id = createHash('sha256')
      .update(`${URL.parse(page)?.origin ?? ''} ${address.href}`)
      .digest('hex');
    const known = this.loads.get(id);
    if (known !== undefined && 'key' in known && this.icons.has(known.key)) {
      this.remember(id, known);
      return Promise.resolve(known.key);
    }
    // An icon that could not be loaded is asked for again after a while, not at every page.
    if (known !== undefined && 'failedAt' in known && this.now() - known.failedAt < retryAfter) {
      return Promise.resolve(undefined);
    }
    const loading = known !== undefined && 'stop' in known ? known : this.start(id, address, page);
    return this.wait(id, loading, signal);
  }

  get(key: string): string | undefined {
    const icon = this.icons.get(key);
    if (icon !== undefined) {
      this.icons.delete(key);
      this.icons.set(key, icon);
    }
    return icon;
  }

  /** Stops the loads that run and forgets every icon. */
  clear(): void {
    for (const known of this.loads.values()) if ('stop' in known) known.stop.abort();
    this.loads.clear();
    this.icons.clear();
  }

  private start(id: string, address: URL, page: string): Loading {
    const stop = new AbortController();
    const result = this.read(address, page, stop.signal).then(
      (bytes) => this.settle(id, stop, bytes),
      () => this.settle(id, stop, undefined),
    );
    const loading: Loading = { result, stop, waiting: 0 };
    this.remember(id, loading);
    return loading;
  }

  /**
   * The result of a load for one more tab, which gives it up when its signal aborts. A load
   * that no tab waits for any more stops and leaves nothing behind, so a later one starts
   * anew.
   */
  private wait(
    id: string,
    loading: Loading,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    loading.waiting += 1;
    if (signal === undefined) return loading.result;
    return new Promise((resolve) => {
      const giveUp = (): void => {
        resolve(undefined);
        loading.waiting -= 1;
        if (loading.waiting > 0) return;
        if (this.loads.get(id) === loading) this.loads.delete(id);
        loading.stop.abort();
      };
      signal.addEventListener('abort', giveUp, { once: true });
      void loading.result.then((key) => {
        signal.removeEventListener('abort', giveUp);
        resolve(key);
      });
    });
  }

  /**
   * Keeps the icon of a load that ended, or remembers when it failed. A load that every tab
   * gave up, or that the end of the session stopped, changes nothing.
   */
  private settle(
    id: string,
    stop: AbortController,
    bytes: Uint8Array | undefined,
  ): string | undefined {
    const known = this.loads.get(id);
    if (known === undefined || !('stop' in known) || known.stop !== stop) return undefined;
    const key = bytes === undefined ? undefined : this.keep(bytes);
    this.loads.set(id, key === undefined ? { failedAt: this.now() } : { key });
    return key;
  }

  /**
   * Loads an icon like an image of its page: with the referrer that pages send by default
   * and as a request for an image, so that the request pipeline and the content blocker see
   * the page and the kind of the request. The request goes without cookies, and reading
   * stops as soon as the icon is larger than the limit.
   */
  private async read(
    address: URL,
    page: string,
    signal: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    const done = new AbortController();
    const referrer = referrerOf(page, address);
    try {
      const response = await this.session.fetch(address.href, {
        credentials: 'omit',
        referrerPolicy: 'strict-origin-when-cross-origin',
        headers: {
          'Sec-Fetch-Dest': 'image',
          ...(referrer === undefined ? {} : { Referer: referrer }),
        },
        signal: AbortSignal.any([signal, done.signal, AbortSignal.timeout(iconTimeout)]),
      });
      const size = Number(response.headers.get('content-length') ?? '0');
      if (!response.ok || size > maxIconBytes || response.body === null) return undefined;
      return await readAtMost(response.body, maxIconBytes);
    } finally {
      // Ends the request, also when the rest of its body is not read.
      done.abort();
    }
  }

  /** The key of an icon that a page gives in its address, if it is small enough. */
  private fromData(url: string): string | undefined {
    if (!/^data:image\/[\w.+-]+;base64,/i.test(url)) return undefined;
    const data = url.slice(url.indexOf(',') + 1);
    return data.length > (maxIconBytes * 4) / 3 + 4
      ? undefined
      : this.keep(Buffer.from(data, 'base64'));
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

  /**
   * Remembers what became of an address as the most recent one. Only the most recent
   * addresses are remembered, like the icons; loads that run stay until they end.
   */
  private remember(id: string, load: IconLoad): void {
    this.loads.delete(id);
    this.loads.set(id, load);
    if (this.loads.size <= maxIcons) return;
    for (const [oldest, known] of this.loads) {
      if (!('stop' in known)) {
        this.loads.delete(oldest);
        return;
      }
    }
  }
}

/**
 * The address of an icon that a page may load, or `undefined` for one it may not: only
 * `http(s):` addresses, and no `http:` address for an `https:` page, which would be mixed
 * content that anyone on the network could read and replace.
 */
function iconAddress(url: string, page: string): URL | undefined {
  const address = URL.parse(url);
  if (address === null || (address.protocol !== 'https:' && address.protocol !== 'http:')) {
    return undefined;
  }
  return address.protocol === 'http:' && URL.parse(page)?.protocol === 'https:'
    ? undefined
    : address;
}

/**
 * The referrer that a page sends by default (`strict-origin-when-cross-origin`) with a
 * request for one of its images: its address to its own origin, its origin to others, and
 * none from a page that is no web page.
 */
function referrerOf(page: string, address: URL): string | undefined {
  const source = URL.parse(page);
  if (source === null || (source.protocol !== 'https:' && source.protocol !== 'http:')) {
    return undefined;
  }
  if (source.origin !== address.origin) return `${source.origin}/`;
  source.hash = '';
  source.username = '';
  source.password = '';
  return source.href;
}

/**
 * The bytes of a body, read until its end or until more than a limit arrived.
 * @returns The bytes, or `undefined` for a body that is larger than the limit.
 */
async function readAtMost(
  body: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | undefined> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      length += chunk.value.byteLength;
      if (length > limit) return undefined;
      chunks.push(chunk.value);
    }
  } finally {
    // Lets go of the rest of the body without waiting for its source.
    void reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, length);
}

/** The icons of all windows. */
export const favicons = new FaviconStore();
