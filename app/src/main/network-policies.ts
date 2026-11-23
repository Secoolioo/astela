import {
  app,
  session as sessions,
  type App,
  type OnBeforeRequestListenerDetails,
  type Session,
} from 'electron';
import { domainToASCII } from 'node:url';
import {
  AuthServerAllowlist,
  ProxyBypassList,
  ProxyMode,
  ProxyPacUrl,
  proxyOutcome,
  proxyPolicies,
  ProxyServer,
  startProxy,
  type ProxyOutcome,
  type ProxySettings,
} from '../domain/network/proxy-policies.ts';
import type { PolicyService } from '../domain/policy/policy-service.ts';
import {
  URLAllowlist,
  URLBlocklist,
  urlFilters,
  type UrlFilters,
} from '../domain/policy/url-filter.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { RequestDecision, RequestInterceptor } from '../platform/electron/request-pipeline.ts';

export { networkPolicies } from '../domain/network/proxy-policies.ts';

/** Electron's switch for the servers that may get the sign-in of the system. */
const authSwitch = 'auth-server-whitelist';

/** The kinds of requests that load a document: main frames, frames, objects and embeds. */
const frameTypes: ReadonlySet<string> = new Set(['mainFrame', 'subFrame', 'object']);

/** The value of a switch of the start, or `undefined` when the start has none. */
function startSwitch(name: string): string | undefined {
  return app.commandLine.hasSwitch(name) ? app.commandLine.getSwitchValue(name) : undefined;
}

/**
 * What the policies of the network do while the browser runs: the proxy of every session of
 * web content, the servers that may get the sign-in of the system, and the addresses that pages
 * may not load. Without these policies, the browser keeps the proxy and the servers that the
 * system and the switches of its start give it.
 */
export interface NetworkRules extends RequestInterceptor {
  /**
   * Gives a new session of web content the proxy of the policies, before any of its requests.
   * Electron sets a proxy at once; its promise only tells that it did.
   * @param session - The session.
   */
  protect(session: Session): void;
  /**
   * Whether `URLBlocklist` and `URLAllowlist` block an address, as they did a page that could
   * not load for it.
   */
  readonly blocks: (url: string) => boolean;
}

/**
 * Applies the policies of the network now and at every change of them. It loads while Electron
 * starts, with the definitions of these policies, which the policy service learns before its
 * first read, and starts once that read is done, before the first window.
 * @param policies - The policies, read for the start.
 * @param log - The log of the browser; what a policy does not do gets the scope `policy`.
 */
export function networkRules(policies: PolicyService, log: Logger): NetworkRules {
  const logger = log.child('policy');
  const protectedSessions = new Set<Session>();
  // The proxy and the servers of the switches of the start, which come back without policies.
  const startSettings = startProxy(startSwitch);
  const startServers = startSwitch(authSwitch);

  const proxyNow = (): ProxyOutcome =>
    proxyOutcome({
      mode: policies.mandatoryValue(ProxyMode),
      server: policies.mandatoryValue(ProxyServer),
      pacUrl: policies.mandatoryValue(ProxyPacUrl),
      bypass: policies.mandatoryValue(ProxyBypassList),
    });
  const setProxy = (target: Session | App, settings: ProxySettings): Promise<void> =>
    target.setProxy(settings).catch((error: unknown) => {
      logger.warn('The proxy of the policies could not be set', { error: String(error) });
    });
  let proxy = proxyNow();

  // The sign-in of the system goes only to the servers of the policy. Electron gives the list
  // to the network service at once, and reads the switch again when that service starts anew.
  const applyServers = (): void => {
    const servers = policies.mandatoryValue(AuthServerAllowlist) ?? startServers;
    try {
      if (servers === undefined) app.commandLine.removeSwitch(authSwitch);
      else app.commandLine.appendSwitch(authSwitch, servers);
      sessions.defaultSession.allowNTLMCredentialsForDomains(servers ?? '');
    } catch (error: unknown) {
      logger.warn('The servers for the sign-in of the system could not be set', {
        error: String(error),
      });
    }
  };

  const readFilters = (): UrlFilters & { readonly lists: readonly (readonly string[])[] } => {
    const lists = [
      policies.mandatoryValue(URLBlocklist) ?? [],
      policies.mandatoryValue(URLAllowlist) ?? [],
    ] as const;
    return { ...urlFilters(lists[0], lists[1], domainToASCII), lists };
  };
  let filters = readFilters();

  // What the policies of the network do is written once for each change of it, also once they
  // are gone: the proxy that they set, the filters of the lists, and what they set but does
  // nothing, such as a ProxyServer without ProxyMode, so the records after the last `Network
  // policies applied` hold now. A changed entry of a list writes a record too, with the number
  // of filters of each list that count.
  const outcome = (): string =>
    JSON.stringify([proxy.settings, proxy.unused, filters.ignored, filters.lists]);
  let reported = JSON.stringify([undefined, [], [], [[], []]]);
  const report = (): void => {
    if (outcome() === reported) return;
    reported = outcome();
    logger.info('Network policies applied', {
      proxy: proxy.settings?.mode ?? 'none',
      unused: proxy.unused.length,
      blocklist: filters.counts.URLBlocklist,
      allowlist: filters.counts.URLAllowlist,
      ignoredEntries: filters.ignored.reduce((sum, { positions }) => sum + positions.length, 0),
    });
    for (const { policy, reason } of proxy.unused) {
      logger.warn('Policy value has no effect', { name: policy, reason });
    }
    for (const { policy, positions, reason } of filters.ignored) {
      logger.warn('Policy entries ignored', { name: policy, positions, reason });
    }
  };

  if (proxy.settings !== undefined) void setProxy(app, proxy.settings);
  if (policies.mandatoryValue(AuthServerAllowlist) !== undefined) applyServers();
  report();

  const proxyNames = new Set(proxyPolicies.map((policy) => policy.name));
  policies.onDidChange((names) => {
    if (names.includes(AuthServerAllowlist.name)) applyServers();
    if (names.includes(URLBlocklist.name) || names.includes(URLAllowlist.name)) {
      filters = readFilters();
    }
    if (names.some((name) => proxyNames.has(name))) {
      const before = proxy.settings;
      proxy = proxyNow();
      if (JSON.stringify(before) !== JSON.stringify(proxy.settings)) {
        // Without the policies, the sessions go back to the proxy of the start. Connections that
        // are open keep the proxy they were made with, so they close.
        const settings = proxy.settings ?? startSettings;
        for (const s of protectedSessions) {
          void setProxy(s, settings).then(() => s.closeAllConnections());
        }
        void setProxy(app, settings);
      }
    }
    report();
  });

  return {
    protect: (s) => {
      protectedSessions.add(s);
      if (proxy.settings !== undefined) void setProxy(s, proxy.settings);
    },
    blocks: (url) => filters.filter.blocks(url),
    // Pages and frames that the policies block do not load, as with Chrome: main frames, frames
    // and the frames of `<object>` and `<embed>`, which Electron reports as `object`. The other
    // requests of the pages that may load reach the next steps.
    beforeRequest: (details: OnBeforeRequestListenerDetails): RequestDecision | undefined =>
      frameTypes.has(details.resourceType) && filters.filter.blocks(details.url)
        ? { cancel: true }
        : undefined,
  };
}
