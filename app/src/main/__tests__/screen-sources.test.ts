import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import { listScreenSources, type SourceLister } from '../permission-prompt.ts';

vi.mock('electron', () => ({ desktopCapturer: { getSources: vi.fn() } }));

const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 'test' });

/** A lister that records what it was asked for, and fails for windows when told to. */
function recording(asked: string[][], windowsFail = false): SourceLister {
  return (options) => {
    asked.push([...options.types]);
    return windowsFail && options.types.includes('window') && !options.types.includes('screen')
      ? Promise.reject(new Error('no window manager'))
      : Promise.resolve([]);
  };
}

describe('listScreenSources', () => {
  it('asks the portal of Wayland once, for screens and windows together', async () => {
    const asked: string[][] = [];
    await listScreenSources(logger, recording(asked), {
      platform: 'linux',
      env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' },
    });
    expect(asked).toEqual([['screen', 'window']]);
  });

  it('lists screens and windows separately elsewhere, so screens show without windows', async () => {
    const asked: string[][] = [];
    await expect(
      listScreenSources(logger, recording(asked, true), {
        platform: 'linux',
        env: { XDG_SESSION_TYPE: 'x11', DISPLAY: ':0' },
      }),
    ).resolves.toEqual([]);
    expect(asked).toEqual([['screen'], ['window']]);
  });
});
