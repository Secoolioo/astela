import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';

const relaunched = vi.hoisted(() => [] as unknown[]);
vi.mock('electron', () => ({ app: { relaunch: (options: unknown) => relaunched.push(options) } }));

/** Shuts down with fakes and tells whether an update was installed. */
async function shutDownInstalls(): Promise<boolean> {
  const { shutDown } = await import('../shutdown.ts');
  const installOnExit = vi.fn();
  const clock = new ManualClock();
  await shutDown({
    logger: new SinkLogger(new RingBufferLogSink(), clock, { scope: 'test' }),
    clock,
    settings: { flush: () => Promise.resolve() },
    sessions: { schedule: () => undefined, flush: () => Promise.resolve() },
    windows: { snapshot: () => ({ windows: [] }), dispose: () => undefined },
    web: {
      flushStorageData: () => undefined,
      cookies: { flushStore: () => Promise.resolve() },
    } as unknown as Session,
    data: { dispose: () => undefined },
    updates: { installOnExit, dispose: () => undefined },
  } as unknown as Parameters<typeof shutDown>[0]);
  return installOnExit.mock.calls.length > 0;
}

describe('relaunch', () => {
  it('installs an update on a quit, but leaves it for later on a restart', async () => {
    const { relaunch, relaunching } = await import('../relaunch.ts');
    expect(relaunching()).toBe(false);
    expect(await shutDownInstalls()).toBe(true);
    relaunch(['--restore-last-session'], '');
    expect(relaunched.at(-1)).toEqual({ args: ['--restore-last-session'] });
    expect(relaunching()).toBe(true);
    expect(await shutDownInstalls()).toBe(false);
  });

  it('starts an AppImage again through its own file', async () => {
    const { relaunch } = await import('../relaunch.ts');
    relaunch(['--restore-last-session'], '/home/someone/Astela.AppImage');
    expect(relaunched.at(-1)).toEqual({
      args: ['--restore-last-session'],
      execPath: '/home/someone/Astela.AppImage',
    });
  });
});
