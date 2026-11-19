import type { App, Certificate, Session, WebContents } from 'electron';

/** A certificate that Chromium did not trust for a host, and why. */
export interface UntrustedCertificate {
  /** The host with its port, such as `device.example:8443`. */
  readonly host: string;
  /** Chromium's name for the error, such as `ERR_CERT_AUTHORITY_INVALID`. */
  readonly error: string;
  readonly certificate: Certificate;
}

/** A certificate that people accepted for a host, and whether the exception still holds. */
export interface AcceptedCertificate extends UntrustedCertificate {
  /**
   * Whether the browser still accepts the certificate: not after people turned the warning
   * back on, or once a policy no longer lets them continue.
   */
  readonly live: boolean;
}

/**
 * Exceptions for certificates that the user accepted after the warning, for the rest of
 * the session. An exception holds for one host and one certificate, by its fingerprint, so
 * a site that shows another certificate later is refused again. It holds only in the
 * session of the page that accepted it, so an exception made in a private window ends with
 * its session and never reaches regular windows. People can turn the warning back on for a
 * host, which ends its exceptions in that session.
 */
export class CertificateExceptions {
  /** The exceptions of each session, by host and fingerprint. */
  private readonly allowed = new WeakMap<Session, Map<string, UntrustedCertificate>>();
  /**
   * The hosts of each session whose pages may have come with an accepted certificate, with the
   * last one accepted; they stay after the exception ended, as such a page may still show.
   */
  private readonly accepted = new WeakMap<Session, Map<string, UntrustedCertificate>>();
  /** The certificate that each page was last refused. */
  private readonly refused = new WeakMap<WebContents, UntrustedCertificate>();
  private readonly mayOverride: () => boolean;

  /** @param mayOverride - Whether a policy lets people continue after the warning. */
  constructor(mayOverride: () => boolean) {
    this.mayOverride = mayOverride;
  }

  /**
   * Accepts the certificates of the exceptions, and remembers which one a page was refused.
   * Certificates of embedded frames are refused without a warning.
   * @param app - The application.
   */
  attach(app: App): void {
    app.on(
      'certificate-error',
      (event, contents, url, error, certificate, callback, isMainFrame) => {
        const host = hostOf(url);
        const key = `${host}|${certificate.fingerprint}`;
        if (this.allowed.get(contents.session)?.has(key) === true && this.mayOverride()) {
          event.preventDefault();
          callback(true);
          return;
        }
        if (isMainFrame) {
          this.refused.set(contents, { host, error: error.replace(/^net::/, ''), certificate });
        }
      },
    );
  }

  /**
   * Accepts, for this session, the certificate that a page was just refused.
   * @param contents - The page.
   * @returns Whether there was such a certificate and a policy allows it.
   */
  allow(contents: WebContents): boolean {
    const refused = this.refused.get(contents);
    if (refused === undefined || !this.mayOverride()) return false;
    mapOf(this.allowed, contents.session).set(keyOf(refused), refused);
    mapOf(this.accepted, contents.session).set(refused.host, refused);
    return true;
  }

  /**
   * Whether a page at an https address may have come with a certificate that the user
   * accepted: the session of the page accepted one for the host of the address. Electron does
   * not tell which certificate a page came with, so every page of the host counts, in any tab
   * of the session, also after a policy took the exceptions away or people turned the warning
   * back on, as the page may have loaded before.
   * @param contents - The page.
   * @param url - The address of the page.
   */
  covers(contents: WebContents, url: string): boolean {
    return /^https:/i.test(url) && this.accepted.get(contents.session)?.has(hostOf(url)) === true;
  }

  /**
   * The certificate that a page was last refused, which its warning is about.
   * @param contents - The page.
   */
  refusedOf(contents: WebContents): UntrustedCertificate | undefined {
    return this.refused.get(contents);
  }

  /**
   * The certificate that people last accepted for the host of a page's address in its session,
   * and whether the browser still accepts it; `undefined` when none was accepted.
   * @param contents - The page.
   * @param url - The address of the page.
   */
  acceptedOf(contents: WebContents, url: string): AcceptedCertificate | undefined {
    if (!/^https:/i.test(url)) return undefined;
    const accepted = this.accepted.get(contents.session)?.get(hostOf(url));
    if (accepted === undefined) return undefined;
    const live =
      this.mayOverride() && this.allowed.get(contents.session)?.has(keyOf(accepted)) === true;
    return { ...accepted, live };
  }

  /**
   * Turns the warning back on for a host in the session of a page: the certificates that people
   * accepted for it are refused again. Pages that came with them still count as covered.
   * @param contents - The page.
   * @param host - The host with its port, as in {@link UntrustedCertificate.host}.
   * @returns Whether the session had an exception for the host.
   */
  revoke(contents: WebContents, host: string): boolean {
    const allowed = this.allowed.get(contents.session);
    let revoked = false;
    for (const [key, certificate] of allowed ?? []) {
      if (certificate.host !== host) continue;
      allowed?.delete(key);
      revoked = true;
    }
    return revoked;
  }

  /**
   * Forgets the exceptions of a session and the certificates that it accepted, such as those of
   * the private session once the last private window closed: Electron keeps every session until
   * the browser quits.
   * @param session - The session that ended.
   */
  forget(session: Session): void {
    this.allowed.delete(session);
    this.accepted.delete(session);
  }
}

/** The map of a session, made with its first entry. */
function mapOf(
  maps: WeakMap<Session, Map<string, UntrustedCertificate>>,
  session: Session,
): Map<string, UntrustedCertificate> {
  let map = maps.get(session);
  if (map === undefined) {
    map = new Map();
    maps.set(session, map);
  }
  return map;
}

/** The key of an exception: the host and the certificate's fingerprint. */
function keyOf(certificate: UntrustedCertificate): string {
  return `${certificate.host}|${certificate.certificate.fingerprint}`;
}

/** The host of an address, with its port. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
