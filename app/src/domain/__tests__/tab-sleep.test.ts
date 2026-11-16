import { describe, expect, it } from 'vitest';
import { InactivityPolicy, type SleepCandidate } from '../tabs/tab-sleep.ts';

/** A tab with a view that the window does not show, idle since the start. */
function idle(id: string, change: Partial<SleepCandidate> = {}): SleepCandidate {
  return { id, live: true, shown: false, pinned: false, busy: false, idleSince: 0, ...change };
}

describe('InactivityPolicy', () => {
  const minute = 60_000;
  const policy = new InactivityPolicy(10 * minute);

  it('makes a tab due once it was idle for the time', () => {
    expect(policy.plan([idle('a')], 10 * minute)).toEqual({ due: ['a'], nextCheck: undefined });
    expect(policy.plan([idle('a')], 10 * minute - 1)).toEqual({ due: [], nextCheck: 10 * minute });
  });

  it('leaves tabs that sleep, show, are pinned or are busy, and plans no look for them', () => {
    const tabs = [
      idle('sleeping', { live: false }),
      idle('shown', { shown: true }),
      idle('pinned', { pinned: true }),
      idle('busy', { busy: true }),
    ];
    expect(policy.plan(tabs, 60 * minute)).toEqual({ due: [], nextCheck: undefined });
    expect(policy.plan([], 0)).toEqual({ due: [], nextCheck: undefined });
  });

  it('counts from the last use, and from the last try for a tab that stayed awake', () => {
    const tabs = [
      idle('used', { idleSince: 5 * minute }),
      idle('tried', { idleSince: 0, triedAt: 8 * minute }),
      idle('old', { idleSince: 1 * minute, triedAt: 0 }),
    ];
    expect(policy.plan(tabs, 11 * minute)).toEqual({ due: ['old'], nextCheck: 15 * minute });
    expect(policy.plan(tabs, 15 * minute)).toEqual({
      due: ['used', 'old'],
      nextCheck: 18 * minute,
    });
    expect(policy.plan(tabs, 18 * minute).due).toEqual(['used', 'tried', 'old']);
  });

  it('gives the earliest time at which the next tab becomes due', () => {
    const tabs = [
      idle('c', { idleSince: 30 }),
      idle('a', { idleSince: 10 }),
      idle('b', { idleSince: 20 }),
    ];
    expect(policy.plan(tabs, 5)).toEqual({ due: [], nextCheck: 10 + 10 * minute });
  });
});
