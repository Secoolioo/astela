/**
 * Checks whether a newer Electron release exists than the one the app uses. A newer patch
 * release of the same major version fails the check: Electron patches carry Chromium
 * security fixes, which must ship within the response times of docs/maintainers/WORKFLOW.md.
 * A newer major version is only reported, because it is adopted within two to four weeks.
 *
 * Usage: `node tools/ci/electron-freshness.ts`
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** What the check found. */
export interface Freshness {
  readonly current: string;
  /** The newest stable release of the current major version. */
  readonly latestPatch: string;
  /** The newest stable release of any major version. */
  readonly latest: string;
  /** Whether a newer release of the current major version exists. */
  readonly patchBehind: boolean;
  /** Whether a newer major version exists. */
  readonly majorBehind: boolean;
}

type Version = readonly [number, number, number];

function parseStable(version: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Compares the current version with the published ones. Prereleases are ignored.
 * @param current - The exact version the app uses.
 * @param published - Every version on the registry.
 */
export function checkFreshness(current: string, published: readonly string[]): Freshness {
  const own = parseStable(current);
  if (own === undefined) throw new Error(`Not an exact stable version: ${current}`);
  const stable = published
    .map((version) => ({ version, parsed: parseStable(version) }))
    .filter((v): v is { version: string; parsed: Version } => v.parsed !== undefined)
    .toSorted((a, b) => compare(a.parsed, b.parsed));
  const newest = (list: typeof stable): string => list.at(-1)?.version ?? current;
  const latestPatch = newest(stable.filter((v) => v.parsed[0] === own[0]));
  const latest = newest(stable);
  return {
    current,
    latestPatch,
    latest,
    patchBehind: compare(parseStable(latestPatch) ?? own, own) > 0,
    majorBehind: (parseStable(latest)?.[0] ?? own[0]) > own[0],
  };
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../..');
  const pkg = JSON.parse(readFileSync(join(root, 'app/package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const current = pkg.devDependencies?.['electron'] ?? pkg.dependencies?.['electron'];
  if (current === undefined) throw new Error('app/package.json has no electron dependency');
  const response = await fetch('https://registry.npmjs.org/electron', {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });
  if (!response.ok) throw new Error(`The npm registry answered ${String(response.status)}`);
  const data = (await response.json()) as { versions?: Record<string, unknown> };
  const result = checkFreshness(current, Object.keys(data.versions ?? {}));
  const lines = [`Electron in use: ${result.current}`];
  if (result.patchBehind) {
    lines.push(
      `Newer patch release: ${result.latestPatch}. Update within the security response times.`,
    );
  }
  if (result.majorBehind) {
    lines.push(`Newer major version: ${result.latest}. Upgrade within two to four weeks.`);
  }
  if (!result.patchBehind && !result.majorBehind) lines.push('Up to date.');
  const text = lines.join('\n');
  console.log(text);
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined)
    appendFileSync(summary, `## Electron\n\n${text.replaceAll('\n', '\n\n')}\n`);
  if (result.patchBehind) process.exitCode = 1;
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
