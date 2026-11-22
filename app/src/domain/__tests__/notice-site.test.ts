import { describe, expect, it } from 'vitest';
import { noticeSite, noticeSiteLength } from '../page-tools/notice-site.ts';

describe('noticeSite', () => {
  it('names the host of a page of the web, with a port that is not the usual one', () => {
    expect(noticeSite('https://video.example')).toBe('video.example');
    expect(noticeSite('http://127.0.0.1:8080')).toBe('127.0.0.1:8080');
    expect(noticeSite('http://[::1]:3000')).toBe('[::1]:3000');
  });

  it('names no site for an opaque origin or a page that is not of the web', () => {
    expect(noticeSite('null')).toBeUndefined();
    expect(noticeSite('file://')).toBeUndefined();
    expect(noticeSite('app://settings')).toBeUndefined();
    expect(noticeSite('')).toBeUndefined();
  });

  it('keeps the end of a long host, which names the site that owns it', () => {
    const host = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(40)}.evil.example`;
    const site = noticeSite(`https://${host}`);
    expect(site).toHaveLength(noticeSiteLength);
    expect(site?.startsWith('…')).toBe(true);
    expect(host.endsWith(site?.slice(1) ?? '-')).toBe(true);
    expect(site?.endsWith('.evil.example')).toBe(true);
    const long = `${'x'.repeat(30)}.${'y'.repeat(30)}.example`;
    expect(noticeSite(`http://${long}:8443`)).toBe(
      `…${`${long}:8443`.slice(1 - noticeSiteLength)}`,
    );
  });
});
