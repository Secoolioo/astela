import type { Certificate, Request, Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CertificateLog, certificateLogLimit } from '../electron/certificate-log.ts';
import { chainLimit, summarize } from '../electron/certificate-summary.ts';
import { answerWithChromium } from '../electron/certificate-verify.ts';

/** A certificate as Electron gives it, signed by the issuer given. */
function certificate(name: string, issuer?: Certificate): Certificate {
  return {
    data: '',
    fingerprint: `sha256/${btoa(name).replace(/=+$/, '')}=`,
    issuer: { commonName: issuer?.subjectName ?? name, organizations: [`${name} issuer org`] },
    issuerCert: issuer,
    issuerName: issuer?.subjectName ?? name,
    serialNumber: '01',
    subject: { commonName: name, organizations: [`${name} org`] },
    subjectName: name,
    validExpiry: 1_900_000_000,
    validStart: 1_700_000_000,
  } as unknown as Certificate;
}

/** What Chromium checked for a host. */
function checked(hostname: string, cert: Certificate, errorCode = 0, knownRoot = true): Request {
  return {
    hostname,
    certificate: cert,
    validatedCertificate: cert,
    isIssuedByKnownRoot: knownRoot,
    verificationResult: errorCode === 0 ? 'net::OK' : 'net::ERR_CERT_AUTHORITY_INVALID',
    errorCode,
  };
}

/** A session whose verify function the test calls as Chromium would. */
function fakeSession(): {
  session: Session;
  verify: (request: Request) => number[];
} {
  let proc: ((request: Request, callback: (result: number) => void) => void) | undefined;
  const session = {
    setCertificateVerifyProc: (set: typeof proc) => (proc = set),
  } as unknown as Session;
  return {
    session,
    verify: (request) => {
      const answers: number[] = [];
      proc?.(request, (result) => answers.push(result));
      return answers;
    },
  };
}

describe('answerWithChromium', () => {
  it('keeps the result of Chromium at once and only then takes a note', () => {
    let proc: ((request: Request, callback: (result: number) => void) => void) | undefined;
    const session = {
      setCertificateVerifyProc: (set: typeof proc) => (proc = set),
    } as unknown as Session;
    const order: string[] = [];
    answerWithChromium(session, (request) => order.push(`note ${request.hostname}`));
    proc?.(checked('a.example', certificate('a.example', certificate('Root'))), (result) =>
      order.push(`answer ${String(result)}`),
    );
    expect(order).toEqual(['answer -3', 'note a.example']);
  });

  it('answers -3 once, synchronously, also when the note throws', () => {
    const { session, verify } = fakeSession();
    const note = vi.fn(() => {
      throw new Error('broken');
    });
    answerWithChromium(session, note);
    expect(verify(checked('a.example', certificate('a.example'), -202))).toEqual([-3]);
    expect(note).toHaveBeenCalledOnce();
  });
});

describe('summarize', () => {
  it('names the certificate, its issuer, its dates, its fingerprint and its chain', () => {
    const root = certificate('Root');
    const intermediate = certificate('Intermediate', root);
    const leaf = certificate('www.example', intermediate);
    expect(summarize(leaf, true)).toEqual({
      subject: 'www.example',
      subjectOrganization: 'www.example org',
      issuer: 'Intermediate',
      issuerOrganization: 'www.example issuer org',
      validFrom: 1_700_000_000,
      validUntil: 1_900_000_000,
      fingerprint: leaf.fingerprint,
      chain: ['Intermediate', 'Root'],
      knownRoot: true,
    });
  });

  it('keeps a long chain, a loop and long names within their limits', () => {
    let issuer = certificate('Root');
    for (let level = 0; level < 20; level++) issuer = certificate(`Level ${String(level)}`, issuer);
    const leaf = certificate('x'.repeat(1000), issuer);
    const summary = summarize(leaf, null);
    expect(summary.chain).toHaveLength(chainLimit);
    expect(summary.subject).toHaveLength(300);
    expect(summary.knownRoot).toBeNull();
    const looped = certificate('Loop');
    (looped as { issuerCert: Certificate }).issuerCert = looped;
    expect(summarize(looped, null).chain).toEqual([]);
  });

  it('leaves out what Electron did not give', () => {
    const bare = { fingerprint: 'not a fingerprint' } as unknown as Certificate;
    expect(summarize(bare, null)).toEqual({
      subject: '',
      subjectOrganization: '',
      issuer: '',
      issuerOrganization: '',
      validFrom: 0,
      validUntil: 0,
      fingerprint: '',
      chain: [],
      knownRoot: null,
    });
  });
});

describe('CertificateLog', () => {
  it('notes the newest check of each host, with its root only when Chromium trusted it', () => {
    const log = new CertificateLog();
    const session = {} as Session;
    log.record(session, checked('WWW.example', certificate('first'), 0, false));
    expect(log.certificateOf(session, 'www.example', 'trusted')).toMatchObject({
      subject: 'first',
      knownRoot: false,
    });
    log.record(session, checked('www.example', certificate('second')));
    expect(log.certificateOf(session, 'WWW.EXAMPLE', 'trusted')).toMatchObject({
      subject: 'second',
      knownRoot: true,
    });
    log.record(session, checked('www.example', certificate('refused'), -202, false));
    expect(log.certificateOf(session, 'www.example', 'refused')).toMatchObject({
      subject: 'refused',
      knownRoot: null,
    });
    log.record(session, checked('::1', certificate('loopback')));
    expect(log.certificateOf(session, '[::1]', 'trusted')).toMatchObject({ subject: 'loopback' });
    expect(log.certificateOf(session, 'other.example', 'trusted')).toBeUndefined();
  });

  it('keeps the check that Chromium trusted when it refuses another certificate of the host', () => {
    const log = new CertificateLog();
    const session = {} as Session;
    // The page of the host came with a trusted certificate; a connection to another port of
    // the host, or a request that failed, showed one that Chromium refused.
    log.record(session, checked('nas.example', certificate('trusted')));
    log.record(session, checked('nas.example', certificate('self-signed'), -202, false));
    expect(log.certificateOf(session, 'nas.example', 'trusted')).toMatchObject({
      subject: 'trusted',
    });
    expect(log.certificateOf(session, 'nas.example', 'refused')).toMatchObject({
      subject: 'self-signed',
    });
    // A host with only a refused certificate has no trusted one.
    log.record(session, checked('other.example', certificate('self-signed'), -202));
    expect(log.certificateOf(session, 'other.example', 'trusted')).toBeUndefined();
  });

  it('counts every check as trusted when Chromium connects whatever certificate it gets', () => {
    const log = new CertificateLog(true);
    const session = {} as Session;
    log.record(session, checked('test.example', certificate('test'), -202, false));
    expect(log.certificateOf(session, 'test.example', 'trusted')).toMatchObject({
      subject: 'test',
      knownRoot: null,
    });
    expect(log.certificateOf(session, 'test.example', 'refused')).toBeUndefined();
  });

  it('forgets what a session checked once it ended', () => {
    const log = new CertificateLog();
    const ended = {} as Session;
    const other = {} as Session;
    log.record(ended, checked('private.example', certificate('private.example')));
    log.record(ended, checked('private.example', certificate('refused'), -202));
    log.record(other, checked('kept.example', certificate('kept.example')));
    log.forget(ended);
    expect(log.certificateOf(ended, 'private.example', 'trusted')).toBeUndefined();
    expect(log.certificateOf(ended, 'private.example', 'refused')).toBeUndefined();
    expect(log.certificateOf(other, 'kept.example', 'trusted')).toBeDefined();
  });

  it('keeps the sessions apart', () => {
    const log = new CertificateLog();
    const regular = {} as Session;
    const privateSession = {} as Session;
    log.record(privateSession, checked('secret.example', certificate('secret.example')));
    expect(log.certificateOf(regular, 'secret.example', 'trusted')).toBeUndefined();
    expect(log.certificateOf(privateSession, 'secret.example', 'trusted')).toMatchObject({
      subject: 'secret.example',
    });
  });

  it('keeps the hosts used last, at most the limit for each session', () => {
    const log = new CertificateLog();
    const session = {} as Session;
    log.record(session, checked('first.example', certificate('first.example')));
    for (let index = 0; index < certificateLogLimit; index++) {
      log.record(session, checked(`host${String(index)}.example`, certificate('host')));
      // Showing the first host keeps it among the ones used last.
      if (index === certificateLogLimit - 2) log.certificateOf(session, 'first.example', 'trusted');
    }
    expect(log.certificateOf(session, 'first.example', 'trusted')).toBeDefined();
    expect(log.certificateOf(session, 'host0.example', 'trusted')).toBeUndefined();
    expect(log.certificateOf(session, 'host1.example', 'trusted')).toBeDefined();
    expect(
      log.certificateOf(session, `host${String(certificateLogLimit - 1)}.example`, 'trusted'),
    ).toBeDefined();
  });

  it('notes nothing about a check that it cannot read, and throws nothing', () => {
    const log = new CertificateLog();
    const session = {} as Session;
    expect(() =>
      log.record(session, { hostname: 'a.example' } as unknown as Request),
    ).not.toThrow();
    expect(log.certificateOf(session, 'a.example', 'trusted')).toBeUndefined();
    expect(log.certificateOf(session, 'a.example', 'refused')).toBeUndefined();
  });
});
