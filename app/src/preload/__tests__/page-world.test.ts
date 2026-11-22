import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guardCredentials, watchKeySystems } from '../page-world.ts';

/** What the fake container of credentials was asked for. */
const calls: { method: string; options: unknown }[] = [];

/**
 * A container of credentials as Chromium's without an authenticator: a request waits until
 * its signal aborts it, with the signal's reason.
 */
class FakeCredentials {
  create(options?: { signal?: AbortSignal }): Promise<unknown> {
    return FakeCredentials.wait('create', options);
  }
  get(options?: { signal?: AbortSignal }): Promise<unknown> {
    return FakeCredentials.wait('get', options);
  }
  private static wait(method: string, options?: { signal?: AbortSignal }): Promise<unknown> {
    calls.push({ method, options });
    const signal: unknown = options?.signal;
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      return Promise.reject(new TypeError('The signal is none.'));
    }
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason));
    });
  }
}

/** The functions of the fake container, which each test puts back. */
const descriptors = Object.getOwnPropertyDescriptors(FakeCredentials.prototype);

/** A function of a prototype as it is now, such as the wrapper in place of the original. */
function member(prototype: object, name: string): (...args: unknown[]) => unknown {
  const value: unknown = Reflect.get(prototype, name);
  if (typeof value !== 'function') throw new Error(`${name} is no function`);
  return value as (...args: unknown[]) => unknown;
}

/** The name of the error that a request ended with. */
function outcome(request: Promise<unknown>): Promise<string> {
  return request.then(
    () => 'resolved',
    (error: unknown) => (error instanceof DOMException ? error.name : String(error)),
  );
}

describe('guardCredentials', () => {
  let reports: string[];
  let cancel: (id: number) => void;
  const credentials = new FakeCredentials();

  beforeEach(() => {
    vi.useFakeTimers();
    calls.length = 0;
    reports = [];
    vi.stubGlobal('CredentialsContainer', FakeCredentials);
    cancel = guardCredentials((event, id) => reports.push(`${event} ${String(id)}`));
  });

  afterEach(() => {
    Object.defineProperties(FakeCredentials.prototype, descriptors);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the name, the length and the native text of the functions', () => {
    const create = member(FakeCredentials.prototype, 'create');
    const original: unknown = descriptors.create?.value;
    expect(create).not.toBe(original);
    expect(create.name).toBe('create');
    expect(create.length).toBe(1);
    expect(Function.prototype.toString.call(create)).toMatch(/\[native code\]/);
  });

  it('ends a request of a security key with the site timeout, as NotAllowedError', async () => {
    const request = outcome(credentials.create({ publicKey: { timeout: 3000 } } as never));
    expect(reports).toEqual(['start 0']);
    await vi.advanceTimersByTimeAsync(2999);
    expect(reports).toEqual(['start 0']);
    await vi.advanceTimersByTimeAsync(1);
    expect(await request).toBe('NotAllowedError');
    expect(reports).toEqual(['start 0', 'end 0']);
  });

  it('lets the browser cancel a request, and the site abort it with its own reason', async () => {
    const cancelled = outcome(credentials.get({ publicKey: {} } as never));
    cancel(0);
    expect(await cancelled).toBe('NotAllowedError');
    const site = new AbortController();
    const aborted = outcome(credentials.get({ publicKey: {}, signal: site.signal } as never));
    site.abort();
    expect(await aborted).toBe('AbortError');
    expect(reports).toEqual(['start 0', 'end 0', 'start 1', 'end 1']);
    // A request without a timeout of its own waits for an answer.
    const waiting = credentials.get({ publicKey: {} } as never);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(reports.at(-1)).toBe('start 2');
    cancel(2);
    expect(await outcome(waiting)).toBe('NotAllowedError');
  });

  it('leaves the requests that come while one waits to Chromium, which refuses them', async () => {
    const waiting = outcome(credentials.get({ publicKey: {} } as never));
    // A page that asks again and again reports one request, however often it asks.
    const again = Array.from({ length: 1000 }, () => ({ publicKey: {} }));
    for (const options of again) void credentials.get(options as never).catch(() => undefined);
    expect(reports).toEqual(['start 0']);
    expect(calls.slice(1).map((call) => call.options)).toEqual(again);
    expect(calls.slice(1).every((call, index) => call.options === again[index])).toBe(true);
    cancel(0);
    expect(await waiting).toBe('NotAllowedError');
    // Once it has ended, the next request is wrapped again.
    void credentials.create({ publicKey: {} } as never).catch(() => undefined);
    expect(reports).toEqual(['start 0', 'end 0', 'start 1']);
  });

  it('leaves requests that wait for a field, ask for what is at hand or need no key', () => {
    const requests = [
      { mediation: 'conditional', publicKey: {} },
      { mediation: 'immediate', publicKey: {} },
      { password: true },
      { publicKey: {}, signal: 'not a signal' },
    ];
    for (const options of requests) void credentials.get(options as never).catch(() => undefined);
    void credentials.get();
    expect(calls.map((call) => call.options)).toEqual([...requests, undefined]);
    expect(reports).toEqual([]);
  });
});

describe('watchKeySystems', () => {
  /** A navigator whose browser supports Clear Key and no key system of DRM. */
  class FakeNavigator {
    requestMediaKeySystemAccess(keySystem: string, _configs: unknown[]): Promise<string> {
      return keySystem === 'org.w3.clearkey'
        ? Promise.resolve('access')
        : Promise.reject(new DOMException('Unsupported keySystem', 'NotSupportedError'));
    }
  }
  const navigatorDescriptors = Object.getOwnPropertyDescriptors(FakeNavigator.prototype);

  afterEach(() => {
    Object.defineProperties(FakeNavigator.prototype, navigatorDescriptors);
    vi.unstubAllGlobals();
  });

  it('keeps the name, the length, the native text and the promise of the function', async () => {
    vi.stubGlobal('Navigator', FakeNavigator);
    watchKeySystems(() => undefined);
    const wrapped = member(FakeNavigator.prototype, 'requestMediaKeySystemAccess');
    const native: unknown = navigatorDescriptors.requestMediaKeySystemAccess?.value;
    expect(wrapped).not.toBe(native);
    expect(wrapped.name).toBe('requestMediaKeySystemAccess');
    expect(wrapped.length).toBe(2);
    expect(Function.prototype.toString.call(wrapped)).toMatch(/\[native code\]/);
    const navigator = new FakeNavigator();
    expect(await navigator.requestMediaKeySystemAccess('org.w3.clearkey', [])).toBe('access');
    await expect(navigator.requestMediaKeySystemAccess('com.widevine.alpha', [])).rejects.toThrow(
      'Unsupported keySystem',
    );
  });

  it('reports the first key system that fails, once, and never Clear Key', async () => {
    vi.stubGlobal('Navigator', FakeNavigator);
    const reports: string[] = [];
    watchKeySystems((keySystem) => reports.push(keySystem));
    const navigator = new FakeNavigator();
    await navigator.requestMediaKeySystemAccess('org.w3.clearkey', []);
    expect(reports).toEqual([]);
    for (const keySystem of ['com.widevine.alpha', 'com.microsoft.playready']) {
      await navigator.requestMediaKeySystemAccess(keySystem, []).catch(() => undefined);
    }
    expect(reports).toEqual(['com.widevine.alpha']);
  });
});
