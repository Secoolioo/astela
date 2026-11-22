import type { DownloadItem } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { DataClient } from '../../platform/electron/data-service-client.ts';
import type { IpcRouter } from '../../platform/electron/ipc-router.ts';
import type { OverlayOptions } from '../../platform/electron/overlay.ts';
import type { WindowManager } from '../../platform/electron/browser-window.ts';
import type { Downloads as DownloadList } from '../downloads.ts';

const showMessageBox = vi.hoisted(() =>
  vi.fn((_window: unknown, _options: Electron.MessageBoxOptions) =>
    Promise.resolve({ response: 0, checkboxChecked: false }),
  ),
);
vi.mock('electron', () => ({
  app: { getPath: () => '/downloads', getName: () => 'Astela', getLocale: () => 'en-US' },
  dialog: { showMessageBox },
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

/** A download that still runs. */
function runningItem(): DownloadItem {
  return {
    getURL: () => 'https://files.example/large.bin',
    getSavePath: () => '/downloads/large.bin',
    getTotalBytes: () => 15,
    getReceivedBytes: () => 5,
    isPaused: () => false,
    getState: () => 'progressing',
    cancel: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
  } as unknown as DownloadItem;
}

/** A window for the list, with the tabs that it has. */
function windowWith(isPrivate: boolean, tabs = 1) {
  const all: unknown[] = Array.from({ length: tabs }, () => ({}));
  return {
    isPrivate,
    closing: false,
    window: { close: vi.fn(), isDestroyed: () => false },
    tabs: { all, open: vi.fn(() => all.push({})) },
  };
}

/** A window of {@link windowWith} as the list takes it. */
function asWindow(window: unknown): Parameters<DownloadList['holdsPrivateClose']>[0] {
  return window as Parameters<DownloadList['holdsPrivateClose']>[0];
}

/** A list of downloads whose data service records the calls it gets. */
async function downloadsList(windows: readonly unknown[] = []): Promise<{
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
    windows: { all: windows, refreshShells: () => undefined } as unknown as WindowManager,
    webSession: () => {
      throw new Error('no session');
    },
    overlay: {} as OverlayOptions,
    router: { handle: () => undefined } as unknown as IpcRouter,
    logger: new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' }),
    folder: () => '/downloads',
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

  it('asks before the last private window closes while its downloads run, once at a time', async () => {
    showMessageBox.mockClear();
    let answer: ((response: number) => void) | undefined;
    showMessageBox.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = (response) => resolve({ response, checkboxChecked: false });
        }),
    );
    // The window closed its last tab, and a regular window stays open.
    const window = windowWith(true, 0);
    const { list } = await downloadsList([window, windowWith(false)]);
    list.track(runningItem(), true);
    const held = asWindow(window);
    expect(list.holdsPrivateClose(held)).toBe(true);
    // The window shows a new tab page while it asks, and a second close asks no second time.
    expect(window.tabs.open).toHaveBeenCalledTimes(1);
    expect(list.holdsPrivateClose(held)).toBe(true);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(showMessageBox.mock.calls[0]?.[1]).toMatchObject({
      message: 'Cancel the private downloads?',
      buttons: ['Keep downloading', 'Cancel downloads'],
      defaultId: 0,
      cancelId: 0,
    });
    // Cancel downloads closes the window, which then closes without a question.
    answer?.(1);
    await vi.waitFor(() => expect(window.window.close).toHaveBeenCalledTimes(1));
    expect(list.holdsPrivateClose(held)).toBe(false);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('keeps the window that people keep, and asks again at its next close', async () => {
    showMessageBox.mockClear();
    const window = windowWith(true);
    const { list } = await downloadsList([window]);
    list.track(runningItem(), true);
    const held = asWindow(window);
    expect(list.holdsPrivateClose(held)).toBe(true);
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(1));
    // Keep downloading, the default answer, leaves the window and its tab as they are.
    await new Promise((settled) => setTimeout(settled, 0));
    expect(window.window.close).not.toHaveBeenCalled();
    expect(window.tabs.open).not.toHaveBeenCalled();
    expect(list.holdsPrivateClose(held)).toBe(true);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });

  it('closes a private window without a question while another one is open or nothing runs', async () => {
    showMessageBox.mockClear();
    const window = windowWith(true);
    const other = windowWith(true);
    const { list } = await downloadsList([window, other]);
    // Only downloads of regular windows run, which go on after private windows close.
    list.track(runningItem(), false);
    expect(list.holdsPrivateClose(asWindow(window))).toBe(false);
    list.track(runningItem(), true);
    // The other private window keeps the private session and its downloads.
    expect(list.holdsPrivateClose(asWindow(window))).toBe(false);
    other.closing = true;
    expect(list.holdsPrivateClose(asWindow(window))).toBe(true);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });
});
