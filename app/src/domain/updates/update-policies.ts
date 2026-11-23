import * as v from 'valibot';
import { definePolicy, type PolicyDefinition } from '../policy/policy.ts';
import { UpdateChannelSchema } from './channel.ts';

// The update service reads these policies once, when it is created after the first window
// loads, so a change of any of them takes effect at the next start.

/** `UpdatePolicy`: 0 turns updates off, 1 updates automatically, 2 only on request. */
export const UpdatePolicy = definePolicy({
  name: 'UpdatePolicy',
  schema: v.picklist([0, 1, 2]),
  restartRequired: true,
});

/** `TargetChannel`: the update channel, `stable` or `beta`. */
export const TargetChannel = definePolicy({
  name: 'TargetChannel',
  schema: UpdateChannelSchema,
  restartRequired: true,
});

/** `TargetVersionPrefix`: only versions with this prefix are installed, such as `0.1`. */
export const TargetVersionPrefix = definePolicy({
  name: 'TargetVersionPrefix',
  schema: v.pipe(v.string(), v.regex(/^\d+(\.\d+){0,2}\.?$/, 'Must be a version prefix')),
  restartRequired: true,
});

/**
 * `UpdateURL`: the root of an organization mirror of the feed. Sensitive, because it
 * decides where updates come from; the signatures are checked all the same.
 */
export const UpdateURL = definePolicy({
  name: 'UpdateURL',
  schema: v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//i, 'Must be an http or https URL')),
  sensitive: true,
  restartRequired: true,
});

/** `AutoUpdateCheckPeriodMinutes`: minutes between automatic checks, 60 to 43200. */
export const AutoUpdateCheckPeriodMinutes = definePolicy({
  name: 'AutoUpdateCheckPeriodMinutes',
  schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(43_200)),
  restartRequired: true,
});

/** All update policies. */
export const updatePolicies: readonly PolicyDefinition<unknown>[] = [
  UpdatePolicy,
  TargetChannel,
  TargetVersionPrefix,
  UpdateURL,
  AutoUpdateCheckPeriodMinutes,
];

/** Default minutes between automatic checks. */
export const defaultCheckPeriodMinutes = 240;
