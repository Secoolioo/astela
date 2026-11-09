import * as v from 'valibot';
import { definePolicy } from '../policy/policy.ts';

/**
 * Whether people may continue to a site whose certificate is not trusted, after the
 * warning; `false` leaves them only the way back.
 */
export const SSLErrorOverrideAllowed = definePolicy({
  name: 'SSLErrorOverrideAllowed',
  schema: v.boolean(),
});

/**
 * Whether a network error of Chromium is about the certificate of the site, such as
 * `-202` for an authority that is not trusted.
 * @param code - The error code of a failed load.
 */
export function isCertificateError(code: number): boolean {
  return code <= -200 && code > -300;
}
