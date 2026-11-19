import { describe, expect, it } from 'vitest';
import { connectionKind, isLocalHost } from '../connection.ts';

const page = (url: string, certificateException = false, problem: string | null = null) => ({
  url,
  certificateException,
  problem: problem === null ? null : { kind: problem },
});

describe('isLocalHost', () => {
  it('knows the names and loopback addresses of this computer', () => {
    for (const host of ['localhost', 'LOCALHOST', 'app.localhost', 'localhost.', '127.0.0.1']) {
      expect(isLocalHost(host)).toBe(true);
    }
    expect(isLocalHost('127.255.10.2')).toBe(true);
    expect(isLocalHost('[::1]')).toBe(true);
  });

  it('takes no other host for this computer', () => {
    for (const host of [
      'localhost.example',
      'mylocalhost',
      '128.0.0.1',
      '127.0.0',
      '127.0.0.256',
      '10.0.0.1',
      '[::2]',
      '',
    ]) {
      expect(isLocalHost(host)).toBe(false);
    }
  });
});

describe('connectionKind', () => {
  it('tells secure pages from those with a certificate that people accepted', () => {
    expect(connectionKind(page('https://example.org/'))).toBe('secure');
    expect(connectionKind(page('https://example.org/', true))).toBe('insecure');
    // An address of this computer over HTTPS is secure as well.
    expect(connectionKind(page('https://localhost:8443/'))).toBe('secure');
  });

  it('tells pages without encryption from pages on this computer', () => {
    expect(connectionKind(page('http://example.org/'))).toBe('insecure');
    expect(connectionKind(page('http://localhost:3000/'))).toBe('local');
    expect(connectionKind(page('http://dev.localhost/'))).toBe('local');
    expect(connectionKind(page('http://127.0.0.1:8080/a'))).toBe('local');
    expect(connectionKind(page('http://user@127.0.0.1/'))).toBe('local');
    expect(connectionKind(page('http://[::1]:8080/'))).toBe('local');
    expect(connectionKind(page('http://localhost.example/'))).toBe('insecure');
  });

  it("names the browser's own pages and shows nothing for pages without a connection", () => {
    expect(connectionKind(page('app://settings/'))).toBe('internal');
    expect(connectionKind(page('app://newtab/'))).toBe('none');
    expect(connectionKind(page('about:blank'))).toBe('none');
    expect(connectionKind(page('file:///tmp/a.html'))).toBe('none');
    expect(connectionKind(page('data:text/html,hi'))).toBe('none');
  });

  it('says that warnings are not secure and shows nothing for other problems', () => {
    expect(connectionKind(page('https://example.org/', false, 'certificate'))).toBe('insecure');
    expect(connectionKind(page('http://example.org/', false, 'insecure'))).toBe('insecure');
    expect(connectionKind(page('https://example.org/', false, 'error'))).toBe('none');
    expect(connectionKind(page('http://localhost/', false, 'crashed'))).toBe('none');
  });
});
