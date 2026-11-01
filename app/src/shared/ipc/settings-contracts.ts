import * as v from 'valibot';
import { defineEvent, defineRequest } from './contract.ts';

const SettingKey = v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/));

/**
 * A setting as the settings page shows it: its key, its effective value, and whether a
 * mandatory policy sets the value, so it cannot be changed.
 */
export const SettingView = v.strictObject({
  key: SettingKey,
  value: v.unknown(),
  locked: v.boolean(),
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
