import type { TabId } from './tab-service.ts';

/** What the browser knows about a tab when it decides whether the tab goes to sleep. */
export interface SleepCandidate {
  readonly id: TabId;
  /** Whether the tab has a view that could close; a tab that sleeps already has none. */
  readonly live: boolean;
  /** Whether the window shows the tab's page. */
  readonly shown: boolean;
  readonly pinned: boolean;
  /**
   * Whether the page is busy: it plays sound or a video, uses a camera, a microphone or the
   * screen, downloads a file, has the developer tools open, or people typed into it since it
   * loaded.
   */
  readonly busy: boolean;
  /** Since when the tab was not used, in milliseconds of the wall clock. */
  readonly idleSince: number;
  /**
   * When the browser last tried to put the tab to sleep by itself, in milliseconds; a tab that
   * stayed awake for a reason that the candidate does not show, such as a link to another
   * page, is tried again only after another while.
   */
  readonly triedAt?: number | undefined;
}

/** Which tabs go to sleep now, and when to look again. */
export interface SleepPlan {
  /** The tabs that go to sleep now, in the order of the candidates. */
  readonly due: readonly TabId[];
  /**
   * When the next tab becomes due, in milliseconds of the wall clock, or `undefined` when no
   * tab can become due as things are.
   */
  readonly nextCheck: number | undefined;
}

/** Decides which tabs go to sleep by themselves. */
export interface TabLifecyclePolicy {
  /**
   * Plans which tabs go to sleep.
   * @param candidates - The tabs of a window.
   * @param now - The time of the wall clock, in milliseconds.
   */
  plan(candidates: readonly SleepCandidate[], now: number): SleepPlan;
}

/**
 * Puts tabs to sleep that were not used for a while: a tab that has a view and is neither
 * shown, pinned nor busy becomes due once it was idle for the time, counted from when it was
 * last used or last busy, or from when the browser last tried to put it to sleep.
 */
export class InactivityPolicy implements TabLifecyclePolicy {
  private readonly afterMs: number;

  /** @param afterMs - How long a tab stays idle before it sleeps, in milliseconds. */
  constructor(afterMs: number) {
    this.afterMs = afterMs;
  }

  plan(candidates: readonly SleepCandidate[], now: number): SleepPlan {
    const due: TabId[] = [];
    let nextCheck: number | undefined;
    for (const candidate of candidates) {
      if (!candidate.live || candidate.shown || candidate.pinned || candidate.busy) continue;
      const at = Math.max(candidate.idleSince, candidate.triedAt ?? 0) + this.afterMs;
      if (at <= now) due.push(candidate.id);
      else nextCheck = Math.min(nextCheck ?? at, at);
    }
    return { due, nextCheck };
  }
}
