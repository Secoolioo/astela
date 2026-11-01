import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';

/** Lets administrators turn off the import of bookmarks, history and tabs from other browsers. */
export const ImportEnabled = definePolicy({
  name: 'ImportEnabled',
  schema: v.boolean(),
});
