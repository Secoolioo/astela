import { networkPolicies } from '../domain/network/proxy-policies.ts';
import type { PolicyDefinition } from '../domain/policy/policy.ts';
import { startPolicies } from './start-policies.ts';

/**
 * Every policy of the browser: those that the policy service knows from the start of the
 * browser (`start-policies.ts`), and those of the network, whose definitions load apart from
 * the start and join them before the first read of the policies. `tools/policies/reference.ts`
 * writes the policy reference and the JSON Schema of the Linux policy files from this list. A
 * new policy needs its texts in `tools/policies/notes.ts`; `pnpm verify` fails until the
 * reference is written again.
 */
export const allPolicies: readonly PolicyDefinition<unknown>[] = [
  ...startPolicies,
  ...networkPolicies,
];
