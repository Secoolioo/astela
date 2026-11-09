/**
 * Takes the replacement resources of uBlock Origin from the same fixed release as its
 * scriptlets: harmless stand-ins, such as an empty script or a transparent image, that a
 * `$redirect` filter serves instead of the blocked file. Every file must match the hash in
 * `ubo-sources.json`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A replacement resource as the filter engine expects it. */
export interface EngineRedirect {
  readonly name: string;
  readonly aliases: readonly string[];
  /** The text, or Base64 when the content type ends in `;base64`. */
  readonly body: string;
  readonly contentType: string;
}

/** The pinned release and the hashes of its replacement resources. */
export interface RedirectSources {
  readonly repository: string;
  readonly tag: string;
  readonly redirects?: Readonly<Record<string, string>>;
}

const mapPath = 'src/js/redirect-resources.js';
const filesPath = 'src/web_accessible_resources';

/**
 * Content types by file extension, as in `extToMimeMap` of uBlock Origin's
 * `src/js/redirect-engine.js`. Scripts are `application/javascript`, which the engine needs
 * to use them for `+js()` as well; binary files are kept as Base64.
 */
const contentTypes: Readonly<Record<string, string>> = {
  css: 'text/css',
  gif: 'image/gif;base64',
  html: 'text/html',
  js: 'application/javascript',
  json: 'application/json',
  mp3: 'audio/mp3;base64',
  mp4: 'video/mp4;base64',
  png: 'image/png;base64',
  txt: 'text/plain',
  xml: 'text/xml',
};

/**
 * The content type of a resource by its file name; a name without a known extension, such
 * as `empty`, is plain text.
 * @param name - The resource's file name.
 */
export function contentTypeOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot === -1 ? undefined : contentTypes[name.slice(dot + 1)]) ?? 'text/plain';
}

/** What uBlock Origin's map says about a resource. */
interface MapEntry {
  readonly alias?: string | readonly string[];
  readonly params?: unknown;
  readonly requiresTrust?: boolean;
}

/**
 * Downloads the replacement resources of the pinned release. Resources that need
 * parameters or trusted lists are left out, because the engine supports neither.
 * @param sources - The pinned release.
 * @param fetchBytes - Downloads a file.
 * @param update - Records new hashes instead of checking them, to move to a new release.
 * @returns The resources for the engine, and the hashes that were found.
 */
export async function fetchRedirects(
  sources: RedirectSources,
  fetchBytes: (url: string) => Promise<Uint8Array>,
  update = false,
): Promise<{ readonly redirects: EngineRedirect[]; readonly hashes: Record<string, string> }> {
  const hashes: Record<string, string> = {};
  const download = async (path: string): Promise<Uint8Array> => {
    const bytes = await fetchBytes(
      `https://raw.githubusercontent.com/${sources.repository}/${sources.tag}/${path}`,
    );
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (!update && sources.redirects?.[path] !== hash) {
      throw new Error(`${path} of ${sources.tag} does not match its recorded hash`);
    }
    hashes[path] = hash;
    return bytes;
  };
  const entries = await loadMap(Buffer.from(await download(mapPath)).toString('utf8'));
  const redirects: EngineRedirect[] = [];
  for (const [name, entry] of entries) {
    if (entry.params !== undefined || entry.requiresTrust === true) continue;
    const bytes = await download(`${filesPath}/${name}`);
    const contentType = contentTypeOf(name);
    const aliases = entry.alias === undefined ? [] : [entry.alias].flat();
    redirects.push({
      name,
      aliases,
      body: contentType.endsWith(';base64')
        ? Buffer.from(bytes).toString('base64')
        : Buffer.from(bytes).toString('utf8'),
      contentType,
    });
  }
  if (!update && Object.keys(sources.redirects ?? {}).length !== Object.keys(hashes).length) {
    throw new Error('The replacement resources need other files than recorded');
  }
  return { redirects, hashes };
}

/**
 * Loads the map of names to resource details; the module only declares data.
 * @param source - The text of `redirect-resources.js`.
 */
async function loadMap(source: string): Promise<[string, MapEntry][]> {
  const dir = mkdtempSync(join(tmpdir(), 'ubo-redirects-'));
  try {
    const file = join(dir, 'redirect-resources.mjs');
    writeFileSync(file, source);
    const module: unknown = await import(pathToFileURL(file).href);
    const map =
      typeof module === 'object' && module !== null && 'default' in module
        ? module.default
        : undefined;
    if (!(map instanceof Map)) throw new Error('redirect-resources.js exports no Map');
    return [...(map as Map<unknown, unknown>)].flatMap(([name, entry]): [string, MapEntry][] =>
      typeof name === 'string' && typeof entry === 'object' && entry !== null
        ? [[name, entry as MapEntry]]
        : [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
