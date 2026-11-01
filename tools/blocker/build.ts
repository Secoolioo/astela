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
import { filterLists, type FilterList } from './lists.ts';
import { loadList } from './preprocess.ts';
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

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** What the data was built from, shipped next to the engine. */
interface Metadata {
  readonly builtAt: string;
  readonly lists: readonly (Omit<FilterList, 'url'> & {
    url: string;
    sha256: string;
    bytes: number;
  })[];
  readonly scriptlets: {
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
    'from the scriptlets of uBlock Origin. Each keeps its own license; the lists and the',
    'scriptlets are data that Astela distributes unchanged in substance, separate from its',
    'own code.',
    '',
    ...metadata.lists.flatMap((list) => [
      list.name,
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
  ].join('\n');
}

/** Builds the engine from lists and scriptlets and writes the data folder. */
export async function build(options: {
  readonly out: string;
  readonly fixture?: string;
}): Promise<Metadata> {
  const lists: { list: FilterList; text: string }[] = [];
  let resources: string;
  let scriptletSource: Metadata['scriptlets'];
  if (options.fixture === undefined) {
    for (const list of filterLists) {
      lists.push({ list, text: await loadList(list.url, fetchText) });
    }
    const sources = JSON.parse(readFileSync(sourcesFile, 'utf8')) as UboSources;
    const { files } = await fetchSources(sources, fetchText);
    const scriptlets = await convertScriptlets(files);
    resources = JSON.stringify({ scriptlets, resources: [] });
    scriptletSource = {
      source: `https://github.com/${sources.repository}/tree/${sources.tag}/src/js/resources`,
      license: sources.license,
      count: scriptlets.length,
    };
  } else {
    for (const name of readdirSync(options.fixture)
      .filter((file) => file.endsWith('.txt'))
      .toSorted()) {
      const text = readFileSync(join(options.fixture, name), 'utf8');
      const id = name.replace(/\.txt$/, '');
      lists.push({
        list: { id, name: id, url: `fixture:${name}`, homepage: 'fixture', license: 'MPL-2.0' },
        text,
      });
    }
    const fixtureResources = join(options.fixture, 'resources.json');
    resources = existsSync(fixtureResources)
      ? readFileSync(fixtureResources, 'utf8')
      : JSON.stringify({ scriptlets: [], resources: [] });
    scriptletSource = { source: 'fixture', license: 'MPL-2.0', count: 0 };
  }
  const engine = FiltersEngine.parse(lists.map(({ text }) => text).join('\n'), {
    enableCompression: true,
    loadCosmeticFilters: true,
    loadNetworkFilters: true,
  });
  if (!engine.updateResources(resources, sha256(resources))) {
    throw new Error('The engine did not accept the scriptlet resources');
  }
  const metadata: Metadata = {
    builtAt: new Date().toISOString(),
    lists: lists.map(({ list, text }) => ({
      id: list.id,
      name: list.name,
      url: list.url,
      homepage: list.homepage,
      license: list.license,
      sha256: sha256(text),
      bytes: text.length,
    })),
    scriptlets: scriptletSource,
  };
  mkdirSync(options.out, { recursive: true });
  writeFileSync(join(options.out, 'engine.bin'), engine.serialize());
  writeFileSync(join(options.out, 'filters.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(join(options.out, 'NOTICE.txt'), notice(metadata));
  return metadata;
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
    const sorted = Object.fromEntries(
      Object.entries(hashes).toSorted(([a], [b]) => a.localeCompare(b)),
    );
    writeFileSync(sourcesFile, `${JSON.stringify({ ...sources, files: sorted }, null, 2)}\n`);
    console.log(`Recorded ${Object.keys(sorted).length} files of ${sources.tag}`);
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
