import type { App, WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { CertificateExceptions } from '../electron/certificates.ts';

/** Sends a certificate error as Chromium does and tells whether the browser accepted it. */
function refuse(
  app: EventEmitter,
  contents: { id: number },
  url: string,
  fingerprint: string,
  isMainFrame = true,
): boolean {
  const callback = vi.fn();
  const event = { preventDefault: vi.fn() };
  app.emit(
    'certificate-error',
    event,
    contents,
    url,
    'net::ERR_CERT_AUTHORITY_INVALID',
    { fingerprint },
    callback,
    isMainFrame,
  );
  return event.preventDefault.mock.calls.length === 1 && callback.mock.calls[0]?.[0] === true;
}

describe('CertificateExceptions', () => {
  it('accepts a certificate for its host once the user continued, and no other', () => {
    const app = new EventEmitter();
    const exceptions = new CertificateExceptions(() => true);
    exceptions.attach(app as unknown as App);
    const page = { id: 7, session: {} } as unknown as WebContents;
    expect(exceptions.allow(page)).toBe(false);
    expect(refuse(app, page, 'https://device.example/a', 'sha256/one')).toBe(false);
    expect(exceptions.allow(page)).toBe(true);
    expect(refuse(app, page, 'https://device.example/b', 'sha256/one')).toBe(true);
    // Another certificate of the host, or the same one on another host, is refused again.
    expect(refuse(app, page, 'https://device.example/', 'sha256/two')).toBe(false);
    expect(refuse(app, page, 'https://other.example/', 'sha256/one')).toBe(false);
  });

  it('does not remember the certificates of embedded frames', () => {
    const app = new EventEmitter();
    const exceptions = new CertificateExceptions(() => true);
    exceptions.attach(app as unknown as App);
    const page = { id: 8, session: {} } as unknown as WebContents;
    expect(refuse(app, page, 'https://frame.example/', 'sha256/one', false)).toBe(false);
    expect(exceptions.allow(page)).toBe(false);
  });

  it('keeps an accepted certificate to the session of the page that accepted it', () => {
    const app = new EventEmitter();
    const exceptions = new CertificateExceptions(() => true);
    exceptions.attach(app as unknown as App);
    const privatePage = { id: 10, session: {} } as unknown as WebContents;
    const regular = { id: 11, session: {} } as unknown as WebContents;
    refuse(app, privatePage, 'https://intranet.example/', 'sha256/one');
    expect(exceptions.allow(privatePage)).toBe(true);
    expect(refuse(app, privatePage, 'https://intranet.example/x', 'sha256/one')).toBe(true);
    // An exception of a private window does not reach regular windows.
    expect(refuse(app, regular, 'https://intranet.example/', 'sha256/one')).toBe(false);
  });

  it('tells which pages may have come with a certificate that the user accepted', () => {
    const app = new EventEmitter();
    let allowed = true;
    const exceptions = new CertificateExceptions(() => allowed);
    exceptions.attach(app as unknown as App);
    const session = {};
    const page = { id: 12, session } as unknown as WebContents;
    const otherTab = { id: 13, session } as unknown as WebContents;
    const privatePage = { id: 14, session: {} } as unknown as WebContents;
    refuse(app, page, 'https://device.example/', 'sha256/one');
    // A refused certificate that the user did not accept loads no page.
    expect(exceptions.covers(page, 'https://device.example/')).toBe(false);
    expect(exceptions.allow(page)).toBe(true);
    expect(exceptions.covers(page, 'https://device.example/')).toBe(true);
    // Every page of the host in the session counts, in any tab, also after a policy took the
    // exceptions away, because a page may have loaded before.
    expect(exceptions.covers(otherTab, 'https://DEVICE.example/inbox?id=1')).toBe(true);
    allowed = false;
    expect(exceptions.covers(page, 'https://device.example/')).toBe(true);
    // Other hosts and ports, insecure addresses and other sessions do not.
    expect(exceptions.covers(page, 'https://other.example/')).toBe(false);
    expect(exceptions.covers(page, 'https://device.example.net/')).toBe(false);
    expect(exceptions.covers(page, 'https://sub.device.example/')).toBe(false);
    expect(exceptions.covers(page, 'https://device.example:8443/')).toBe(false);
    expect(exceptions.covers(page, 'http://device.example/')).toBe(false);
    expect(exceptions.covers(privatePage, 'https://device.example/')).toBe(false);
  });

  it('accepts nothing when a policy does not allow continuing', () => {
    const app = new EventEmitter();
    let allowed = true;
    const exceptions = new CertificateExceptions(() => allowed);
    exceptions.attach(app as unknown as App);
    const page = { id: 9, session: {} } as unknown as WebContents;
    refuse(app, page, 'https://device.example/', 'sha256/one');
    expect(exceptions.allow(page)).toBe(true);
    allowed = false;
    expect(refuse(app, page, 'https://device.example/', 'sha256/one')).toBe(false);
    expect(exceptions.allow(page)).toBe(false);
  });
});
