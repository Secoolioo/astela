/**
 * A SHA-256 fingerprint of a certificate as people compare it: pairs of hexadecimal digits in
 * upper case, separated by colons, such as `3A:F0:…`. Electron writes it as `sha256/` and the
 * Base64 of the hash; anything else gives an empty text.
 * @param fingerprint - The fingerprint, as Electron writes it.
 */
export function fingerprintText(fingerprint: string): string {
  const base64 = /^sha256\/([A-Za-z0-9+/]+={0,2})$/.exec(fingerprint)?.[1];
  if (base64 === undefined) return '';
  let bytes: string;
  try {
    bytes = atob(base64);
  } catch {
    return '';
  }
  const pairs: string[] = [];
  for (let index = 0; index < bytes.length; index++) {
    pairs.push(bytes.charCodeAt(index).toString(16).padStart(2, '0').toUpperCase());
  }
  return pairs.join(':');
}
