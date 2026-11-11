import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';

const SettingKey = v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/));

/**
 * A setting as the settings page shows it: its key, its effective value, whether a
 * mandatory policy sets the value, so it cannot be changed, whether the user set a value
 * other than the default, whether the value is the one that a recommended policy suggests,
 * and whether the value differs from the one that the browser started with and takes effect
 * only after a restart.
 */
export const SettingView = v.strictObject({
  key: SettingKey,
  value: v.unknown(),
  locked: v.boolean(),
  changed: v.boolean(),
  recommended: v.boolean(),
  restart: v.boolean(),
});

/** A setting as the settings page shows it. */
export type SettingView = v.InferOutput<typeof SettingView>;

/** The accent presets with their colors in light and dark mode, for the swatches. */
const AccentSwatch = v.strictObject({ id: v.string(), light: v.string(), dark: v.string() });

/** Returns every setting that the settings page shows, and the accent swatches. */
export const GetSettings = defineRequest({
  channel: 'settings.getAll',
  request: v.strictObject({}),
  response: v.strictObject({ settings: v.array(SettingView), accents: v.array(AccentSwatch) }),
  capability: 'page:settings',
});

/** Changes a setting; the browser process validates the value against its schema. */
export const SetSetting = defineRequest({
  channel: 'settings.set',
  request: v.strictObject({ key: SettingKey, value: v.unknown() }),
  response: v.union([
    v.strictObject({ ok: v.literal(true) }),
    v.strictObject({ ok: v.literal(false), error: v.picklist(['unknown', 'locked', 'invalid']) }),
  ]),
  capability: 'page:settings',
  ratePerSecond: 20,
});

/** Sent to the settings page when settings changed, also in another window or by policy. */
export const SettingsChanged = defineEvent({
  channel: 'settings.changed',
  payload: v.strictObject({ settings: v.array(SettingView) }),
  capability: 'page:settings',
});

/** Sets settings back to their defaults; settings that a policy fixes stay as they are. */
export const ResetSettings = defineRequest({
  channel: 'settings.reset',
  request: v.strictObject({ keys: v.pipe(v.array(SettingKey), v.maxLength(200)) }),
  response: v.null(),
  capability: 'page:settings',
  ratePerSecond: 5,
});

/** Saves the settings that the user changed to a file that the user picks. */
export const ExportSettings = defineRequest({
  channel: 'settings.export',
  request: v.strictObject({}),
  response: v.strictObject({ saved: v.boolean() }),
  capability: 'page:settings',
  ratePerSecond: 2,
});

/** Reads settings from a file that the user picks, and tells what it changed. */
export const ImportSettings = defineRequest({
  channel: 'settings.import',
  request: v.strictObject({}),
  response: v.union([
    v.strictObject({ ok: v.literal(true), applied: v.number(), skipped: v.number() }),
    v.strictObject({ ok: v.literal(false), error: v.picklist(['canceled', 'invalid']) }),
  ]),
  capability: 'page:settings',
  ratePerSecond: 2,
});

/** Quits the browser and starts it again with the open tabs, so changed settings take effect. */
export const RestartBrowser = defineRequest({
  channel: 'settings.restart',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'page:settings',
  ratePerSecond: 1,
});

/**
 * Asks for the folder of downloads in the system's dialog and sets it; the page never names
 * a folder itself.
 */
export const ChooseDownloadFolder = defineRequest({
  channel: 'settings.chooseDownloadFolder',
  request: v.strictObject({}),
  response: v.strictObject({ chosen: v.boolean() }),
  capability: 'page:settings',
  ratePerSecond: 2,
});

/** How far back clearing the browsing data goes: the last hour, day, week or four weeks, or all. */
export const clearRanges = ['hour', 'day', 'week', 'month', 'all'] as const;

/**
 * Clears browsing data: the history of a time range, and all cookies and site data, and the
 * cache, of web pages in regular windows.
 */
export const ClearBrowsingData = defineRequest({
  channel: 'settings.clearData',
  request: v.strictObject({
    range: v.picklist(clearRanges),
    history: v.boolean(),
    cookies: v.boolean(),
    cache: v.boolean(),
  }),
  response: v.null(),
  capability: 'page:settings',
  ratePerSecond: 1,
});
