/**
 * Takes the scriptlets of uBlock Origin from a fixed release and converts them into the
 * resources of the filter engine. The sources are fetched by following the imports of
 * `src/js/resources/scriptlets.js`, and every file must match the hash in
 * `ubo-sources.json`, so a changed upstream file cannot slip into a build.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The pinned release and the hash of every file it needs. */
export interface UboSources {
  readonly repository: string;
  readonly tag: string;
  readonly license: string;
  readonly files: Readonly<Record<string, string>>;
}

/** A scriptlet as the filter engine expects it in its resources. */
export interface EngineScriptlet {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly body: string;
  readonly dependencies: readonly string[];
  readonly executionWorld: 'MAIN' | 'ISOLATED';
  readonly requiresTrust: boolean;
}

const entry = 'src/js/resources/scriptlets.js';

/**
 * The relative modules that a module imports, as paths from the repository root.
 * @param path - The module's path from the repository root.
 * @param source - Its source text.
 */
export function relativeImports(path: string, source: string): string[] {
  const found = new Set<string>();
  // `import x from './a.js'`, `export * from './a.js'` and side-effect `import './a.js'`.
  const pattern = /\b(?:import|export)\b(?:[^'";]*?\bfrom)?\s*['"](\.{1,2}\/[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? '';
    found.add(new URL(specifier, `file:///${path}`).pathname.slice(1));
  }
  return [...found];
}

/**
 * Downloads the scriptlet sources of the pinned release.
 * @param sources - The pinned release.
 * @param fetchText - Downloads a text.
 * @param update - Records new hashes instead of checking them, to move to a new release.
 * @returns The files by path, and the hashes that were found.
 */
export async function fetchSources(
  sources: UboSources,
  fetchText: (url: string) => Promise<string>,
  update = false,
): Promise<{ readonly files: Map<string, string>; readonly hashes: Record<string, string> }> {
  const files = new Map<string, string>();
  const hashes: Record<string, string> = {};
  const pending = [entry];
  while (pending.length > 0) {
    const path = pending.pop() ?? entry;
    if (files.has(path)) continue;
    const text = await fetchText(
      `https://raw.githubusercontent.com/${sources.repository}/${sources.tag}/${path}`,
    );
    const hash = createHash('sha256').update(text).digest('hex');
    if (!update && sources.files[path] !== hash) {
      throw new Error(`${path} of ${sources.tag} does not match its recorded hash`);
    }
    hashes[path] = hash;
    files.set(path, text);
    pending.push(...relativeImports(path, text));
  }
  if (!update && Object.keys(sources.files).length !== files.size) {
    throw new Error('The scriptlet sources need other files than recorded');
  }
  return { files, hashes };
}

/**
 * Loads the scriptlet list from the downloaded sources and converts it. The modules only
 * declare functions; loading them runs none of the scriptlets.
 * @param files - The sources by path.
 */
export async function convertScriptlets(
  files: ReadonlyMap<string, string>,
): Promise<EngineScriptlet[]> {
  const dir = mkdtempSync(join(tmpdir(), 'ubo-'));
  try {
    for (const [path, text] of files) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    // The repository marks its sources as modules for browsers, not for Node.
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    const module: unknown = await import(pathToFileURL(join(dir, entry)).href);
    const list =
      typeof module === 'object' && module !== null && 'builtinScriptlets' in module
        ? module.builtinScriptlets
        : undefined;
    if (!Array.isArray(list)) {
      throw new Error('scriptlets.js exports no builtinScriptlets');
    }
    return list.flatMap((item: unknown): EngineScriptlet[] => {
      if (typeof item !== 'object' || item === null) return [];
      const { name, aliases, fn, dependencies, world, requiresTrust } = item as Record<
        string,
        unknown
      >;
      if (typeof name !== 'string' || typeof fn !== 'function') return [];
      return [
        {
          name,
          aliases: Array.isArray(aliases) ? aliases.filter((a) => typeof a === 'string') : [],
          body: fn.toString(),
          dependencies: Array.isArray(dependencies)
            ? dependencies.filter((d) => typeof d === 'string')
            : [],
          executionWorld: world === 'ISOLATED' ? 'ISOLATED' : 'MAIN',
          requiresTrust: requiresTrust === true,
        },
      ];
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
