import { describe, expect, it } from 'vitest';
import { fingerprintText } from '../ui-kit/fingerprint.ts';

describe('fingerprintText', () => {
  it('writes the hash of a fingerprint as pairs of hexadecimal digits', () => {
    // The SHA-256 hash of an empty input.
    expect(fingerprintText('sha256/47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')).toBe(
      'E3:B0:C4:42:98:FC:1C:14:9A:FB:F4:C8:99:6F:B9:24:27:AE:41:E4:64:9B:93:4C:A4:95:99:1B:78:52:B8:55',
    );
  });

  it('gives nothing for a fingerprint that is not one of SHA-256 in Base64', () => {
    expect(fingerprintText('')).toBe('');
    expect(fingerprintText('sha1/AAAA')).toBe('');
    expect(fingerprintText('sha256/not base64!')).toBe('');
    expect(fingerprintText('sha256/A')).toBe('');
  });
});
