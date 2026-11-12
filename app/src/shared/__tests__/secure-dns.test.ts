import { describe, expect, it } from 'vitest';
import {
  areSecureDnsTemplates,
  hostResolverOptions,
  isSecureDnsTemplate,
  secureDnsProviders,
} from '../secure-dns.ts';

describe('hostResolverOptions', () => {
  it('passes the mode and the addresses of the services', () => {
    expect(
      hostResolverOptions('secure', 'https://a.example/dns-query  https://b.example/q{?dns}'),
    ).toEqual({
      secureDnsMode: 'secure',
      secureDnsServers: ['https://a.example/dns-query', 'https://b.example/q{?dns}'],
    });
    expect(hostResolverOptions('automatic', '')).toEqual({
      secureDnsMode: 'automatic',
      secureDnsServers: [],
    });
    expect(hostResolverOptions('off', 'https://a.example/dns-query')).toEqual({
      secureDnsMode: 'off',
      secureDnsServers: [],
    });
  });

  it('falls back to the automatic mode when only DNS over HTTPS has no service', () => {
    expect(hostResolverOptions('secure', ' ')).toEqual({
      secureDnsMode: 'automatic',
      secureDnsServers: [],
    });
  });

  it('accepts the addresses of the providers and refuses others', () => {
    for (const provider of secureDnsProviders) {
      expect(isSecureDnsTemplate(provider.template)).toBe(true);
    }
    expect(areSecureDnsTemplates('')).toBe(true);
    expect(areSecureDnsTemplates(' https://a.example/dns-query  https://b.example/q{?dns} ')).toBe(
      true,
    );
    expect(isSecureDnsTemplate('https://[2001:db8::1]:8443/dns-query{?dns}')).toBe(true);
    expect(isSecureDnsTemplate('https://dns.example/q/{dns}')).toBe(true);
    for (const refused of [
      'http://dns.example/dns-query',
      'dns.example',
      'https://dns.example/"x',
      // Chromium refuses these as templates; they once stopped the browser from starting.
      'https://dns.example/dns-query{?dns',
      'https://{dns}.example/',
      'https://dns.example:99999/',
      'https://dns.example:0/',
      'https://dns.example/q{?dns,other}',
      'https://dns.example/q{?name}',
      'https://user@dns.example/',
      'https:///dns-query',
    ]) {
      expect({ refused, valid: isSecureDnsTemplate(refused) }).toEqual({ refused, valid: false });
    }
    expect(areSecureDnsTemplates('https://a.example/dns-query https://{dns}.example/')).toBe(false);
  });
});
