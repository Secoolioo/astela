import type { PolicyDefinition } from '../domain/policy/policy.ts';
import { settingPolicies } from '../domain/settings/settings-service.ts';
import { updatePolicies } from '../domain/updates/update-policies.ts';
import { SetupGuideEnabled } from '../domain/setup/setup-guide.ts';
import { ImportEnabled } from '../domain/import/import.ts';
import { SSLErrorOverrideAllowed } from '../domain/certificates/certificates.ts';
import { DeveloperToolsAvailability } from '../domain/page-tools/page-tools.ts';
import { PrivateModeAvailability } from '../domain/windows/private-windows.ts';
import { DefaultBrowserSettingEnabled } from '../domain/default-browser/default-browser.ts';
import { coreSettings } from './core-settings.ts';

/**
 * Every policy of the browser: one for each setting that declares a policy, and the
 * standalone ones. The policy service checks what administrators set against this list, and
 * `tools/policies/reference.ts` writes the policy reference and the JSON Schema of the Linux
 * policy files from it. A new policy needs its texts in `tools/policies/notes.ts`; `pnpm verify`
 * fails until the reference is written again.
 */
export const allPolicies: readonly PolicyDefinition<unknown>[] = [
  ...settingPolicies(coreSettings),
  ...updatePolicies,
  SetupGuideEnabled,
  ImportEnabled,
  SSLErrorOverrideAllowed,
  DeveloperToolsAvailability,
  PrivateModeAvailability,
  DefaultBrowserSettingEnabled,
];
