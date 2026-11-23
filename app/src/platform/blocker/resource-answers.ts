import { resourceScheme, type ReplacementResource } from './resource-scheme.ts';

/**
 * A secret part of the addresses of this run: only pages whose requests the blocker
 * redirected learn it, so other pages cannot load a stand-in to find out that the browser
 * blocks.
 */
const runSecret = crypto.randomUUID();

/**
 * The address under which a resource is served.
 * @param name - The resource's file name.
 */
export function resourceUrl(name: string): string {
  return `${resourceScheme}://resource/${runSecret}/${encodeURIComponent(name)}`;
}

/**
 * The answer to a request for a replacement resource.
 * @param request - The request.
 * @param lookup - Finds a resource by its file name; `undefined` if there is none.
 */
export function answer(
  request: Request,
  lookup: (name: string) => ReplacementResource | undefined,
): Response {
  const url = new URL(request.url);
  const prefix = `/${runSecret}/`;
  const resource =
    url.hostname === 'resource' && url.pathname.startsWith(prefix)
      ? lookup(decodeURIComponent(url.pathname.slice(prefix.length)))
      : undefined;
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
}
