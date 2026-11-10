import type { IpcMainInvokeEvent } from 'electron';
import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import { defineRequest } from '../../shared/ipc/contract.ts';
import { IpcGate } from '../electron/ipc-gate.ts';
import { IpcRouter } from '../electron/ipc-router.ts';

type Handler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
const handlers = new Map<string, Handler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      if (handlers.has(channel)) throw new Error(`Second handler for ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));

const Double = defineRequest({
  channel: 'test.double',
  request: v.strictObject({ n: v.number() }),
  response: v.number(),
  capability: 'shell',
});

/** A request of the shell, as Electron hands it to a handler. */
function request(channel: string, payload: unknown): Promise<unknown> {
  const frame = { url: 'app://shell/index.html' };
  const event = { sender: { id: 7, mainFrame: frame }, senderFrame: frame };
  const handler = handlers.get(channel);
  if (handler === undefined) throw new Error(`No handler for ${channel}`);
  return handler(event as unknown as IpcMainInvokeEvent, payload);
}

describe('IpcRouter.handleLater', () => {
  it('loads the handlers with the first request, which waits for them and passes the checks', async () => {
    handlers.clear();
    const gate = new IpcGate(new ManualClock());
    gate.registerView(7, { origin: 'app://shell', capabilities: new Set(['shell']) });
    const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
    const router = new IpcRouter(gate, logger);
    let loads = 0;
    router.handleLater(['test.double'], () => {
      loads += 1;
      return Promise.resolve().then(() => {
        router.handle(Double, ({ n }) => n * 2);
      });
    });
    expect(loads).toBe(0);
    const [first, second] = await Promise.all([
      request('test.double', { n: 2 }),
      request('test.double', { n: 5 }),
    ]);
    expect([first, second]).toEqual([4, 10]);
    expect(loads).toBe(1);
    // The handler that loaded later checks requests like any other.
    await expect(request('test.double', { n: 'two' })).rejects.toThrow('Request refused');
  });

  it('refuses a request on a channel that the loaded code does not handle', async () => {
    handlers.clear();
    const gate = new IpcGate(new ManualClock());
    const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });
    const router = new IpcRouter(gate, logger);
    router.handleLater(['test.missing'], () => Promise.resolve());
    await expect(request('test.missing', {})).rejects.toThrow('Request refused');
  });
});
