/**
 * The times after which a tab that is not used goes to sleep, in seconds: the values of the
 * policy `SleepingTabsTimeout`, which are those of Microsoft Edge. 30 seconds is there for
 * policies and the settings file, such as of end-to-end tests; the settings page offers it
 * only while it is the value.
 */
export const sleepAfterSeconds = [30, 300, 900, 1800, 3600, 7200, 10800, 21600, 43200] as const;

/** A time after which a tab that is not used goes to sleep, in seconds. */
export type SleepAfter = (typeof sleepAfterSeconds)[number];

/** The times that the settings page offers, from 5 minutes on. */
export const sleepAfterChoices: readonly SleepAfter[] = sleepAfterSeconds.filter(
  (seconds) => seconds >= 300,
);
