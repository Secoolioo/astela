import { userInfo } from 'node:os';
import type { Brand } from '../../shared/brand.ts';
import type { PolicyProvider } from '../../domain/policy/policy.ts';
import type * as Providers from './policy-providers.ts';

/**
 * Creates the policy providers of the current platform. Paths follow the enterprise
 * design: `SOFTWARE\Policies\<Product>` on Windows, managed preferences of the bundle id
 * on macOS and `/etc/<slug>/policies` on Linux. The code that reads the sources loads with
 * the first read, which runs while Electron starts, so it stays out of the start path.
 * @param brand - Product names and identifiers.
 * @param platform - `process.platform`.
 * @param io - System access; defaults to Node.js.
 */
export function createPolicyProviders(
  brand: Brand,
  platform: NodeJS.Platform,
  io?: Providers.PolicyIo,
): PolicyProvider[] {
  if (platform === 'win32') {
    return [
      onDemand(
        'windows-registry',
        (module) =>
          new module.WindowsRegistryPolicyProvider(
            io ?? module.nodePolicyIo,
            `SOFTWARE\\Policies\\${brand.productName}`,
          ),
      ),
    ];
  }
  if (platform === 'darwin') {
    return [
      onDemand(
        'macos-managed-preferences',
        (module) =>
          new module.MacManagedPreferencesPolicyProvider(
            io ?? module.nodePolicyIo,
            brand.appId,
            safeUserName(),
          ),
      ),
    ];
  }
  return [
    onDemand(
      'linux-json',
      (module) =>
        new module.LinuxJsonPolicyProvider(
          io ?? module.nodePolicyIo,
          `/etc/${brand.slug}/policies`,
        ),
    ),
  ];
}

/**
 * A provider that loads the reading code with its first read.
 * @param name - The name of the provider that `create` returns.
 * @param create - Creates the provider from the loaded module.
 */
function onDemand(
  name: string,
  create: (module: typeof Providers) => PolicyProvider,
): PolicyProvider {
  let provider: Promise<PolicyProvider> | undefined;
  return {
    name,
    async load() {
      provider ??= import('./policy-providers.ts').then(create);
      return (await provider).load();
    },
  };
}

function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}
