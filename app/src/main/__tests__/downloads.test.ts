import type { DownloadItem } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { DataClient } from '../../platform/electron/data-service-client.ts';
import type { IpcRouter } from '../../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../../platform/electron/overlay.ts';
import type { WindowManager } from '../../platform/electron/browser-window.ts';
import type { Downloads as DownloadList } from '../downloads.ts';

vi.mock('electron', () => ({
  app: { getPath: () => '/downloads', getName: () => 'Astela' },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));
const quarantine = vi.hoisted(() =>
  vi.fn((_path: string, _agent: string, _time: number) => Promise.resolve(true)),
);
vi.mock('../../platform/node/quarantine.ts', () => ({ quarantine }));

/** A download that finished before the list followed it, so it sends no events any more. */
function finishedItem(): DownloadItem {
  return {
    getURL: () => 'https://files.example/report.txt',
    getSavePath: () => '/downloads/report.txt',
    getTotalBytes: () => 15,
    getReceivedBytes: () => 15,
    isPaused: () => false,
    getState: () => 'completed',
    on: vi.fn(),
    once: vi.fn(),
  } as unknown as DownloadItem;
}

/** A list of downloads whose data service records the calls it gets. */
async function downloadsList(): Promise<{
  list: DownloadList;
  calls: unknown[][];
}> {
  const { Downloads } = await import('../downloads.ts');
  const calls: unknown[][] = [];
  const data = {
    call: (method: string, ...params: unknown[]) => {
      calls.push([method, ...params]);
      return Promise.resolve(method === 'addDownload' ? 7 : method === 'downloads' ? [] : null);
    },
    dispose: () => undefined,
  } as unknown as DataClient;
  const list = new Downloads({
    data,
    windows: { all: [], refreshShells: () => undefined } as unknown as WindowManager,
    webSession: () => {
      throw new Error('no session');
    },
    overlay: {} as OverlayOptions,
    router: { handle: () => undefined } as unknown as IpcRouter,
    logger: new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' }),
  });
  return { list, calls };
}

describe('Downloads', () => {
  it('marks a download from the web as such on macOS, with the name of the browser', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    try {
      const { list } = await downloadsList();
      list.track(finishedItem(), false);
      expect(quarantine).toHaveBeenCalledWith(
        '/downloads/report.txt',
        'Astela',
        expect.any(Number),
      );
    } finally {
      if (platform !== undefined) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('lists a download that finished before the list followed it as finished', async () => {
    const { list, calls } = await downloadsList();
    list.track(finishedItem(), false);
    // The button shows no running download, and the list keeps the download as completed.
    expect(list.summary(false)).toEqual({ active: 0, progress: null });
    await vi.waitFor(() =>
      expect(calls).toContainEqual(['updateDownload', 7, 15, 15, 'completed']),
    );
  });
});
