import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';

/**
 * Whether people may open the developer tools of web pages: `2` forbids them; `0` and `1`
 * allow them, as in other browsers, where `1` only concerns extensions, which Astela has
 * none of.
 */
export const DeveloperToolsAvailability = definePolicy({
  name: 'DeveloperToolsAvailability',
  schema: v.picklist([0, 1, 2]),
});
