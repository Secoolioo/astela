import type { Request, Session } from 'electron';
import type { CertificateSummary } from '../../shared/ipc/overlay-contracts.ts';
import { summarize } from './certificate-summary.ts';

/** The most hosts whose certificates the log keeps for each session. */
export const certificateLogLimit = 256;

/**
 * Which check of a host the log answers with: the newest one that Chromium trusted, which a
 * secure page may have come with, or the newest one that it refused, which a warning, or a page
 * that came with a certificate that people accepted, is about.
 */
export type CheckedAs = 'trusted' | 'refused';

/** The newest check of each kind for a host. */
type Checks = Partial<Record<CheckedAs, CertificateSummary>>;

/**
 * The certificates that Chromium checked for the connections of each session, by host, so that
 * site information can show the certificate of a page: Electron does not tell which certificate
 * a page came with (ADR 0059). The log only takes what the session's verify function hands it
 * after Chromium decided; it changes no decision. It keeps the newest trusted and the newest
 * refused check of each host apart, as Chromium tells only the host and not the port: a refused
 * certificate of another port, or of a request that failed, never takes the place of the one
 * that a secure page came with. It keeps them for the {@link certificateLogLimit} hosts used
 * last, and what one session checked never shows in another, so a private window keeps its
 * sites to itself; {@link CertificateLog.forget} drops what a session checked once it ended. A
 * page that came from the cache, or over a connection that was open already, leaves no new
 * check.
 */
export class CertificateLog {
  private readonly sessions = new WeakMap<Session, Map<string, Checks>>();
  private readonly acceptsAll: boolean;

  /**
   * @param acceptsAll - Whether Chromium connects whatever certificate a site shows, as with the
   *   switch `--ignore-certificate-errors`: every check then counts as trusted, as pages load
   *   as secure with it, but still says nothing about the root.
   */
  constructor(acceptsAll = false) {
    this.acceptsAll = acceptsAll;
  }

  /**
   * Notes a certificate that Chromium checked. A certificate that it does not trust keeps no
   * word about its root, as Electron's `isIssuedByKnownRoot` means nothing then.
   * @param session - The session of the connection.
   * @param request - What Chromium checked, and its result.
   */
  record(session: Session, request: Request): void {
    try {
      const host = keyOf(request.hostname);
      const certificate = request.validatedCertificate ?? request.certificate;
      const trusted = request.errorCode === 0;
      const summary = summarize(certificate, trusted ? request.isIssuedByKnownRoot : null);
      let hosts = this.sessions.get(session);
      if (hosts === undefined) {
        hosts = new Map();
        this.sessions.set(session, hosts);
      }
      const checks: Checks = { ...hosts.get(host) };
      checks[trusted || this.acceptsAll ? 'trusted' : 'refused'] = summary;
      // A host that is noted again is the newest one.
      hosts.delete(host);
      hosts.set(host, checks);
      for (const oldest of hosts.keys()) {
        if (hosts.size <= certificateLogLimit) break;
        hosts.delete(oldest);
      }
    } catch {
      // A certificate that cannot be read leaves no note; Chromium has decided already.
    }
  }

  /**
   * The certificate that Chromium last trusted or refused for a host in a session, or
   * `undefined` when it checked none of that kind since the log began, or forgot it among many
   * other hosts.
   * @param session - The session of the page.
   * @param host - The host of the page, without its port.
   * @param kind - Whether the check that Chromium trusted counts, or the one that it refused.
   */
  certificateOf(session: Session, host: string, kind: CheckedAs): CertificateSummary | undefined {
    const hosts = this.sessions.get(session);
    const key = keyOf(host);
    const checks = hosts?.get(key);
    if (hosts !== undefined && checks !== undefined) {
      // A host that site information shows counts as used.
      hosts.delete(key);
      hosts.set(key, checks);
    }
    return checks?.[kind];
  }

  /**
   * Forgets what a session checked, such as the private session once the last private window
   * closed: Electron keeps every session until the browser quits.
   * @param session - The session that ended.
   */
  forget(session: Session): void {
    this.sessions.delete(session);
  }
}

/** A host as the log keeps it: in lower case, an IPv6 address without its brackets. */
function keyOf(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
}
