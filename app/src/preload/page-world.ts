/**
 * Scripts that the frame preload runs in the page's own world, before the page's scripts, with
 * `contextBridge.executeInMainWorld`. Electron sends each function as its source text, so each
 * one keeps everything that it needs inside itself; what it reports goes to a function of the
 * preload's world, which the page cannot reach. The functions that they wrap keep their name,
 * their length and the native code of their text, as a `Proxy` passes them on.
 */

/** What the wrapper of security key requests reports: a request starts or ends. */
export type SecurityKeyReport = 'start' | 'end';

/**
 * Wraps `navigator.credentials.create()` and `get()` for requests of a security key or a
 * passkey, which the browser shows a question for, with a Cancel: Electron has no dialog of its
 * own on Linux and macOS, and Chromium would let such a request wait at least three minutes. A
 * wrapped request ends with `NotAllowedError`, as in Chrome, once the site's own timeout has
 * passed or when the browser cancels it; the site's own signal still aborts it with its own
 * reason. Requests without `publicKey`, and those that wait for the autofill of a field or ask
 * only for what is at hand (`mediation` `conditional` or `immediate`), stay as they are. So does
 * a request while a wrapped one of the document waits: Chromium lets a document wait for one
 * request at a time and refuses the others at once, which then report nothing.
 * @param report - Called with `start` and `end` and the number of each wrapped request.
 * @returns Cancels the wrapped request of a number.
 */
export function guardCredentials(
  report: (event: SecurityKeyReport, id: number) => void,
): (id: number) => void {
  const container = globalThis.CredentialsContainer?.prototype;
  if (container === undefined) return () => {};
  const pending = new Map<number, AbortController>();
  let next = 0;
  // Electron sends this function as its text, so its helpers stay inside it.
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- sent as text, see above
  const notAllowed = (): DOMException =>
    new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError');
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- sent as text, see above
  const wraps = (
    options: unknown,
  ): options is { publicKey: { timeout?: unknown }; signal?: unknown } => {
    if (typeof options !== 'object' || options === null) return false;
    const publicKey: unknown = Reflect.get(options, 'publicKey');
    const mediation: unknown = Reflect.get(options, 'mediation');
    return (
      typeof publicKey === 'object' &&
      publicKey !== null &&
      mediation !== 'conditional' &&
      mediation !== 'immediate'
    );
  };
  for (const method of ['create', 'get'] as const) {
    const original = container[method];
    const wrapped = new Proxy(original, {
      apply(target, self: unknown, args: unknown[]): unknown {
        const options = args[0];
        // What the browser cannot wrap goes on as it is, such as a signal that is none, and so
        // does what Chromium refuses at once, as a page may ask again and again.
        if (
          !wraps(options) ||
          pending.size > 0 ||
          (options.signal !== undefined && !(options.signal instanceof AbortSignal))
        ) {
          return Reflect.apply(target, self, args);
        }
        const site = options.signal;
        const own = new AbortController();
        const signal = site === undefined ? own.signal : AbortSignal.any([site, own.signal]);
        const id = next++;
        const wanted = Number(options.publicKey.timeout);
        const timer =
          wanted > 0 ? setTimeout(() => own.abort(notAllowed()), Math.min(wanted, 2 ** 31 - 1)) : 0;
        pending.set(id, own);
        report('start', id);
        const done = (): void => {
          clearTimeout(timer);
          pending.delete(id);
          report('end', id);
        };
        let result: unknown;
        try {
          result = Reflect.apply(target, self, [{ ...options, signal }, ...args.slice(1)]);
        } catch (error) {
          done();
          throw error;
        }
        if (!(result instanceof Promise)) {
          done();
          return result;
        }
        return result.then(
          (value: unknown) => {
            done();
            return value;
          },
          (error: unknown) => {
            done();
            throw error;
          },
        );
      },
    });
    Object.defineProperty(container, method, { value: wrapped });
  }
  return (id) => pending.get(id)?.abort(notAllowed());
}

/**
 * Tells the browser, once per document, that the page asked for protected playback that the
 * browser cannot give: a request for a key system of digital rights management that fails, such
 * as Widevine, which stock Electron has no module for. Clear Key, which needs none, does not
 * count. The page gets the promise of the request as it is.
 * @param report - Called once with the key system of the first such request that fails.
 */
export function watchKeySystems(report: (keySystem: string) => void): void {
  const prototype = globalThis.Navigator?.prototype;
  const original: unknown =
    prototype === undefined ? undefined : Reflect.get(prototype, 'requestMediaKeySystemAccess');
  if (prototype === undefined || typeof original !== 'function') return;
  let reported = false;
  const wrapped = new Proxy(original, {
    apply(target, self: unknown, args: unknown[]): unknown {
      const result: unknown = Reflect.apply(target, self, args);
      const keySystem = typeof args[0] === 'string' ? args[0] : '';
      if (!reported && keySystem !== 'org.w3.clearkey' && result instanceof Promise) {
        result.then(undefined, () => {
          if (reported) return;
          reported = true;
          report(keySystem.slice(0, 100));
        });
      }
      return result;
    },
  });
  Object.defineProperty(prototype, 'requestMediaKeySystemAccess', { value: wrapped });
}
