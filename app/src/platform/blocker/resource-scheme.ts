/**
 * The scheme of the replacement resources that `$redirect` filters serve. A script that is
 * redirected to a `data:` address does not run in Chromium, so the resources come from a
 * privileged scheme of their own, on web sessions only.
 */
export const resourceScheme = 'astela-resource';

/** A replacement resource; the body is Base64 when the content type ends in `;base64`. */
export interface ReplacementResource {
  readonly body: string;
  readonly contentType: string;
}
