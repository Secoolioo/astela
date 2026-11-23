import * as v from 'valibot';
import { definePolicy, type PolicyDefinition } from '../policy/policy.ts';
import { URLAllowlist, URLBlocklist } from '../policy/url-filter.ts';

// The policies of the network connection decide where the traffic of every page goes and to
// which servers the sign-in of the system goes, so only the machine's mandatory values count.
// `main/network-policies.ts` applies them while the browser runs; its code loads apart from
// the start, and so do these definitions, which the policy service learns before its first read.

/** How the browser finds its proxy, with Chrome's names for the modes. */
export const proxyModes = [
  'direct',
  'system',
  'auto_detect',
  'fixed_servers',
  'pac_script',
] as const;
/** A mode of {@link ProxyMode}. */
export type ProxyModeName = (typeof proxyModes)[number];

/**
 * `ProxyMode`: `direct` uses no proxy, `system` the settings of the system, `auto_detect`
 * looks for one in the network (WPAD), `fixed_servers` uses those of `ProxyServer` and
 * `pac_script` asks the script at `ProxyPacUrl`.
 */
export const ProxyMode = definePolicy({
  name: 'ProxyMode',
  schema: v.picklist(proxyModes),
  sensitive: true,
});

/** `ProxyServer`: the proxy of `fixed_servers`, in Chromium's format, such as `proxy:8080`. */
export const ProxyServer = definePolicy({
  name: 'ProxyServer',
  schema: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  sensitive: true,
});

/** `ProxyPacUrl`: the address of the proxy script of `pac_script`. */
export const ProxyPacUrl = definePolicy({
  name: 'ProxyPacUrl',
  schema: v.pipe(
    v.string(),
    v.maxLength(8192),
    v.regex(/^(?:https?:\/\/|data:)\S+$/i, 'Must be an http, https or data address'),
  ),
  sensitive: true,
});

/** `ProxyBypassList`: the hosts that `fixed_servers` reaches without the proxy. */
export const ProxyBypassList = definePolicy({
  name: 'ProxyBypassList',
  schema: v.pipe(v.string(), v.maxLength(8192)),
  sensitive: true,
});

/**
 * `AuthServerAllowlist`: the servers that may get the sign-in of the system, with Kerberos or
 * NTLM, such as `*.example.com`; Chromium's comma-separated list.
 */
export const AuthServerAllowlist = definePolicy({
  name: 'AuthServerAllowlist',
  schema: v.pipe(v.string(), v.maxLength(8192)),
  sensitive: true,
});

/** The policies of the proxy, in the order of the reference. */
export const proxyPolicies: readonly PolicyDefinition<unknown>[] = [
  ProxyMode,
  ProxyServer,
  ProxyPacUrl,
  ProxyBypassList,
];

/**
 * The policies of the network: the proxy, the servers that may get the sign-in of the system,
 * and the addresses that pages may not load (`url-filter.ts`).
 */
export const networkPolicies: readonly PolicyDefinition<unknown>[] = [
  ...proxyPolicies,
  AuthServerAllowlist,
  URLBlocklist,
  URLAllowlist,
];

/** The proxy that a session uses, in the fields of Electron's `setProxy`. */
export interface ProxySettings {
  readonly mode: ProxyModeName;
  /** The proxies of `fixed_servers`, such as `proxy:8080`. */
  readonly proxyRules?: string;
  /** The hosts that `fixed_servers` reaches without a proxy, separated by commas. */
  readonly proxyBypassRules?: string;
  /** The address of the proxy script of `pac_script`. */
  readonly pacScript?: string;
}

/** The values of the proxy policies that apply, as the policy service gives them. */
export interface ProxyValues {
  readonly mode?: ProxyModeName | undefined;
  readonly server?: string | undefined;
  readonly pacUrl?: string | undefined;
  readonly bypass?: string | undefined;
}

/** A proxy policy that applies as a value but does nothing with the other values, and why. */
export interface UnusedProxyPolicy {
  readonly policy: string;
  readonly reason: string;
}

/** What the proxy policies make of the proxy of the browser. */
export interface ProxyOutcome {
  /** The proxy of every session, or `undefined` when the policies set none. */
  readonly settings: ProxySettings | undefined;
  /** The values that do nothing, the mode first. */
  readonly unused: readonly UnusedProxyPolicy[];
}

/**
 * The proxy that the policies set, as Chrome reads them: `ProxyMode` decides, and the other
 * policies count only in the modes that use them. `fixed_servers` without `ProxyServer` and
 * `pac_script` without `ProxyPacUrl` set no proxy, and neither do the others without
 * `ProxyMode`; the browser then uses its own settings, as without policies.
 * @param values - The values that apply.
 */
export function proxyOutcome(values: ProxyValues): ProxyOutcome {
  const { mode, server, pacUrl, bypass } = values;
  const unused: UnusedProxyPolicy[] = [];
  const unusedIf = (set: string | undefined, policy: string, reason: string): void => {
    if (set !== undefined) unused.push({ policy, reason });
  };
  if (mode === undefined) {
    for (const [set, policy] of [
      [server, ProxyServer.name],
      [pacUrl, ProxyPacUrl.name],
      [bypass, ProxyBypassList.name],
    ] as const) {
      unusedIf(set, policy, 'ProxyMode is not set');
    }
    return { settings: undefined, unused };
  }
  const notIn = `ProxyMode ${mode} does not use it`;
  if (mode === 'fixed_servers') {
    unusedIf(pacUrl, ProxyPacUrl.name, notIn);
    if (server === undefined) {
      unused.unshift({ policy: ProxyMode.name, reason: 'fixed_servers needs ProxyServer' });
      unusedIf(bypass, ProxyBypassList.name, 'fixed_servers needs ProxyServer');
      return { settings: undefined, unused };
    }
    return {
      settings: { mode, proxyRules: server, proxyBypassRules: bypass ?? '' },
      unused,
    };
  }
  unusedIf(server, ProxyServer.name, notIn);
  if (mode === 'pac_script') {
    unusedIf(bypass, ProxyBypassList.name, notIn);
    if (pacUrl === undefined) {
      unused.unshift({ policy: ProxyMode.name, reason: 'pac_script needs ProxyPacUrl' });
      return { settings: undefined, unused };
    }
    return { settings: { mode, pacScript: pacUrl }, unused };
  }
  unusedIf(pacUrl, ProxyPacUrl.name, notIn);
  unusedIf(bypass, ProxyBypassList.name, notIn);
  return { settings: { mode }, unused };
}

/**
 * The proxy that the switches of the start give the sessions, which the browser goes back to
 * once the policies no longer set one: Electron reads `--no-proxy-server`, `--proxy-server`
 * with `--proxy-bypass-list`, and `--proxy-pac-url`, in this order; without them, the
 * settings of the system.
 * @param switchValue - The value of a switch, or `undefined` when the start has none.
 */
export function startProxy(switchValue: (name: string) => string | undefined): ProxySettings {
  if (switchValue('no-proxy-server') !== undefined) return { mode: 'direct' };
  const server = switchValue('proxy-server');
  if (server !== undefined) {
    return {
      mode: 'fixed_servers',
      proxyRules: server,
      proxyBypassRules: switchValue('proxy-bypass-list') ?? '',
    };
  }
  const pacUrl = switchValue('proxy-pac-url');
  if (pacUrl !== undefined) return { mode: 'pac_script', pacScript: pacUrl };
  return { mode: 'system' };
}
