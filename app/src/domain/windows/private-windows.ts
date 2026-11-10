import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';

/**
 * Whether people may open private windows: `1` keeps them from opening any; `0` allows
 * them, as in other browsers. Forcing every window to be private, which other browsers do
 * with `2`, is not supported yet.
 */
export const PrivateModeAvailability = definePolicy({
  name: 'PrivateModeAvailability',
  schema: v.picklist([0, 1]),
});
