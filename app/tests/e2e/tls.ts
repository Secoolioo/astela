/**
 * A self-signed certificate for the tests of certificate errors, made when a test starts,
 * so no key is stored. It names 127.0.0.1; no browser trusts it.
 */
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

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

/** A key and a certificate for 127.0.0.1, both PEM. */
export function selfSignedCertificate(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = sequence(oid('1.2.840.10045.4.3.2'));
  const name = sequence(set(sequence(oid('2.5.4.3'), der(0x0c, Buffer.from('Astela test')))));
  const day = 24 * 60 * 60 * 1000;
  // A positive serial number whose first byte is not zero, as DER allows no leading zero.
  const serial = randomBytes(8);
  serial[0] = ((serial[0] ?? 0) & 0x3f) | 0x40;
  const altName = sequence(
    oid('2.5.29.17'),
    der(0x04, sequence(der(0x87, Buffer.from([127, 0, 0, 1])))),
  );
  const tbs = sequence(
    der(0xa0, der(0x02, Buffer.from([2]))),
    der(0x02, serial),
    algorithm,
    name,
    sequence(time(new Date(Date.now() - day)), time(new Date(Date.now() + 30 * day))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    der(0xa3, sequence(altName)),
  );
  const signature = sign('sha256', tbs, privateKey);
  const certificate = sequence(
    tbs,
    algorithm,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`,
  };
}
