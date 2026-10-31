/**
 * Downloads packages of a published release by their versionless names and checks each one
 * against the `SHA256SUMS` of that release before it is written, so a damaged or incomplete
 * download never runs. The checksums come from the same release, so they guard against
 * broken transfers, not against replaced files; the assets of a published release cannot
 * change. Their signatures are not checked: app/build/keys holds only the current update key
 * and its successor, so after a rotation it lacks the key that signed an earlier release.
 * The live update proof installs the earlier release from these files.
 *
 * Usage: node tools/release/download.ts --version <version> --out <dir> <name>...
 * A name is the asset name without the product prefix from brand.json, such as
 * `linux-x86_64.AppImage` for `astela-linux-x86_64.AppImage`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { download, parseChecksums, readBrand, verifyChecksum } from './releases.ts';

const args = process.argv.slice(2);
const value = (name: string): string => {
  const index = args.indexOf(`--${name}`);
  const found = args[index + 1];
  if (index === -1 || found === undefined) throw new Error(`Missing --${name}`);
  return found;
};
const version = value('version');
const out = resolve(value('out'));
const names = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (names.length === 0) {
  throw new Error('Usage: node tools/release/download.ts --version <v> --out <dir> <name>...');
}
const brand = readBrand();
const repository = process.env['GITHUB_REPOSITORY'] ?? brand.repository;
// Published releases serve their assets under a stable URL of the version's tag.
const base = `https://github.com/${repository}/releases/download/v${version}/`;

const checksums = parseChecksums((await download(`${base}SHA256SUMS`)).toString('utf8'));
mkdirSync(out, { recursive: true });
for (const name of names.map((n) => `${brand.slug}-${n}`)) {
  const bytes = await download(`${base}${name}`);
  verifyChecksum(checksums, name, bytes);
  writeFileSync(join(out, name), bytes);
  console.log(`ok    ${name} of v${version}: ${bytes.length} bytes, as listed in SHA256SUMS`);
}
