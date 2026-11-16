import { describe, expect, it } from 'vitest';
import { sleepAfterChoices, sleepAfterSeconds } from '../tab-sleep.ts';

describe('sleepAfterSeconds', () => {
  it("are the times of Edge's SleepingTabsTimeout, from 30 seconds to 12 hours", () => {
    expect(sleepAfterSeconds).toEqual([30, 300, 900, 1800, 3600, 7200, 10800, 21600, 43200]);
  });

  it('leaves 30 seconds out of the choices of the settings page', () => {
    expect(sleepAfterChoices).toEqual(sleepAfterSeconds.slice(1));
    expect(sleepAfterChoices[0]).toBe(300);
  });
});
