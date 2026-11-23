import type { IpcMainEvent, IpcMainInvokeEvent, Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { BlockerFrames } from '../blocker-frames.ts';

type FrameListener = (event: IpcMainEvent, ...args: unknown[]) => void;
type ElementsHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
type KeyListener = (event: IpcMainEvent, kind: unknown, request: unknown) => void;
type MediaListener = (event: IpcMainEvent, keySystem: unknown) => void;
const channels: {
  frame?: FrameListener;
  prompt?: FrameListener;
  elements?: ElementsHandler;
  keys?: KeyListener;
  media?: MediaListener;
} = {};

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: FrameListener & KeyListener & MediaListener) => {
      if (channel === 'blocker.frame') channels.frame = listener;
      if (channel === 'webauthn.request') channels.keys = listener;
      if (channel === 'media.protected') channels.media = listener;
      if (channel === 'page.prompt') channels.prompt = listener;
    },
    handle: (channel: string, handler: ElementsHandler) => {
      if (channel === 'blocker.elements') channels.elements = handler;
    },
  },
}));

const { listenToFrames } = await import('../web-frames.ts');

/** A logger whose records the test reads. */
function logger(): { readonly logger: SinkLogger; readonly sink: RingBufferLogSink } {
  const sink = new RingBufferLogSink();
  return { logger: new SinkLogger(sink, new ManualClock(), { scope: 'test' }), sink };
}

/** The synchronous request of a frame preload, whose answer is the return value. */
function frameRequest(): IpcMainEvent & { returnValue: unknown } {
  return { returnValue: undefined } as IpcMainEvent & { returnValue: unknown };
}

describe('listenToFrames', () => {
  it('lets a frame that asks while the answers load wait for them', async () => {
    const { promise: loading, resolve: loaded } = Promise.withResolvers<BlockerFrames>();
    const addPreload = listenToFrames(
      () => loading,
      '/app/frame.cjs',
      logger().logger,
      () => undefined,
    );
    const request = frameRequest();
    channels.frame?.(request);
    const report = channels.elements?.({} as IpcMainInvokeEvent, { classes: ['ad'] });
    await Promise.resolve();
    // The frame waits: Electron holds the page until the return value is set.
    expect(request.returnValue).toBeUndefined();
    loaded({
      frame: (event) => {
        event.returnValue = { styles: '.ad { display: none }', scripts: [], extended: [] };
      },
      elements: (_event, payload) => Promise.resolve(JSON.stringify(payload)),
    });
    await vi.waitFor(() =>
      expect(request.returnValue).toEqual({
        styles: '.ad { display: none }',
        scripts: [],
        extended: [],
      }),
    );
    expect(await report).toBe('{"classes":["ad"]}');
    // Each web session gets the frame preload at once.
    const registerPreloadScript = vi.fn();
    addPreload({ registerPreloadScript, on: vi.fn() } as unknown as Session);
    expect(registerPreloadScript).toHaveBeenCalledWith({
      type: 'frame',
      id: 'content-blocker',
      filePath: '/app/frame.cjs',
    });
  });

  it('passes on what frames report of security keys and protected media, and accounts of a key', () => {
    const report = vi.fn();
    const chooseAccount = vi.fn();
    const protectedMedia = vi.fn();
    const addPreload = listenToFrames(
      () => Promise.reject(new Error('unused')),
      '/app/frame.cjs',
      logger().logger,
      () => undefined,
      { report, chooseAccount, protectedMedia },
    );
    const frame = { origin: 'https://example.com' };
    const sender = { id: 7 };
    const event = { sender, senderFrame: frame } as unknown as IpcMainEvent;
    channels.keys?.(event, 'start', 0);
    channels.keys?.(event, 'end', 0);
    // What a page could send otherwise reaches no question.
    for (const [kind, request] of [
      ['begin', 1],
      ['start', -1],
      ['start', 1.5],
      ['start', '1'],
    ] as const) {
      channels.keys?.(event, kind, request);
    }
    channels.keys?.({ sender, senderFrame: null } as unknown as IpcMainEvent, 'start', 2);
    expect(report.mock.calls).toEqual([
      [sender, frame, 'start', 0],
      [sender, frame, 'end', 0],
    ]);
    // A page that asked for protected playback in vain is marked; nonsense is not.
    channels.media?.(event, 'com.widevine.alpha');
    channels.media?.(event, 42);
    channels.media?.(event, 'x'.repeat(101));
    expect(protectedMedia.mock.calls).toEqual([[sender]]);
    // A session lets the person choose the account of a key for a passkey.
    const listeners = new Map<string, (...args: unknown[]) => void>();
    addPreload({
      registerPreloadScript: vi.fn(),
      on: (name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener),
    } as unknown as Session);
    const answer = vi.fn();
    const details = { relyingPartyId: 'example.com', accounts: [], frame: null };
    listeners.get('select-webauthn-account')?.({}, details, answer);
    expect(chooseAccount).toHaveBeenCalledWith(details, answer);
  });

  it('answers frames without rules when the answers cannot load, so no page waits forever', async () => {
    const { logger: log, sink } = logger();
    listenToFrames(
      () => Promise.reject(new Error('missing chunk')),
      '/app/frame.cjs',
      log,
      () => undefined,
    );
    const request = frameRequest();
    channels.frame?.(request);
    await vi.waitFor(() => expect(request.returnValue).toBeNull());
    expect(await channels.elements?.({} as IpcMainInvokeEvent, { classes: [] })).toBe('');
    expect(sink.records.some((record) => record.level === 'error')).toBe(true);
  });

  it('hands the prompt() of a frame over with what the frame sent', () => {
    const prompts: unknown[][] = [];
    listenToFrames(
      () => Promise.reject(new Error('unused')),
      '/app/frame.cjs',
      logger().logger,
      (event, message, value) => prompts.push([event, message, value]),
    );
    const request = frameRequest();
    channels.prompt?.(request, 'Your name?', 'x');
    expect(prompts).toEqual([[request, 'Your name?', 'x']]);
  });
});
