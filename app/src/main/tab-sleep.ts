import { powerMonitor } from 'electron';
import type { Logger } from '../kernel/logging/logger.ts';
import type { Clock } from '../kernel/time/clock.ts';
import type { Event } from '../kernel/events/emitter.ts';
import { InactivityPolicy } from '../domain/tabs/tab-sleep.ts';
import type { SettingsService } from '../domain/settings/settings-service.ts';
import type { TabId, TabService } from '../domain/tabs/tab-service.ts';
import type { SleepCandidate } from '../domain/tabs/tab-sleep.ts';
import { DisposableStore, toDisposable, type Disposable } from '../shared/disposable.ts';
import { TabSleepAfterSetting, TabSleepSetting } from './core-settings.ts';

/** A window whose tabs may go to sleep by themselves. */
export interface SleepingWindow {
  readonly tabs: Pick<TabService, 'sleep'>;
  /** The tabs of the window, with since when each was not used. */
  sleepCandidates(): SleepCandidate[];
}

/** What the browser's tabs need to go to sleep by themselves. */
export interface TabSleeperOptions<W extends SleepingWindow = SleepingWindow> {
  /** The open windows, and when their tabs change. */
  readonly windows: {
    readonly all: readonly W[];
    readonly onDidChange: Event<void>;
  };
  readonly settings: Pick<SettingsService, 'get' | 'onDidChange'>;
  /** When pages become busy or stop being busy, such as with a download. */
  readonly activity: { readonly onDidChange: Event<void> };
  /**
   * Asks the pages of tabs that are due what only they can tell, such as a video in picture in
   * picture that a page started itself, before the tabs go to sleep; a tab that turns out busy
   * stays awake. Without it, the tabs go to sleep at once.
   */
  readonly beforeSleep?: (window: W, ids: readonly TabId[]) => Promise<void>;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** The shortest wait between two looks at the tabs, in milliseconds. */
const shortestWait = 1000;

/**
 * Puts the tabs of every window to sleep that were not used for the time of the settings,
 * while the settings let them sleep. It looks again when tabs, pages or the settings change,
 * and when the computer wakes up, at most once a second, as a page that loads changes its tab
 * many times; otherwise it looks only when the next tab becomes due. It arms at most one
 * timer, and none while no tab can become due or tabs do not sleep by themselves. Tabs that
 * are due go to sleep once their pages were asked (`beforeSleep`), if they are due still.
 * @param options - The windows, the settings and the time.
 * @returns Stops it.
 */
export function startTabSleeper<W extends SleepingWindow>(
  options: TabSleeperOptions<W>,
): Disposable {
  const { windows, settings, activity, beforeSleep, clock, logger } = options;
  const subscriptions = new DisposableStore();
  let timer: Disposable | undefined;
  let planned = false;
  let stopped = false;
  /** When it last looked at the tabs, by the monotonic clock. */
  let lastPlan: number | undefined;
  /** The windows whose pages are asked before their tabs go to sleep. */
  const asking = new WeakSet<W>();
  /**
   * Asks the pages of the tabs of a window that are due, then puts those to sleep that are due
   * still, as a tab may have been used meanwhile or turned out busy, and looks again. A page
   * that could not be asked does not keep its tab awake.
   */
  const ask = (
    window: W,
    due: readonly TabId[],
    before: (window: W, ids: readonly TabId[]) => Promise<void>,
  ): void => {
    asking.add(window);
    before(window, due)
      .catch((error: unknown) => {
        logger.warn('The pages of tabs were not asked before they sleep', { error: String(error) });
      })
      .finally(() => {
        asking.delete(window);
        if (stopped || !settings.get(TabSleepSetting)) return;
        const policy = new InactivityPolicy(settings.get(TabSleepAfterSetting) * 1000);
        const still = policy.plan(window.sleepCandidates(), clock.wallTime()).due;
        const slept = due.filter((id) => still.includes(id) && window.tabs.sleep(id, 'auto'));
        if (slept.length > 0) logger.debug('Tabs that were not used go to sleep');
        schedule();
      });
  };
  /** Puts the tabs to sleep that are due, and tells when the next one becomes due. */
  const sleepDue = (): number | undefined => {
    if (stopped || !settings.get(TabSleepSetting)) return undefined;
    const after = settings.get(TabSleepAfterSetting) * 1000;
    const policy = new InactivityPolicy(after);
    let next: number | undefined;
    for (const window of windows.all) {
      // The tabs of a window whose pages are asked go to sleep once they answered, which looks
      // at the tabs again.
      if (asking.has(window)) continue;
      const now = clock.wallTime();
      const { due, nextCheck } = policy.plan(window.sleepCandidates(), now);
      if (due.length > 0 && beforeSleep !== undefined) {
        ask(window, due, beforeSleep);
        continue;
      }
      const stayed = due.filter((id) => !window.tabs.sleep(id, 'auto'));
      if (stayed.length < due.length) logger.debug('Tabs that were not used go to sleep');
      // A tab that stays awake for a reason that the plan does not see, such as a link to
      // another page, is tried again after another while.
      const again = stayed.length > 0 ? now + after : undefined;
      for (const at of [nextCheck, again]) {
        if (at !== undefined) next = Math.min(next ?? at, at);
      }
    }
    return next;
  };
  const plan = (): void => {
    timer?.dispose();
    timer = undefined;
    lastPlan = clock.now();
    // The tabs that go to sleep change the tabs of their window, which needs no other look.
    planned = true;
    let next: number | undefined;
    try {
      next = sleepDue();
    } finally {
      planned = false;
    }
    if (next !== undefined) {
      timer = clock.setTimeout(schedule, Math.max(shortestWait, next - clock.wallTime()));
    }
  };
  // Many changes at once, such as the tabs of a window that closes, plan once, and changes
  // that keep coming, such as the requests that the blocker counts, once a second.
  const schedule = (): void => {
    if (planned || stopped) return;
    planned = true;
    const wait = lastPlan === undefined ? 0 : lastPlan + shortestWait - clock.now();
    if (wait <= 0) {
      queueMicrotask(plan);
      return;
    }
    timer?.dispose();
    timer = clock.setTimeout(plan, wait);
  };
  subscriptions.add(windows.onDidChange(schedule));
  subscriptions.add(activity.onDidChange(schedule));
  subscriptions.add(
    settings.onDidChange(({ keys }) => {
      if (keys.includes(TabSleepSetting.key) || keys.includes(TabSleepAfterSetting.key)) schedule();
    }),
  );
  // The wall clock moved on while the computer slept, and timers may come late.
  powerMonitor.on('resume', schedule);
  subscriptions.add(toDisposable(() => powerMonitor.off('resume', schedule)));
  schedule();
  return toDisposable(() => {
    stopped = true;
    timer?.dispose();
    subscriptions.dispose();
  });
}
