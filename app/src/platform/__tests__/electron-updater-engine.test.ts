import { CancellationError, CancellationToken } from 'builder-util-runtime';
import { autoUpdater } from 'electron-updater';
import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../kernel/events/emitter.ts';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { SignedFeed } from '../../domain/updates/feed.ts';
import type { Cancellation } from '../../domain/updates/update-service.ts';
import { createElectronUpdaterEngine } from '../updates/electron-updater-engine.ts';

/** What the updater is given by an engine: the feed that its provider asks. */
interface FeedOptions {
  readonly feed: { findUpdate(): Promise<{ manifest: { version: string } } | undefined> };
}

/**
 * electron-updater's one updater of the process, as far as the engine uses it. Like the real
 * one, it hands a download that runs to whoever asks next, whatever version that one found.
 */
const { FakeUpdater } = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const runtime = await import('builder-util-runtime');
  class Updater extends EventEmitter {
    private options: FeedOptions | undefined;
    private found: string | undefined;
    private downloading: Promise<string[]> | undefined;
    /** The versions whose downloads started. */
    readonly started: string[] = [];
    /** Ends the download that runs, as electron-updater does once the file is verified. */
    finish: () => void = () => undefined;

    setFeedURL(options: FeedOptions): void {
      this.options = options;
    }

    async checkForUpdates(): Promise<{
      isUpdateAvailable: boolean;
      updateInfo: { version: string | undefined };
    }> {
      const found = await this.options?.feed.findUpdate();
      this.found = found?.manifest.version;
      return { isUpdateAvailable: found !== undefined, updateInfo: { version: this.found } };
    }

    downloadUpdate(token = new runtime.CancellationToken()): Promise<string[]> {
      if (this.downloading !== undefined) return this.downloading;
      const version = this.found ?? 'nothing';
      this.started.push(version);
      this.downloading = token
        .createPromise<string[]>((resolve) => {
          this.finish = () => {
            this.emit('update-downloaded', { version });
            resolve([`${version}.AppImage`]);
          };
        })
        .finally(() => {
          this.downloading = undefined;
        });
      return this.downloading;
    }
  }
  return { FakeUpdater: Updater };
});

// The provider of the signed feed extends electron-updater's, which the fake never makes.
vi.mock('electron-updater', () => ({ autoUpdater: new FakeUpdater(), Provider: Object }));

const updater = autoUpdater as unknown as InstanceType<typeof FakeUpdater>;

/** An engine whose feed offers a version, as the engine of one update service. */
function engineFor(version: string): ReturnType<typeof createElectronUpdaterEngine> {
  const clock = new ManualClock(0, 0);
  const feed = { findUpdate: () => Promise.resolve({ manifest: { version } }) };
  return createElectronUpdaterEngine({
    feed: feed as unknown as SignedFeed,
    query: { channel: 'stable', currentVersion: '0.7.4', artifactKey: 'linux-x64-appimage' },
    feedBase: new URL('https://updates.example/'),
    logger: new SinkLogger(new RingBufferLogSink(10), clock, { scope: 'test' }),
  });
}

/** The cancellation of one update service, which its disposal fires. */
function cancellation(): Cancellation & { cancel(): void } {
  const emitter = new Emitter<void>();
  let cancelled = false;
  return {
    isCancelled: () => cancelled,
    onCancel: emitter.event,
    cancel: () => {
      cancelled = true;
      emitter.fire();
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('createElectronUpdaterEngine', () => {
  it('waits for the cancelled download of the engine before, and downloads its own version', async () => {
    const before = engineFor('0.8.0-beta.1');
    expect(await before.check()).toBe('0.8.0-beta.1');
    const old = cancellation();
    const oldDownload = before.download(() => undefined, old);
    const oldResult = oldDownload.then(
      () => 'done',
      (error: unknown) => (error instanceof CancellationError ? 'cancelled' : String(error)),
    );
    await settle();
    expect(updater.started).toEqual(['0.8.0-beta.1']);

    // New policies dispose the service, which cancels its download, and make a new engine.
    const after = engineFor('0.7.5');
    const check = after.check();
    old.cancel();
    expect(await check).toBe('0.7.5');
    expect(await oldResult).toBe('cancelled');
    const download = after.download(() => undefined, cancellation());
    await settle();
    expect(updater.started).toEqual(['0.8.0-beta.1', '0.7.5']);
    updater.finish();
    await expect(download).resolves.toBeUndefined();
  });

  it('refuses a file of another version than the one it found', async () => {
    const engine = engineFor('0.7.5');
    expect(await engine.check()).toBe('0.7.5');
    // Something else started a download of another version on the shared updater.
    updater.setFeedURL({
      feed: { findUpdate: () => Promise.resolve({ manifest: { version: '0.8.0' } }) },
    });
    await updater.checkForUpdates();
    const foreign = updater.downloadUpdate(new CancellationToken());
    const download = engine.download(() => undefined, cancellation());
    await settle();
    updater.finish();
    await foreign;
    await expect(download).rejects.toMatchObject({ code: 'mismatch' });
  });

  it('starts no download that was cancelled before its turn', async () => {
    const engine = engineFor('0.7.6');
    expect(await engine.check()).toBe('0.7.6');
    const stop = cancellation();
    stop.cancel();
    await expect(engine.download(() => undefined, stop)).rejects.toBeInstanceOf(CancellationError);
    expect(updater.started).not.toContain('0.7.6');
  });
});
