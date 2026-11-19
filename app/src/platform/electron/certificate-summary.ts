import type { Certificate } from 'electron';
import type { CertificateSummary } from '../../shared/ipc/overlay-contracts.ts';

/** The most authorities that a summary lists between a certificate and its root. */
export const chainLimit = 8;

/** The longest name that a summary keeps. */
const nameLimit = 300;

/**
 * What site information shows of a certificate: whom it was issued to and by, when it is valid,
 * its fingerprint and the authorities that it was issued through, each of them at most once and
 * at most {@link chainLimit}. Electron gives the certificates of the chain as `issuerCert`, and
 * none for a certificate that signed itself.
 * @param certificate - The certificate, as Electron gives it.
 * @param knownRoot - Whether Chromium knows the root of the chain as one that the system trusts
 *   by default; `null` when it did not check the chain or found it not trusted.
 */
export function summarize(certificate: Certificate, knownRoot: boolean | null): CertificateSummary {
  const chain: string[] = [];
  const seen = new Set<string>([certificate.fingerprint]);
  for (
    let issuer = certificate.issuerCert as Certificate | undefined;
    issuer !== undefined && issuer !== null && chain.length < chainLimit;
    issuer = issuer.issuerCert as Certificate | undefined
  ) {
    if (seen.has(issuer.fingerprint)) break;
    seen.add(issuer.fingerprint);
    chain.push(name(issuer.subjectName));
  }
  return {
    subject: name(certificate.subjectName),
    subjectOrganization: name(certificate.subject?.organizations?.[0]),
    issuer: name(certificate.issuerName),
    issuerOrganization: name(certificate.issuer?.organizations?.[0]),
    validFrom: seconds(certificate.validStart),
    validUntil: seconds(certificate.validExpiry),
    fingerprint: /^sha256\/[A-Za-z0-9+/=]{1,93}$/.test(certificate.fingerprint)
      ? certificate.fingerprint
      : '',
    chain,
    knownRoot,
  };
}

/** A name as a summary keeps it, cut to its length. */
function name(text: string | undefined): string {
  return (text ?? '').slice(0, nameLimit);
}

/** A time in whole seconds, or 0 for one that Electron did not give. */
function seconds(value: number | undefined): number {
  return value !== undefined && Number.isSafeInteger(Math.trunc(value)) ? Math.trunc(value) : 0;
}
