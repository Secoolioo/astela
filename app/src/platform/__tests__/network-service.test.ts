import type { Details, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import {
  endAfter,
  lookInterval,
  maxLoads,
  maxLooks,
  networkServiceName,
  nextLook,
  type Looks,
  type watch as Watch,
} from '../electron/network-service.ts';

/** A view as far as the code uses it, which records what it was asked to load. */
interface FakeView {
  readonly id: number;
  readonly loads: string[];
  readonly listeners: Map<string, () => void>;
  destroyed: boolean;
  waiting: boolean;
  isDestroyed(): boolean;
  isWaitingForResponse(): boolean;
  loadURL(url: string): Promise<void>;
  on(event: string, listener: () => void): void;
}

const views: FakeView[] = [];
const gone: ((event: unknown, details: Details) => void)[] = [];
let services: { readonly pid: number; readonly serviceName?: string }[] = [];

vi.mock('electron', () => ({
  app: {
    on: (event: string, listener: (event: unknown, details: Details) => void): void => {
      if (event === 'child-process-gone') gone.push(listener);
    },
    getAppMetrics: () => services,
  },
  webContents: { getAllWebContents: (): readonly FakeView[] => views },
}));

function view(id: number): FakeView {
  const made: FakeView = {
    id,
    loads: [],
    listeners: new Map(),
    destroyed: false,
    waiting: true,
    isDestroyed: () => made.destroyed,
    isWaitingForResponse: () => made.waiting,
    loadURL: (url) => {
      made.loads.push(url);
      return Promise.resolve();
    },
    on: (event, listener) => void made.listeners.set(event, listener),
  };
  views.push(made);
  return made;
}

/** What Electron tells about a child process that went away: the network service by default. */
function lost(details: Partial<Details> = {}): void {
  const all: Details = {
    type: 'Utility',
    reason: 'killed',
    exitCode: 9,
    serviceName: networkServiceName,
    name: 'Network Service',
    ...details,
  };
  for (const listener of gone) listener({}, all);
}

/** What the looks at a page saw so far. */
function at(count: number, service: number | undefined, same: number): Looks {
  return { count, service, same };
}

describe('nextLook', () => {
  it('loads the page again at the first look, as the service may have gone away before', () => {
    expect(nextLook(undefined, 7, true)).toEqual({ looks: at(1, 7, 1), step: 'load' });
    expect(nextLook(undefined, undefined, true)).toEqual({
      looks: at(1, undefined, 1),
      step: 'load',
    });
  });

  it('waits for a service that may only be slow, and ends it after looks in a row', () => {
    expect(nextLook(at(1, 7, 1), 7, true)).toEqual({ looks: at(2, 7, 2), step: 'wait' });
    expect(endAfter).toBe(3);
    expect(nextLook(at(2, 7, 2), 7, true)).toEqual({ looks: at(3, 7, 3), step: 'end' });
    // A run ends one network service at most: one that is only slow would be slow again.
    expect(nextLook(at(2, 7, 2), 7, false)).toEqual({ looks: at(3, 7, 3), step: 'wait' });
  });

  it('loads the page again when another service runs than at the last look', () => {
    expect(nextLook(at(2, 7, 2), 8, true)).toEqual({ looks: at(3, 8, 1), step: 'load' });
  });

  it('waits for a service that started after the page loaded again, or after none ran', () => {
    // The page loaded again after the service went away; its navigation waits for the new one.
    expect(nextLook(at(3, undefined, 0), 8, true)).toEqual({ looks: at(4, 8, 1), step: 'wait' });
    expect(nextLook(at(2, 7, 2), undefined, true)).toEqual({
      looks: at(3, undefined, 1),
      step: 'wait',
    });
    expect(nextLook(at(4, undefined, 3), undefined, true)).toEqual({
      looks: at(5, undefined, 1),
      step: 'wait',
    });
  });

  it('stops looking after the last look', () => {
    expect(maxLooks).toBe(6);
    expect(nextLook(at(5, 7, 1), 7, false)).toEqual({ looks: at(6, 7, 2), step: 'stop' });
  });
});

describe('watch', () => {
  let sink: RingBufferLogSink;
  let logger: SinkLogger;
  let watch: typeof Watch;
  let kill: MockInstance<typeof process.kill>;

  beforeEach(async () => {
    views.length = 0;
    gone.length = 0;
    services = [{ pid: 7, serviceName: networkServiceName }];
    sink = new RingBufferLogSink();
    logger = new SinkLogger(sink, new ManualClock(), { scope: 'test' });
    vi.useFakeTimers();
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    // Each test starts with a browser that has not ended a network service yet.
    vi.resetModules();
    ({ watch } = await import('../electron/network-service.ts'));
  });

  afterEach(() => {
    vi.useRealTimers();
    kill.mockRestore();
  });

  const hand = (v: FakeView, url: string, current: () => boolean = () => true): void =>
    watch(v as unknown as WebContents, url, current, logger);

  it('loads a page that waits again, and forgets it once it shows its page', () => {
    const shell = view(1);
    hand(shell, 'app://shell/');
    expect(shell.loads).toEqual(['app://shell/']);
    expect(sink.records).toMatchObject([
      {
        level: 'warn',
        message: 'A page of the browser waited for the network service; it loads again',
        fields: { id: 1, url: 'app://shell/', looks: 1, service: 7 },
      },
    ]);
    shell.waiting = false;
    shell.listeners.get('did-navigate')?.();
    // A later wait of the same view starts from nothing.
    shell.waiting = true;
    hand(shell, 'app://shell/');
    expect(shell.loads).toEqual(['app://shell/', 'app://shell/']);
  });

  it('ends a network service that does not answer, and loads the page once it went away', () => {
    const shell = view(1);
    const newTab = view(2);
    hand(shell, 'app://shell/');
    hand(newTab, 'app://newtab/');
    // The loads of the first look wait too; the browser hands them over after the same time.
    vi.advanceTimersByTime(lookInterval);
    hand(shell, 'app://shell/');
    hand(newTab, 'app://newtab/');
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(lookInterval);
    expect(kill.mock.calls).toEqual([[7, 'SIGKILL']]);
    expect(sink.records.at(-1)).toMatchObject({
      level: 'warn',
      message: 'The network service did not answer a page of the browser and is ended',
      fields: { id: 1, url: 'app://shell/', looks: 3, service: 7 },
    });
    services = [{ pid: 8, serviceName: networkServiceName }];
    lost();
    expect(shell.loads).toEqual(['app://shell/', 'app://shell/']);
    expect(newTab.loads).toEqual(['app://newtab/', 'app://newtab/']);
    expect(sink.records.at(-1)).toMatchObject({
      message: 'The network service went away while a page of the browser waited; it loads again',
      fields: { id: 2, url: 'app://newtab/', reason: 'killed', exitCode: 9 },
    });
    // The page waits for the new service now, which is not ended: a run ends one at most.
    vi.advanceTimersByTime(lookInterval);
    hand(shell, 'app://shell/');
    vi.advanceTimersByTime(lookInterval * maxLooks);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(shell.loads).toHaveLength(2);
  });

  it('loads a page again when another network service runs than at the last look', () => {
    const shell = view(1);
    hand(shell, 'app://shell/');
    vi.advanceTimersByTime(lookInterval);
    // Chromium replaced the service without telling: no child-process-gone event.
    services = [{ pid: 8, serviceName: networkServiceName }];
    hand(shell, 'app://shell/');
    expect(shell.loads).toEqual(['app://shell/', 'app://shell/']);
    expect(sink.records.at(-1)).toMatchObject({ fields: { looks: 2, service: 8 } });
    expect(kill).not.toHaveBeenCalled();
  });

  it('leaves views whose navigation is no longer the latest, that closed or no longer wait', () => {
    const moved = view(1);
    const closed = view(2);
    const shown = view(3);
    let latest = true;
    hand(moved, 'app://settings/', () => latest);
    hand(closed, 'app://overlay/');
    hand(shown, 'app://newtab/');
    latest = false;
    closed.destroyed = true;
    shown.waiting = false;
    vi.advanceTimersByTime(lookInterval * maxLooks);
    lost();
    expect([moved.loads, closed.loads, shown.loads]).toEqual([
      ['app://settings/'],
      ['app://overlay/'],
      ['app://newtab/'],
    ]);
    expect(kill).not.toHaveBeenCalled();
  });

  it('never takes over a web page or another address, which could send a form again', () => {
    const page = view(1);
    hand(page, 'https://example.com/form');
    hand(page, 'http://localhost:5173/');
    lost();
    expect(page.loads).toEqual([]);
    expect(gone).toEqual([]);
    expect(sink.records).toEqual([]);
  });

  it('leaves the pages alone when another child process went away', () => {
    const shell = view(1);
    hand(shell, 'app://shell/');
    lost({ type: 'GPU' });
    lost({ serviceName: 'audio.mojom.AudioService' });
    expect(shell.loads).toEqual(['app://shell/']);
  });

  it('gives up on a page after it loaded again some times without showing it, and says so', () => {
    const shell = view(1);
    hand(shell, 'app://shell/');
    // A network service that goes away at each start would start the next one for good.
    for (let loss = 0; loss < maxLoads + 2; loss += 1) lost({ reason: 'launch-failed' });
    expect(shell.loads).toHaveLength(maxLoads);
    const records = sink.records.filter((record) => record.message.includes('it is left'));
    expect(records).toMatchObject([
      {
        level: 'warn',
        message: 'A page of the browser still waits for the network service; it is left',
        fields: { id: 1, url: 'app://shell/', loads: maxLoads },
      },
    ]);
    expect(sink.records).toHaveLength(maxLoads + 1);
  });
});
