import { describe, expect, it } from 'vitest';
import {
  hostResolverOptions,
  secureDnsProviders,
  secureDnsTemplatesPattern,
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
      expect(secureDnsTemplatesPattern.test(provider.template)).toBe(true);
    }
    expect(secureDnsTemplatesPattern.test('')).toBe(true);
    expect(secureDnsTemplatesPattern.test('http://dns.example/dns-query')).toBe(false);
    expect(secureDnsTemplatesPattern.test('dns.example')).toBe(false);
    expect(secureDnsTemplatesPattern.test('https://dns.example/"x')).toBe(false);
  });
});
