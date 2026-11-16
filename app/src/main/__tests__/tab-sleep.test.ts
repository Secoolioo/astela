import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { SleepCandidate } from '../../domain/tabs/tab-sleep.ts';
import type { SettingDefinition } from '../../domain/settings/setting.ts';
import { Emitter } from '../../kernel/events/emitter.ts';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';

const power = new EventEmitter();
vi.mock('electron', () => ({ powerMonitor: power }));

const { startTabSleeper } = await import('../tab-sleep.ts');

const minute = 60_000;

/**
 * A window whose tabs sleep when asked, unless they stay awake for a reason that the plan does
 * not see, such as a link to another page; a tab that sleeps changes the tabs, as in a real
 * window.
 */
class FakeWindow {
  readonly asked: string[] = [];
  candidates: SleepCandidate[] = [];
  /** Tabs that stay awake when asked to sleep. */
  readonly staying = new Set<string>();
  /** Tells that the tabs changed. */
  changed = (): void => {};
  readonly tabs = {
    sleep: (id: string, mode = 'manual'): boolean => {
      this.asked.push(`${id} ${mode}`);
      const candidate = this.candidates.find((each) => each.id === id);
      if (candidate === undefined) return false;
      // The browser notes when it tried, as the window does.
      this.candidates = this.candidates.map((each) =>
        each.id !== id
          ? each
          : this.staying.has(id)
            ? { ...each, triedAt: clock.wallTime() }
            : { ...each, live: false },
      );
      if (this.staying.has(id)) return false;
      this.changed();
      return true;
    },
  };
  sleepCandidates(): SleepCandidate[] {
    return this.candidates;
  }
}

/** A tab with a view that the window does not show, idle since a time. */
function idle(id: string, idleSince: number, change: Partial<SleepCandidate> = {}): SleepCandidate {
  return { id, live: true, shown: false, pinned: false, busy: false, idleSince, ...change };
}

let clock = new ManualClock();

/** Starts a sleeper over windows with settings, on a clock whose wall time starts at 0. */
function sleeper(windows: FakeWindow[], values: { sleep?: boolean; after?: number } = {}) {
  clock = new ManualClock();
  const changes = new Emitter<void>();
  const busy = new Emitter<void>();
  const settingChanges = new Emitter<{ readonly keys: readonly string[] }>();
  const current = { 'tabs.sleep': values.sleep ?? true, 'tabs.sleepAfter': values.after ?? 600 };
  const settings = {
    get: <T>(definition: SettingDefinition<T>): T => Reflect.get(current, definition.key),
    onDidChange: settingChanges.event,
  };
  const logger = new SinkLogger(new RingBufferLogSink(), clock, { scope: 'test' });
  for (const window of windows) window.changed = () => changes.fire();
  const stop = startTabSleeper({
    windows: { all: windows, onDidChange: changes.event },
    settings,
    activity: { onDidChange: busy.event },
    clock,
    logger,
  });
  return {
    stop,
    changed: () => changes.fire(),
    busyChanged: () => busy.fire(),
    set: (key: keyof typeof current, value: never) => {
      Reflect.set(current, key, value);
      settingChanges.fire({ keys: [key] });
    },
  };
}

/** Lets the planned look at the tabs run. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));

describe('startTabSleeper', () => {
  it('arms one timer for the earliest tab that becomes due, and puts it to sleep then', async () => {
    const window = new FakeWindow();
    window.candidates = [idle('a', 0), idle('b', 3 * minute)];
    const run = sleeper([window]);
    await settle();
    expect(clock.pendingTimers).toBe(1);
    clock.advance(10 * minute - 1);
    await settle();
    expect(window.asked).toEqual([]);
    clock.advance(1);
    await settle();
    expect(window.asked).toEqual(['a auto']);
    // The tab that slept is no candidate any more; the next one is due 3 minutes later.
    expect(clock.pendingTimers).toBe(1);
    clock.advance(3 * minute);
    await settle();
    expect(window.asked).toEqual(['a auto', 'b auto']);
    expect(clock.pendingTimers).toBe(0);
    run.stop.dispose();
  });

  it('arms no timer without candidates, nor while tabs do not sleep by themselves', async () => {
    const window = new FakeWindow();
    window.candidates = [idle('shown', 0, { shown: true }), idle('pinned', 0, { pinned: true })];
    const run = sleeper([window]);
    await settle();
    expect(clock.pendingTimers).toBe(0);
    const off = new FakeWindow();
    off.candidates = [idle('a', 0)];
    const stopped = sleeper([off], { sleep: false });
    await settle();
    clock.advance(60 * minute);
    await settle();
    expect([clock.pendingTimers, off.asked]).toEqual([0, []]);
    // Turning it on looks again at once, and the tab is due.
    stopped.set('tabs.sleep', true as never);
    await settle();
    expect(off.asked).toEqual(['a auto']);
    run.stop.dispose();
    stopped.stop.dispose();
  });

  it('looks again when tabs, pages, the time of the settings change and the computer wakes', async () => {
    const window = new FakeWindow();
    window.candidates = [idle('a', 0, { busy: true })];
    const run = sleeper([window], { after: 3600 });
    await settle();
    expect(clock.pendingTimers).toBe(0);
    // The page stops being busy, a second later; the tab is due an hour after it was used.
    clock.advance(1000);
    window.candidates = [idle('a', 0)];
    run.busyChanged();
    await settle();
    expect(clock.pendingTimers).toBe(1);
    clock.advance(10 * minute);
    expect(window.asked).toEqual([]);
    // A shorter time makes the tab due at once.
    run.set('tabs.sleepAfter', 300 as never);
    await settle();
    expect(window.asked).toEqual(['a auto']);
    clock.advance(1000);
    window.candidates = [idle('b', clock.wallTime() - 10 * minute)];
    power.emit('resume');
    await settle();
    expect(window.asked).toEqual(['a auto', 'b auto']);
    clock.advance(1000);
    window.candidates = [idle('c', clock.wallTime() - 10 * minute)];
    run.changed();
    run.changed();
    await settle();
    expect(window.asked).toEqual(['a auto', 'b auto', 'c auto']);
    run.stop.dispose();
    // Once stopped, nothing makes it look again.
    window.candidates = [idle('d', 0)];
    power.emit('resume');
    run.changed();
    await settle();
    expect(window.asked).toHaveLength(3);
    expect(power.listenerCount('resume')).toBe(0);
  });

  it('looks at most once a second while the tabs keep changing, as while a page loads', async () => {
    const window = new FakeWindow();
    window.candidates = [idle('shown', 0, { shown: true })];
    let looks = 0;
    const candidates = window.sleepCandidates.bind(window);
    window.sleepCandidates = () => {
      looks += 1;
      return candidates();
    };
    const run = sleeper([window]);
    await settle();
    expect(looks).toBe(1);
    // Each change comes in a task of its own, as the counts of blocked requests do.
    for (let change = 0; change < 200; change += 1) {
      run.changed();
      await settle();
    }
    expect([looks, clock.pendingTimers]).toEqual([1, 1]);
    clock.advance(999);
    await settle();
    expect(looks).toBe(1);
    clock.advance(1);
    await settle();
    expect([looks, clock.pendingTimers]).toEqual([2, 0]);
    // After a quiet second, a change looks at once; a tab that goes to sleep then needs no other
    // look.
    clock.advance(20 * minute);
    window.candidates = [idle('a', 0)];
    run.changed();
    await settle();
    expect([looks, window.asked, clock.pendingTimers]).toEqual([3, ['a auto'], 0]);
    run.stop.dispose();
  });

  it('tries a tab that stayed awake when asked again only after another full time', async () => {
    const window = new FakeWindow();
    window.candidates = [idle('stay', 0)];
    window.staying.add('stay');
    const run = sleeper([window]);
    await settle();
    clock.advance(10 * minute);
    await settle();
    expect(window.asked).toEqual(['stay auto']);
    expect(clock.pendingTimers).toBe(1);
    clock.advance(10 * minute - 1);
    await settle();
    expect(window.asked).toEqual(['stay auto']);
    clock.advance(1);
    await settle();
    expect(window.asked).toEqual(['stay auto', 'stay auto']);
    run.stop.dispose();
  });

  it('plans the tabs of every window', async () => {
    const first = new FakeWindow();
    const second = new FakeWindow();
    first.candidates = [idle('a', 0)];
    second.candidates = [idle('b', 2 * minute)];
    const run = sleeper([first, second]);
    clock.advance(12 * minute);
    await settle();
    expect([first.asked, second.asked]).toEqual([['a auto'], ['b auto']]);
    run.stop.dispose();
  });
});
