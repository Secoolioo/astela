/**
 * Certificates for the tests of certificates, made when a test starts, so no key is stored.
 * They name 127.0.0.1; no browser trusts them.
 */
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

const der = (tag: number, body: Buffer): Buffer => {
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : body.length < 0x100
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const sequence = (...items: Buffer[]): Buffer => der(0x30, Buffer.concat(items));
const set = (...items: Buffer[]): Buffer => der(0x31, Buffer.concat(items));
const oid = (dotted: string): Buffer => {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const part of rest) {
    const chunk: number[] = [];
    let value = part;
    do {
      chunk.unshift((value & 0x7f) | (chunk.length === 0 ? 0 : 0x80));
      value >>= 7;
    } while (value > 0);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
};
const time = (date: Date): Buffer =>
  der(0x17, Buffer.from(`${date.toISOString().slice(2, 19).replace(/[-:T]/g, '')}Z`));
const nameOf = (common: string): Buffer =>
  sequence(set(sequence(oid('2.5.4.3'), der(0x0c, Buffer.from(common)))));
const extension = (id: string, value: Buffer, critical = false): Buffer =>
  sequence(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
const pemOf = (certificate: Buffer): string => {
  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
};

/** The name 127.0.0.1, as the certificate of a site names it. */
const loopbackName = extension('2.5.29.17', sequence(der(0x87, Buffer.from([127, 0, 0, 1]))));
/** What the certificate of an authority says of itself: it may issue certificates. */
const authorityExtensions = [
  extension('2.5.29.19', sequence(der(0x01, Buffer.from([0xff]))), true),
  extension('2.5.29.15', der(0x03, Buffer.from([0x01, 0x06])), true),
];

/** A certificate for a key, issued and signed by the issuer given, as DER. */
function issue(options: {
  readonly subject: string;
  readonly publicKey: KeyObject;
  readonly issuer: string;
  readonly issuerKey: KeyObject;
  readonly extensions: readonly Buffer[];
}): Buffer {
  const algorithm = sequence(oid('1.2.840.10045.4.3.2'));
  const day = 24 * 60 * 60 * 1000;
  // A positive serial number whose first byte is not zero, as DER allows no leading zero.
  const serial = randomBytes(8);
  serial[0] = ((serial[0] ?? 0) & 0x3f) | 0x40;
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    algorithm,
    nameOf(options.issuer),
    sequence(time(new Date(Date.now() - day)), time(new Date(Date.now() + 30 * day))),
    nameOf(options.subject),
    options.publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, sequence(...options.extensions)),
  );
  const signature = sign('sha256', tbs, options.issuerKey);
  return sequence(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
}

const keyPair = (): { privateKey: KeyObject; publicKey: KeyObject } =>
  generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

/**
 * A key and a certificate for 127.0.0.1 that signed itself, both PEM.
 * @param name - Whom it is issued to and by.
 */
export function selfSignedCertificate(name = 'Astela test'): { key: string; cert: string } {
  const { privateKey, publicKey } = keyPair();
  const certificate = issue({
    subject: name,
    publicKey,
    issuer: name,
    issuerKey: privateKey,
    extensions: [loopbackName],
  });
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: pemOf(certificate),
  };
}

/**
 * A key and a certificate for 127.0.0.1 that an authority issued, which a root issued in turn,
 * as a server sends them: `cert` holds the certificate of the site and that of the authority.
 * The root stays out, as servers leave it out. All of them PEM.
 */
export function certificateChain(): {
  key: string;
  cert: string;
  leaf: string;
  intermediate: string;
} {
  const root = keyPair();
  const authority = keyPair();
  const site = keyPair();
  const intermediate = pemOf(
    issue({
      subject: 'Astela test authority',
      publicKey: authority.publicKey,
      issuer: 'Astela test root',
      issuerKey: root.privateKey,
      extensions: authorityExtensions,
    }),
  );
  const leaf = pemOf(
    issue({
      subject: 'Astela test site',
      publicKey: site.publicKey,
      issuer: 'Astela test authority',
      issuerKey: authority.privateKey,
      extensions: [loopbackName],
    }),
  );
  return {
    key: site.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: leaf + intermediate,
    leaf,
    intermediate,
  };
}
