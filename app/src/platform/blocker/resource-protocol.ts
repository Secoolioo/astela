import type { Session } from 'electron';

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

/**
 * The address under which a resource is served.
 * @param name - The resource's file name.
 */
export function resourceUrl(name: string): string {
  return `${resourceScheme}://resource/${encodeURIComponent(name)}`;
}

/**
 * Serves the replacement resources on a web session. Every page may load them, because a
 * redirected request keeps the origin of the page that made it.
 * @param session - A session of web content.
 * @param lookup - Finds a resource by its file name; `undefined` if there is none.
 */
export function serveResources(
  session: Session,
  lookup: (name: string) => ReplacementResource | undefined,
): void {
  session.protocol.handle(resourceScheme, (request) => {
    const url = new URL(request.url);
    const resource =
      url.hostname === 'resource' ? lookup(decodeURIComponent(url.pathname.slice(1))) : undefined;
    if (resource === undefined) return new Response(null, { status: 404 });
    const base64 = resource.contentType.endsWith(';base64');
    const body = base64 ? Buffer.from(resource.body, 'base64') : resource.body;
    return new Response(body, {
      headers: {
        'content-type': base64
          ? resource.contentType.slice(0, -';base64'.length)
          : resource.contentType,
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  });
}
