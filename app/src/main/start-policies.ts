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
 * The policies that the policy service knows from the start of the browser: one for each
 * setting that declares a policy, and the standalone ones. The policies of the network load
 * apart and join them before the first read (`network-policies.ts`); `allPolicies` in
 * `policy-definitions.ts` lists both.
 */
export const startPolicies: readonly PolicyDefinition<unknown>[] = [
  ...settingPolicies(coreSettings),
  ...updatePolicies,
  SetupGuideEnabled,
  ImportEnabled,
  SSLErrorOverrideAllowed,
  DeveloperToolsAvailability,
  PrivateModeAvailability,
  DefaultBrowserSettingEnabled,
];
