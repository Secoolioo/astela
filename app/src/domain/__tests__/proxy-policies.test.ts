import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  AuthServerAllowlist,
  ProxyMode,
  ProxyPacUrl,
  proxyOutcome,
  proxyPolicies,
  ProxyServer,
  startProxy,
} from '../network/proxy-policies.ts';

describe('proxyOutcome', () => {
  it('sets no proxy without policies', () => {
    expect(proxyOutcome({})).toEqual({ settings: undefined, unused: [] });
  });

  it.each(['direct', 'system', 'auto_detect'] as const)('sets the mode %s alone', (mode) => {
    expect(proxyOutcome({ mode })).toEqual({ settings: { mode }, unused: [] });
  });

  it('uses the servers and the bypass list of fixed_servers', () => {
    expect(
      proxyOutcome({ mode: 'fixed_servers', server: '127.0.0.1:3128', bypass: 'localhost' }),
    ).toEqual({
      settings: {
        mode: 'fixed_servers',
        proxyRules: '127.0.0.1:3128',
        proxyBypassRules: 'localhost',
      },
      unused: [],
    });
    expect(proxyOutcome({ mode: 'fixed_servers', server: 'http=a:80;https=b:443' })).toEqual({
      settings: {
        mode: 'fixed_servers',
        proxyRules: 'http=a:80;https=b:443',
        proxyBypassRules: '',
      },
      unused: [],
    });
  });

  it('uses the script of pac_script', () => {
    expect(proxyOutcome({ mode: 'pac_script', pacUrl: 'http://wpad.example/proxy.pac' })).toEqual({
      settings: { mode: 'pac_script', pacScript: 'http://wpad.example/proxy.pac' },
      unused: [],
    });
  });

  it('sets no proxy for fixed_servers without a server or pac_script without a script', () => {
    expect(proxyOutcome({ mode: 'fixed_servers', bypass: 'localhost' })).toEqual({
      settings: undefined,
      unused: [
        { policy: 'ProxyMode', reason: 'fixed_servers needs ProxyServer' },
        { policy: 'ProxyBypassList', reason: 'fixed_servers needs ProxyServer' },
      ],
    });
    expect(proxyOutcome({ mode: 'pac_script', server: 'proxy:80' })).toEqual({
      settings: undefined,
      unused: [
        { policy: 'ProxyMode', reason: 'pac_script needs ProxyPacUrl' },
        { policy: 'ProxyServer', reason: 'ProxyMode pac_script does not use it' },
      ],
    });
  });

  it('names the values that a mode does not use, and applies the mode', () => {
    expect(
      proxyOutcome({
        mode: 'direct',
        server: 'proxy:80',
        pacUrl: 'http://wpad.example/proxy.pac',
        bypass: 'localhost',
      }),
    ).toEqual({
      settings: { mode: 'direct' },
      unused: [
        { policy: 'ProxyServer', reason: 'ProxyMode direct does not use it' },
        { policy: 'ProxyPacUrl', reason: 'ProxyMode direct does not use it' },
        { policy: 'ProxyBypassList', reason: 'ProxyMode direct does not use it' },
      ],
    });
    expect(
      proxyOutcome({
        mode: 'fixed_servers',
        server: 'proxy:80',
        pacUrl: 'http://wpad.example/proxy.pac',
      }).unused,
    ).toEqual([{ policy: 'ProxyPacUrl', reason: 'ProxyMode fixed_servers does not use it' }]);
    expect(
      proxyOutcome({
        mode: 'pac_script',
        pacUrl: 'http://wpad.example/proxy.pac',
        bypass: 'localhost',
      }),
    ).toEqual({
      settings: { mode: 'pac_script', pacScript: 'http://wpad.example/proxy.pac' },
      unused: [{ policy: 'ProxyBypassList', reason: 'ProxyMode pac_script does not use it' }],
    });
  });

  it('sets no proxy from the other policies without ProxyMode', () => {
    expect(proxyOutcome({ server: 'proxy:80', bypass: 'localhost' })).toEqual({
      settings: undefined,
      unused: [
        { policy: 'ProxyServer', reason: 'ProxyMode is not set' },
        { policy: 'ProxyBypassList', reason: 'ProxyMode is not set' },
      ],
    });
  });
});

/** The switches of a start, as `startProxy` reads them. */
function switches(values: Readonly<Record<string, string>>): (name: string) => string | undefined {
  return (name) => values[name];
}

describe('startProxy', () => {
  it('gives the proxy of the switches of the start, as Electron reads them', () => {
    expect(startProxy(switches({}))).toEqual({ mode: 'system' });
    expect(startProxy(switches({ 'no-proxy-server': '', 'proxy-server': 'a:1' }))).toEqual({
      mode: 'direct',
    });
    expect(startProxy(switches({ 'proxy-server': 'a:1', 'proxy-bypass-list': 'b' }))).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'a:1',
      proxyBypassRules: 'b',
    });
    expect(startProxy(switches({ 'proxy-pac-url': 'http://wpad/x.pac' }))).toEqual({
      mode: 'pac_script',
      pacScript: 'http://wpad/x.pac',
    });
  });
});

describe('the network policies', () => {
  it('are sensitive, mandatory only and take effect at once', () => {
    for (const policy of [...proxyPolicies, AuthServerAllowlist]) {
      expect(policy.sensitive).toBe(true);
      expect(policy.recommended).toBeUndefined();
      expect(policy.restartRequired).toBeUndefined();
    }
  });

  it('check their values', () => {
    expect(v.safeParse(ProxyMode.schema, 'fixed_servers').success).toBe(true);
    expect(v.safeParse(ProxyMode.schema, 'manual').success).toBe(false);
    expect(v.safeParse(ProxyServer.schema, '').success).toBe(false);
    expect(v.safeParse(ProxyPacUrl.schema, 'https://wpad.example/proxy.pac').success).toBe(true);
    expect(
      v.safeParse(ProxyPacUrl.schema, 'data:application/x-ns-proxy-autoconfig,x').success,
    ).toBe(true);
    expect(v.safeParse(ProxyPacUrl.schema, 'file:///etc/proxy.pac').success).toBe(false);
    expect(v.safeParse(AuthServerAllowlist.schema, '*.example.com,example.org').success).toBe(true);
  });
});
