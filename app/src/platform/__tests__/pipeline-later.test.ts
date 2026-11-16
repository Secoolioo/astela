import type { Session } from 'electron';
import { describe, expect, it } from 'vitest';
import { attachLater } from '../electron/pipeline-later.ts';
import { RequestPipeline } from '../electron/request-pipeline.ts';

type Listener = (details: unknown, callback: (response: unknown) => void) => void;

/** A web session whose request listeners the test calls. */
function webSession(): {
  readonly session: Session;
  readonly listeners: { request?: Listener; send?: Listener; received?: Listener };
} {
  const listeners: { request?: Listener; send?: Listener; received?: Listener } = {};
  const session = {
    webRequest: {
      onBeforeRequest: (listener: Listener) => (listeners.request = listener),
      onBeforeSendHeaders: (listener: Listener) => (listeners.send = listener),
      onHeadersReceived: (listener: Listener) => (listeners.received = listener),
    },
  } as unknown as Session;
  return { session, listeners };
}

/** A request to a listener, and whether it was answered yet. */
function ask(
  listener: Listener | undefined,
  details: unknown,
): { readonly answer: Promise<unknown>; answered: boolean } {
  const asked = { answered: false, answer: Promise.resolve<unknown>(undefined) };
  asked.answer = new Promise((done) =>
    listener?.(details, (response) => {
      asked.answered = true;
      done(response);
    }),
  );
  return asked;
}

describe('attachLater', () => {
  it('holds the requests that come while the pipeline loads, and answers them with its steps', async () => {
    const { session, listeners } = webSession();
    const { promise: loading, resolve: loaded } = Promise.withResolvers<RequestPipeline>();
    let loads = 0;
    attachLater(session, () => {
      loads += 1;
      return loading;
    });
    // The listeners are there before any request, and nothing loads until one comes.
    expect(listeners.request).toBeDefined();
    expect(loads).toBe(0);
    const url = 'https://tracker.example/pixel.gif';
    const request = ask(listeners.request, { url });
    const send = ask(listeners.send, { url, requestHeaders: { Cookie: 'a=1', Accept: '*/*' } });
    const received = ask(listeners.received, {
      url,
      responseHeaders: { 'set-cookie': ['a=1'], 'content-type': ['image/gif'] },
    });
    await Promise.resolve();
    expect([request.answered, send.answered, received.answered]).toEqual([false, false, false]);
    const pipeline = new RequestPipeline();
    pipeline.add({
      beforeRequest: (details) => (details.url.includes('tracker') ? { cancel: true } : undefined),
      removedRequestHeaders: () => ['cookie'],
      removedResponseHeaders: () => ['set-cookie'],
    });
    loaded(pipeline);
    expect(await request.answer).toEqual({ cancel: true });
    expect(await send.answer).toEqual({ requestHeaders: { Accept: '*/*' } });
    expect(await received.answer).toEqual({ responseHeaders: { 'content-type': ['image/gif'] } });
    // Later requests use the pipeline that has loaded.
    expect(await ask(listeners.request, { url: 'https://site.example/' }).answer).toEqual({});
    expect(loads).toBe(4);
  });

  it('lets requests go on as they were when the pipeline cannot load', async () => {
    const { session, listeners } = webSession();
    attachLater(session, () => Promise.reject(new Error('missing chunk')));
    const url = 'https://site.example/';
    expect(await ask(listeners.request, { url }).answer).toEqual({});
    expect(await ask(listeners.send, { url, requestHeaders: { Cookie: 'a=1' } }).answer).toEqual(
      {},
    );
    expect(await ask(listeners.received, { url, responseHeaders: {} }).answer).toEqual({});
  });
});
