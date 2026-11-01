import { FiltersEngine } from '@ghostery/adblocker';
import type { OnBeforeRequestListenerDetails, Session } from 'electron';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import { ContentBlocker } from '../blocker/content-blocker.ts';
import { RequestPipeline, type RequestInterceptor } from '../electron/request-pipeline.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const logger = (): SinkLogger =>
  new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });

function dataDir(filters: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'blocker-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'engine.bin'), FiltersEngine.parse(filters).serialize());
  return dir;
}

const request = (
  url: string,
  resourceType: string,
  webContentsId = 3,
): OnBeforeRequestListenerDetails =>
  ({
    url,
    resourceType,
    webContentsId,
    referrer: 'https://news.example/',
    frame: null,
  }) as unknown as OnBeforeRequestListenerDetails;

describe('ContentBlocker', () => {
  it('cancels matching subresources, counts them and leaves pages alone', async () => {
    const onBlocked = vi.fn();
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => true,
      onBlocked,
      logger: logger(),
    });
    expect(await blocker.beforeRequest(request('https://ads.example/a.js', 'script'))).toEqual({
      cancel: true,
    });
    expect(onBlocked).toHaveBeenCalledWith(3);
    expect(await blocker.beforeRequest(request('https://news.example/app.js', 'script'))).toBe(
      undefined,
    );
    expect(await blocker.beforeRequest(request('https://ads.example/', 'mainFrame'))).toBe(
      undefined,
    );
    expect(await blocker.beforeRequest(request('data:text/plain,x', 'image'))).toBe(undefined);
  });

  it('loads the engine with the first web page, not before', async () => {
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => true,
      logger: logger(),
    });
    const load = vi.spyOn(blocker, 'load');
    expect(await blocker.beforeRequest(request('app://newtab/', 'mainFrame'))).toBe(undefined);
    expect(load).not.toHaveBeenCalled();
    expect(await blocker.beforeRequest(request('https://news.example/', 'mainFrame'))).toBe(
      undefined,
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('blocks nothing when it is off or its data is missing', async () => {
    let enabled = false;
    const blocker = new ContentBlocker({
      dataDir: dataDir('||ads.example^\n'),
      enabled: () => enabled,
      logger: logger(),
    });
    expect(await blocker.beforeRequest(request('https://ads.example/a.js', 'script'))).toBe(
      undefined,
    );
    enabled = true;
    expect(await blocker.beforeRequest(request('https://ads.example/a.js', 'script'))).toEqual({
      cancel: true,
    });
    const missing = new ContentBlocker({
      dataDir: join(tmpdir(), 'no-such-blocker-data'),
      enabled: () => true,
      logger: logger(),
    });
    expect(await missing.load()).toBe(undefined);
    expect(await missing.beforeRequest(request('https://ads.example/a.js', 'script'))).toBe(
      undefined,
    );
  });
});

describe('RequestPipeline', () => {
  it('asks the interceptors in order and lets the first decision win', async () => {
    let listener: ((details: unknown, callback: (response: unknown) => void) => void) | undefined;
    const session = {
      webRequest: { onBeforeRequest: (fn: typeof listener) => (listener = fn) },
    } as unknown as Session;
    const pipeline = new RequestPipeline();
    const first: RequestInterceptor = { beforeRequest: () => undefined };
    const second: RequestInterceptor = { beforeRequest: () => Promise.resolve({ cancel: true }) };
    const unused = vi.fn();
    const third: RequestInterceptor = { beforeRequest: unused };
    pipeline.add(first);
    pipeline.add(second);
    pipeline.add(third);
    pipeline.attach(session);
    const response = await new Promise((done) => listener?.({ url: 'https://a.example/' }, done));
    expect(response).toEqual({ cancel: true });
    expect(unused).not.toHaveBeenCalled();
    const failing = new RequestPipeline();
    failing.add({ beforeRequest: () => Promise.reject(new Error('broken')) });
    failing.attach(session);
    expect(await new Promise((done) => listener?.({ url: 'https://a.example/' }, done))).toEqual(
      {},
    );
  });
});
