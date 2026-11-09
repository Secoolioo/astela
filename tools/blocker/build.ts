/**
 * Builds the data of the content blocker: downloads the filter lists, resolves their
 * directives, parses them with the scriptlets of uBlock Origin and writes the serialized
 * engine with its metadata and license notices. Packages ship the result as separate data
 * files; the browser never downloads lists itself.
 *
 * Usage:
 * - `node tools/blocker/build.ts --out app/build/blocker` builds from the current lists.
 * - `node tools/blocker/build.ts --out <dir> --fixture <dir>` builds offline from the
 *   `*.txt` lists and the optional `resources.json` of a test folder.
 * - `node tools/blocker/build.ts --update-sources` records the hashes of the pinned
 *   scriptlet sources after the release in `ubo-sources.json` was changed.
 */
import { FiltersEngine } from '@ghostery/adblocker';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  extraListGroups,
  extraLists,
  filterLists,
  type ExtraListGroup,
  type FilterList,
} from './lists.ts';
import { loadList } from './preprocess.ts';
import { fetchRedirects } from './redirects.ts';
import { convertScriptlets, fetchSources, type UboSources } from './scriptlets.ts';

const sourcesFile = resolve(import.meta.dirname, 'ubo-sources.json');

/** Downloads a text, trying again after network errors. */
export async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((done) => setTimeout(done, 2000 * 2 ** (attempt - 1)));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (text.trim() === '') throw new Error('empty response');
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not download ${url}: ${String(lastError)}`);
}

/** Downloads a file as it is, trying again after network errors; it may be empty. */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await new Promise((done) => setTimeout(done, 2000 * 2 ** (attempt - 1)));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not download ${url}: ${String(lastError)}`);
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** What the data was built from, shipped next to the engine. */
interface Metadata {
  readonly builtAt: string;
  readonly lists: readonly (Omit<FilterList, 'url'> & {
    url: string;
    sha256: string;
    bytes: number;
    /** The group of an optional list, which has an engine of its own. */
    group?: ExtraListGroup;
  })[];
  readonly scriptlets: {
    readonly source: string;
    readonly license: string;
    readonly count: number;
  };
  /** The replacement resources that `$redirect` filters serve. */
  readonly redirects: {
    readonly source: string;
    readonly license: string;
    readonly count: number;
  };
}

function notice(metadata: Metadata): string {
  return [
    'Content blocker data',
    '',
    'The serialized filter engine in this folder is built from the filter lists below and',
    'from the scriptlets and replacement resources of uBlock Origin. Each keeps its own',
    'license; the lists, the scriptlets and the resources are data that Astela distributes',
    'unchanged in substance, separate from its own code.',
    '',
    ...metadata.lists.flatMap((list) => [
      list.group === undefined ? list.name : `${list.name} (optional, ${list.group})`,
      `  Source: ${list.url}`,
      `  Home: ${list.homepage}`,
      `  License: ${list.license}`,
      '',
    ]),
    `Scriptlets: ${metadata.scriptlets.source}`,
    `  License: ${metadata.scriptlets.license}`,
    '  The GNU General Public License applies to the scriptlet source code. Their complete',
    '  source is available at the address above.',
    '',
    `Replacement resources: ${metadata.redirects.source}`,
    `  License: ${metadata.redirects.license}`,
    '',
  ].join('\n');
}

/**
 * Marks the scriptlets that uBlock Origin runs in an isolated world, so the frame preload of
 * the browser runs them there. The mark has to match the one in `app/src/preload/frame.ts`.
 */
export const isolatedScriptletMark = '/*astela:isolated-world*/';

/**
 * Puts {@link isolatedScriptletMark} in front of the body of every scriptlet whose world is
 * `ISOLATED`; the engine keeps the world but does not tell it when it hands out scripts.
 * @param resources - The resources JSON for `updateResources`.
 */
export function markIsolatedScriptlets(resources: string): string {
  const parsed = JSON.parse(resources) as { scriptlets?: unknown };
  if (!Array.isArray(parsed.scriptlets)) return resources;
  parsed.scriptlets = parsed.scriptlets.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) return item;
    const { body, executionWorld } = item as { body?: unknown; executionWorld?: unknown };
    return executionWorld === 'ISOLATED' &&
      typeof body === 'string' &&
      !body.startsWith(isolatedScriptletMark)
      ? { ...item, body: `${isolatedScriptletMark}${body}` }
      : item;
  });
  return JSON.stringify(parsed);
}

/**
 * The network filters that apply to popups, rewritten without their `popup` option. The
 * filter engine drops `$popup` filters, so they become an engine of their own that the
 * browser asks when a page opens a popup.
 * @param text - The text of the filter lists.
 */
export function popupFilters(text: string): string[] {
  const filters: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // Comments, list headers and cosmetic rules are not network filters.
    if (line === '' || line.startsWith('!') || line.startsWith('[') || line.includes('#')) {
      continue;
    }
    const separator = line.lastIndexOf('$');
    if (separator <= 0) continue;
    const options = line.slice(separator + 1).split(',');
    if (!options.includes('popup')) continue;
    const rest = options.filter((option) => option !== 'popup');
    const pattern = line.slice(0, separator);
    filters.push(rest.length === 0 ? pattern : `${pattern}$${rest.join(',')}`);
  }
  return filters;
}

/** Builds the engine from lists and scriptlets and writes the data folder. */
export async function build(options: {
  readonly out: string;
  readonly fixture?: string;
}): Promise<Metadata> {
  const lists: { list: FilterList; text: string; group?: ExtraListGroup }[] = [];
  let resources: string;
  let scriptletSource: Metadata['scriptlets'];
  let redirectSource: Metadata['redirects'];
  if (options.fixture === undefined) {
    for (const list of filterLists) {
      lists.push({ list, text: await loadList(list.url, fetchText) });
    }
    for (const group of extraListGroups) {
      for (const list of extraLists[group]) {
        lists.push({ list, text: await loadList(list.url, fetchText), group });
      }
    }
    const sources = JSON.parse(readFileSync(sourcesFile, 'utf8')) as UboSources;
    const { files } = await fetchSources(sources, fetchText);
    const scriptlets = await convertScriptlets(files);
    const { redirects } = await fetchRedirects(sources, fetchBytes);
    resources = JSON.stringify({ scriptlets, redirects });
    scriptletSource = {
      source: `https://github.com/${sources.repository}/tree/${sources.tag}/src/js/resources`,
      license: sources.license,
      count: scriptlets.length,
    };
    redirectSource = {
      source: `https://github.com/${sources.repository}/tree/${sources.tag}/src/web_accessible_resources`,
      license: sources.license,
      count: redirects.length,
    };
  } else {
    // The lists of the folder are the default ones; those of its subfolders `cookies` and
    // `annoyances` belong to these groups.
    const fixture = options.fixture;
    for (const group of [undefined, ...extraListGroups]) {
      const folder = group === undefined ? fixture : join(fixture, group);
      if (!existsSync(folder)) continue;
      for (const name of readdirSync(folder)
        .filter((file) => file.endsWith('.txt'))
        .toSorted()) {
        const text = readFileSync(join(folder, name), 'utf8');
        const id = name.replace(/\.txt$/, '');
        const list = {
          id,
          name: id,
          url: `fixture:${name}`,
          homepage: 'fixture',
          license: 'MPL-2.0',
        };
        lists.push(group === undefined ? { list, text } : { list, text, group });
      }
    }
    const fixtureResources = join(options.fixture, 'resources.json');
    resources = existsSync(fixtureResources)
      ? readFileSync(fixtureResources, 'utf8')
      : JSON.stringify({ scriptlets: [], redirects: [] });
    scriptletSource = { source: 'fixture', license: 'MPL-2.0', count: 0 };
    redirectSource = { source: 'fixture', license: 'MPL-2.0', count: 0 };
  }
  resources = markIsolatedScriptlets(resources);
  const allLists = lists
    .filter((list) => list.group === undefined)
    .map((list) => list.text)
    .join('\n');
  const engine = FiltersEngine.parse(allLists, {
    enableCompression: true,
    loadCosmeticFilters: true,
    loadNetworkFilters: true,
    loadExtendedSelectors: true,
  });
  const popupEngine = FiltersEngine.parse(popupFilters(allLists).join('\n'), {
    enableCompression: true,
    loadCosmeticFilters: false,
    loadNetworkFilters: true,
  });
  if (!engine.updateResources(resources, sha256(resources))) {
    throw new Error('The engine did not accept the scriptlet resources');
  }
  const metadata: Metadata = {
    builtAt: new Date().toISOString(),
    lists: lists.map(({ list, text, group }) => ({
      id: list.id,
      name: list.name,
      url: list.url,
      homepage: list.homepage,
      license: list.license,
      sha256: sha256(text),
      bytes: text.length,
      ...(group === undefined ? {} : { group }),
    })),
    scriptlets: scriptletSource,
    redirects: redirectSource,
  };
  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, 'engine.bin'), engine.serialize());
  writeFileSync(join(options.out, 'popups.bin'), popupEngine.serialize());
  // Each optional group gets an engine of its own, which shares the resources of the main
  // engine when the browser loads it. It also carries the exceptions of the unbreak list,
  // which fix pages that any of uBlock Origin's lists break.
  const unbreak = lists.find(({ list }) => list.id === 'ublock-unbreak')?.text ?? '';
  for (const group of extraListGroups) {
    const text = [
      ...lists.filter((list) => list.group === group).map((list) => list.text),
      unbreak,
    ].join('\n');
    const extra = FiltersEngine.parse(text, {
      enableCompression: true,
      loadCosmeticFilters: true,
      loadNetworkFilters: true,
      loadExtendedSelectors: true,
    });
    writeFileSync(join(options.out, `${group}.bin`), extra.serialize());
  }
  writeFileSync(join(options.out, 'filters.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(options.out, 'NOTICE.txt'), notice(metadata));
  return metadata;
}

/** A record with its keys in order, so recorded hashes diff well. */
function sorted(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  if (args.includes('--update-sources')) {
    const sources = JSON.parse(readFileSync(sourcesFile, 'utf8')) as UboSources;
    const { hashes } = await fetchSources(sources, fetchText, true);
    const { hashes: redirectHashes } = await fetchRedirects(sources, fetchBytes, true);
    writeFileSync(
      sourcesFile,
      `${JSON.stringify({ ...sources, files: sorted(hashes), redirects: sorted(redirectHashes) }, null, 2)}\n`,
    );
    console.log(
      `Recorded ${Object.keys(hashes).length + Object.keys(redirectHashes).length} files of ${sources.tag}`,
    );
    return;
  }
  const out = value('--out');
  if (out === undefined) {
    throw new Error('Usage: build.ts --out <dir> [--fixture <dir>] | --update-sources');
  }
  const fixture = value('--fixture');
  const metadata = await build({
    out: resolve(out),
    ...(fixture === undefined ? {} : { fixture: resolve(fixture) }),
  });
  console.log(
    `Built the blocker data from ${metadata.lists.length} lists and ${metadata.scriptlets.count} scriptlets`,
  );
}

if (import.meta.main) {
  await main();
}
