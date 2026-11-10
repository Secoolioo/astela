import { X509Certificate } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { selfSignedCertificate } from './tls.ts';

test('makes test certificates that parse, whatever serial number they draw', () => {
  // About one random serial number in 256 began with a zero byte, which DER does not allow.
  for (let count = 0; count < 2000; count++) {
    const { cert } = selfSignedCertificate();
    expect(() => new X509Certificate(cert)).not.toThrow();
  }
});
