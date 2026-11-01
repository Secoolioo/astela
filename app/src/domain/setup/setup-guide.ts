import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';

/** Lets administrators turn off the setup guide that opens on the first start of a profile. */
export const SetupGuideEnabled = definePolicy({
  name: 'SetupGuideEnabled',
  schema: v.boolean(),
});

/**
 * Tells whether the first window opens the setup guide: once per profile, unless a
 * mandatory policy turns it off or the browser was started with `--no-first-run`.
 * @param state - Whether the guide was shown in this profile, the policy value and the switch.
 */
export function shouldShowSetupGuide(state: {
  readonly shown: boolean;
  readonly policy: boolean | undefined;
  readonly noFirstRun: boolean;
}): boolean {
  return !state.shown && state.policy !== false && !state.noFirstRun;
}
