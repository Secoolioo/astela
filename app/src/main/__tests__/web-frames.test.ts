import type { IpcMainEvent, IpcMainInvokeEvent, Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { BlockerFrames } from '../blocker-frames.ts';

type FrameListener = (event: IpcMainEvent) => void;
type ElementsHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
const channels: { frame?: FrameListener; elements?: ElementsHandler } = {};

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, listener: FrameListener) => {
      if (channel === 'blocker.frame') channels.frame = listener;
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
    const addPreload = listenToFrames(() => loading, '/app/frame.cjs', logger().logger);
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
    addPreload({ registerPreloadScript } as unknown as Session);
    expect(registerPreloadScript).toHaveBeenCalledWith({
      type: 'frame',
      id: 'content-blocker',
      filePath: '/app/frame.cjs',
    });
  });

  it('answers frames without rules when the answers cannot load, so no page waits forever', async () => {
    const { logger: log, sink } = logger();
    listenToFrames(() => Promise.reject(new Error('missing chunk')), '/app/frame.cjs', log);
    const request = frameRequest();
    channels.frame?.(request);
    await vi.waitFor(() => expect(request.returnValue).toBeNull());
    expect(await channels.elements?.({} as IpcMainInvokeEvent, { classes: [] })).toBe('');
    expect(sink.records.some((record) => record.level === 'error')).toBe(true);
  });
});
