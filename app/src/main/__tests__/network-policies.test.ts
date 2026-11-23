import type { OnBeforeRequestListenerDetails, Session } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PolicyProvider,
  PolicyReadResult,
  RawPolicyValue,
} from '../../domain/policy/policy.ts';
import { PolicyService } from '../../domain/policy/policy-service.ts';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';

/** The switches of the start, as the command line of the browser process holds them. */
const switches = new Map<string, string>();
const appProxies: unknown[] = [];
const servers: string[] = [];

vi.mock('electron', () => ({
  app: {
    commandLine: {
      hasSwitch: (name: string) => switches.has(name),
      getSwitchValue: (name: string) => switches.get(name) ?? '',
      appendSwitch: (name: string, value: string) => switches.set(name, value),
      removeSwitch: (name: string) => switches.delete(name),
    },
    setProxy: (settings: unknown) => {
      appProxies.push(settings);
      return Promise.resolve();
    },
  },
  session: {
    defaultSession: {
      allowNTLMCredentialsForDomains: (domains: string) => servers.push(domains),
    },
  },
}));

const { networkPolicies, networkRules } = await import('../network-policies.ts');

/** A session of web content that records its proxies and the closes of its connections. */
interface FakeSession {
  readonly proxies: unknown[];
  closed: number;
  readonly session: Session;
}

function fakeSession(): FakeSession {
  const fake = { proxies: [] as unknown[], closed: 0 };
  const session = {
    setProxy: (settings: unknown) => {
      fake.proxies.push(settings);
      return Promise.resolve();
    },
    closeAllConnections: () => {
      fake.closed += 1;
      return Promise.resolve();
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the parts of a session that the rules use
  return Object.assign(fake, { session: session as unknown as Session });
}

/** Policies that a test changes between reads, as mandatory values of the machine. */
class Values implements PolicyProvider {
  readonly name = 'test';
  values: Record<string, unknown> = {};
  load(): Promise<PolicyReadResult> {
    const values: RawPolicyValue[] = Object.entries(this.values).map(([name, value]) => ({
      name,
      value,
      level: 'mandatory',
      scope: 'machine',
      source: 'test',
    }));
    return Promise.resolve({ values, errors: [] });
  }
}

async function started(values: Record<string, unknown>): Promise<{
  provider: Values;
  policies: PolicyService;
  sink: RingBufferLogSink;
  rules: ReturnType<typeof networkRules>;
}> {
  const provider = new Values();
  provider.values = values;
  const sink = new RingBufferLogSink();
  const logger = new SinkLogger(sink, new ManualClock(), { scope: 'main' });
  const policies = new PolicyService([], [provider], { report: () => undefined });
  policies.define(networkPolicies);
  await policies.refresh();
  return { provider, policies, sink, rules: networkRules(policies, logger) };
}

/** A request of a page, of a frame or of a part of a page. */
function request(url: string, resourceType: string): OnBeforeRequestListenerDetails {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the fields that the filter reads
  return { url, resourceType } as OnBeforeRequestListenerDetails;
}

beforeEach(() => {
  switches.clear();
  appProxies.length = 0;
  servers.length = 0;
});

describe('networkRules', () => {
  it('leaves the proxy alone without proxy policies', async () => {
    const { rules, sink } = await started({});
    expect(sink.records).toEqual([]);
    const web = fakeSession();
    rules.protect(web.session);
    expect(web.proxies).toEqual([]);
    expect(appProxies).toEqual([]);
    expect(servers).toEqual([]);
  });

  it('gives every session the proxy of the policies, and the requests without one', async () => {
    const { rules } = await started({
      ProxyMode: 'fixed_servers',
      ProxyServer: 'proxy.example:3128',
      ProxyBypassList: 'localhost',
    });
    const first = fakeSession();
    const later = fakeSession();
    rules.protect(first.session);
    rules.protect(later.session);
    const proxy = {
      mode: 'fixed_servers',
      proxyRules: 'proxy.example:3128',
      proxyBypassRules: 'localhost',
    };
    expect(first.proxies).toEqual([proxy]);
    expect(later.proxies).toEqual([proxy]);
    expect(appProxies).toEqual([proxy]);
  });

  it('applies a change to every session, closes their connections and goes back to the start without policies', async () => {
    switches.set('proxy-server', 'start.example:8080');
    const { rules, provider, policies, sink } = await started({ ProxyMode: 'direct' });
    const web = fakeSession();
    rules.protect(web.session);
    provider.values = { ProxyMode: 'pac_script', ProxyPacUrl: 'https://wpad.example/proxy.pac' };
    await policies.refresh();
    expect(web.proxies.at(-1)).toEqual({
      mode: 'pac_script',
      pacScript: 'https://wpad.example/proxy.pac',
    });
    expect(web.closed).toBe(1);
    provider.values = {};
    await policies.refresh();
    const start = { mode: 'fixed_servers', proxyRules: 'start.example:8080', proxyBypassRules: '' };
    expect(web.proxies.at(-1)).toEqual(start);
    expect(appProxies.at(-1)).toEqual(start);
    expect(web.closed).toBe(2);
    // Each change of what the policies do starts with a record of it, also once they are gone.
    expect(
      sink.records
        .filter((record) => record.message === 'Network policies applied')
        .map((record) => record.fields?.['proxy']),
    ).toEqual(['direct', 'pac_script', 'none']);
    // A read that changes nothing of the proxy sets nothing.
    provider.values = { URLBlocklist: [] };
    await policies.refresh();
    expect(web.proxies).toHaveLength(3);
  });

  it('logs what the proxy policies set but does nothing, once for each change', async () => {
    const { provider, policies, sink } = await started({ ProxyServer: 'proxy.example:3128' });
    const unused = (): unknown[] =>
      sink.records
        .filter((record) => record.message === 'Policy value has no effect')
        .map((record) => record.fields);
    expect(unused()).toEqual([{ name: 'ProxyServer', reason: 'ProxyMode is not set' }]);
    expect(sink.records[0]).toMatchObject({
      message: 'Network policies applied',
      fields: { proxy: 'none', unused: 1, blocklist: 0, allowlist: 0, ignoredEntries: 0 },
    });
    // A read that changes nothing writes nothing.
    await policies.refresh();
    expect(unused()).toHaveLength(1);
    // A change of a list changes what the policies do: the record says so, and the values that
    // do nothing follow it again, as they still hold.
    provider.values = { ProxyServer: 'proxy.example:3128', URLAllowlist: ['a.example'] };
    await policies.refresh();
    expect(unused()).toHaveLength(2);
    provider.values = { ProxyMode: 'direct', ProxyServer: 'proxy.example:3128' };
    await policies.refresh();
    expect(unused().at(-1)).toEqual({
      name: 'ProxyServer',
      reason: 'ProxyMode direct does not use it',
    });
  });

  it('gives the sign-in of the system to the servers of the policy, and back to the start without it', async () => {
    switches.set('auth-server-whitelist', 'start.example');
    const { provider, policies } = await started({ AuthServerAllowlist: '*.example.com' });
    expect(switches.get('auth-server-whitelist')).toBe('*.example.com');
    expect(servers).toEqual(['*.example.com']);
    provider.values = {};
    await policies.refresh();
    expect(switches.get('auth-server-whitelist')).toBe('start.example');
    expect(servers.at(-1)).toBe('start.example');
  });

  it('removes the switch of the servers that no start had', async () => {
    const { provider, policies } = await started({ AuthServerAllowlist: 'intranet.example' });
    provider.values = {};
    await policies.refresh();
    expect(switches.has('auth-server-whitelist')).toBe(false);
    expect(servers).toEqual(['intranet.example', '']);
  });

  it('cancels the pages and frames that the lists block, also after a change of them', async () => {
    const { rules, provider, policies, sink } = await started({
      URLBlocklist: ['blocked.example', 'a b'],
      URLAllowlist: ['open.blocked.example'],
    });
    expect(rules.beforeRequest(request('https://blocked.example/', 'mainFrame'))).toEqual({
      cancel: true,
    });
    expect(rules.beforeRequest(request('https://www.blocked.example/', 'subFrame'))).toEqual({
      cancel: true,
    });
    // The frame of an `<object>` or an `<embed>` is a frame too.
    expect(rules.beforeRequest(request('https://blocked.example/embed', 'object'))).toEqual({
      cancel: true,
    });
    // Other requests of a page, and the exceptions, go on.
    expect(rules.beforeRequest(request('https://blocked.example/a.png', 'image'))).toBeUndefined();
    expect(
      rules.beforeRequest(request('https://open.blocked.example/', 'mainFrame')),
    ).toBeUndefined();
    expect(rules.blocks('https://blocked.example/x')).toBe(true);
    expect(
      sink.records
        .filter((record) => record.message === 'Policy entries ignored')
        .map((record) => record.fields),
    ).toEqual([{ name: 'URLBlocklist', positions: [2], reason: 'not a filter' }]);
    provider.values = {};
    await policies.refresh();
    expect(rules.blocks('https://blocked.example/x')).toBe(false);
  });

  it('writes a record for each change of the lists, with the filters of each that count', async () => {
    const { provider, policies, sink } = await started({ URLBlocklist: ['a.example'] });
    const applied = (): unknown[] =>
      sink.records
        .filter((record) => record.message === 'Network policies applied')
        .map((record) => record.fields);
    expect(applied()).toEqual([
      { proxy: 'none', unused: 0, blocklist: 1, allowlist: 0, ignoredEntries: 0 },
    ]);
    // Another entry in its place counts as a change, though the number stays.
    provider.values = { URLBlocklist: ['b.example'] };
    await policies.refresh();
    provider.values = { URLBlocklist: ['b.example', 'a b'], URLAllowlist: ['open.b.example'] };
    await policies.refresh();
    expect(applied()).toEqual([
      { proxy: 'none', unused: 0, blocklist: 1, allowlist: 0, ignoredEntries: 0 },
      { proxy: 'none', unused: 0, blocklist: 1, allowlist: 0, ignoredEntries: 0 },
      { proxy: 'none', unused: 0, blocklist: 1, allowlist: 1, ignoredEntries: 1 },
    ]);
    // A read that finds the same lists writes nothing.
    await policies.refresh();
    expect(applied()).toHaveLength(3);
  });

  it('reads international host names of the lists as the addresses have them', async () => {
    const { rules } = await started({ URLBlocklist: ['Bücher.example'] });
    expect(rules.blocks('https://www.xn--bcher-kva.example/')).toBe(true);
  });
});
