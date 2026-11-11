import { describe, expect, it } from 'vitest';
import { allowlistHas, httpsUpgradeOf } from '../navigation/https-first.ts';

describe('httpsUpgradeOf', () => {
  it('gives the secure address of a public site', () => {
    expect(httpsUpgradeOf('http://example.org/path?q=1#top')).toBe(
      'https://example.org/path?q=1#top',
    );
    expect(httpsUpgradeOf('http://www.example.com:80/')).toBe('https://www.example.com/');
  });

  it.each([
    'https://example.org/',
    'ftp://example.org/',
    'http://example.org:8080/',
    'http://127.0.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://localhost/',
    'http://router/',
    'http://printer.local/',
    'http://app.localhost/',
    'http://nas.home.arpa/',
    'http://site.test/',
    'not an address',
  ])('leaves %s alone', (address) => {
    expect(httpsUpgradeOf(address)).toBeUndefined();
  });

  it('leaves the hosts of the allowlist alone', () => {
    const allowlist = ['intranet.example.org', '[*.]corp.example.net', '*.lab.example.com'];
    expect(httpsUpgradeOf('http://intranet.example.org/', allowlist)).toBeUndefined();
    expect(httpsUpgradeOf('http://wiki.intranet.example.org/', allowlist)).toBe(
      'https://wiki.intranet.example.org/',
    );
    expect(httpsUpgradeOf('http://corp.example.net/', allowlist)).toBeUndefined();
    expect(httpsUpgradeOf('http://a.b.corp.example.net/', allowlist)).toBeUndefined();
    expect(httpsUpgradeOf('http://lab.example.com/', allowlist)).toBeUndefined();
    expect(httpsUpgradeOf('http://notcorp.example.net/', allowlist)).toBe(
      'https://notcorp.example.net/',
    );
  });

  it('finds hosts in the allowlist without regard to case', () => {
    expect(allowlistHas([' Intranet.Example.org '], 'intranet.example.org')).toBe(true);
    expect(allowlistHas(['[*.]'], 'example.org')).toBe(false);
    expect(allowlistHas([], 'example.org')).toBe(false);
  });
});
