import { describe, expect, it } from 'vitest';
import type { SitePermissions } from '../permissions/site-permissions.ts';
import {
  certificateReason,
  connectionOf,
  cookieAddress,
  cookieOfSite,
  decisionsOf,
  permissionRows,
  resetPermissions,
  sameSite,
  setPermission,
  type ConnectionState,
} from '../site-info/site-info.ts';

const state = (url: string, changes: Partial<ConnectionState> = {}): ConnectionState => ({
  url,
  problem: null,
  covered: false,
  accepted: false,
  httpAllowed: false,
  ...changes,
});

describe('connectionOf', () => {
  it('tells each of the six connections', () => {
    expect(connectionOf(state('https://example.org/'))).toBe('secure');
    expect(connectionOf(state('http://example.org/'))).toBe('insecure');
    expect(connectionOf(state('http://127.0.0.1:8080/'))).toBe('local');
    expect(connectionOf(state('https://example.org/', { problem: { kind: 'certificate' } }))).toBe(
      'certificate',
    );
    expect(connectionOf(state('https://example.org/', { covered: true, accepted: true }))).toBe(
      'accepted',
    );
    expect(connectionOf(state('http://example.org/', { httpAllowed: true }))).toBe('allowed-http');
  });

  it('keeps a page that came with an accepted certificate untrusted once the warning is back', () => {
    expect(connectionOf(state('https://example.org/', { covered: true }))).toBe('certificate');
  });

  it('calls the warning of HTTPS-First not secure, also for a site opened insecurely before', () => {
    expect(
      connectionOf(
        state('https://example.org/', { problem: { kind: 'insecure' }, httpAllowed: true }),
      ),
    ).toBe('insecure');
  });

  it('has nothing for pages without a connection and pages that did not load', () => {
    expect(connectionOf(state('app://settings/'))).toBeUndefined();
    expect(connectionOf(state('app://newtab/'))).toBeUndefined();
    expect(connectionOf(state('about:blank'))).toBeUndefined();
    expect(
      connectionOf(state('https://example.org/', { problem: { kind: 'error' } })),
    ).toBeUndefined();
    expect(
      connectionOf(state('https://example.org/', { problem: { kind: 'crashed' } })),
    ).toBeUndefined();
  });
});

describe('certificateReason', () => {
  it('names the authority, the date and the name, and every other error as other', () => {
    expect(certificateReason('ERR_CERT_AUTHORITY_INVALID')).toBe('authority');
    expect(certificateReason('net::ERR_CERT_DATE_INVALID')).toBe('date');
    expect(certificateReason('ERR_CERT_COMMON_NAME_INVALID')).toBe('name');
    expect(certificateReason('ERR_CERT_REVOKED')).toBe('other');
    expect(certificateReason('')).toBe('other');
  });
});

describe('permissions of a site', () => {
  const origin = 'https://meet.example';
  const sites: SitePermissions = {
    [origin]: { notifications: 'block', camera: 'allow' },
    'https://other.example': { microphone: 'allow' },
  };

  it('lists the decided permissions in the order of the prompts', () => {
    expect(permissionRows(decisionsOf(sites, origin))).toEqual([
      { name: 'camera', allowed: true },
      { name: 'notifications', allowed: false },
    ]);
    expect(permissionRows(decisionsOf(sites, 'https://new.example'))).toEqual([]);
    expect(decisionsOf(sites, 'toString')).toBeUndefined();
  });

  it('changes a decided permission of one site and decides nothing new', () => {
    const changed = setPermission(sites, origin, 'camera', false);
    expect(changed[origin]).toEqual({ notifications: 'block', camera: 'block' });
    expect(changed['https://other.example']).toEqual({ microphone: 'allow' });
    expect(setPermission(changed, origin, 'notifications', true)[origin]).toEqual({
      notifications: 'allow',
      camera: 'block',
    });
    expect(setPermission(sites, origin, 'location', true)).toBe(sites);
    expect(setPermission(sites, 'https://new.example', 'camera', true)).toBe(sites);
  });

  it('forgets every decision of one site', () => {
    expect(resetPermissions(sites, origin)).toEqual({
      'https://other.example': { microphone: 'allow' },
    });
    expect(resetPermissions(sites, 'https://new.example')).toBe(sites);
  });
});

describe('cookies of a site', () => {
  it('counts the cookies of the site and of its hosts, and no others', () => {
    expect(cookieOfSite('example.com', 'example.com')).toBe(true);
    expect(cookieOfSite('.example.com', 'example.com')).toBe(true);
    expect(cookieOfSite('www.Example.com', 'example.com')).toBe(true);
    expect(cookieOfSite('notexample.com', 'example.com')).toBe(false);
    expect(cookieOfSite('example.com.evil', 'example.com')).toBe(false);
    expect(cookieOfSite('127.0.0.1', '127.0.0.1')).toBe(true);
    expect(cookieOfSite('other.test', '127.0.0.1')).toBe(false);
  });

  it('deletes a cookie at an address that it would be sent to', () => {
    expect(cookieAddress({ domain: '.example.com', path: '/', secure: true })).toBe(
      'https://example.com/',
    );
    expect(cookieAddress({ domain: 'www.example.com', path: '/app', secure: false })).toBe(
      'http://www.example.com/app',
    );
    expect(cookieAddress({ domain: '127.0.0.1' })).toBe('http://127.0.0.1/');
  });
});

describe('sameSite', () => {
  it('acts only for the tab and the origin that site information opened for', () => {
    const shown = { tab: 't1', origin: 'https://a.example' };
    expect(sameSite(shown, { tab: 't1', origin: 'https://a.example' })).toBe(true);
    expect(sameSite(shown, { tab: 't1', origin: 'https://b.example' })).toBe(false);
    expect(sameSite(shown, { tab: 't2', origin: 'https://a.example' })).toBe(false);
    expect(sameSite(shown, { tab: undefined, origin: undefined })).toBe(false);
  });
});
