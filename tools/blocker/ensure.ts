/**
 * Builds the content blocker data with the real filter lists unless `app/build/blocker`
 * already holds complete data from them, so `pnpm package` and `pnpm dev` never make a
 * browser that blocks nothing: test data from the fixture lists is built again. A failed
 * build stops the script that called this one.
 *
 * Usage: node tools/blocker/ensure.ts
 */
import { resolve } from 'node:path';
import { build, hasRealData } from './build.ts';

const out = resolve(import.meta.dirname, '../../app/build/blocker');
if (hasRealData(out)) {
  console.log(`Using the content blocker data in ${out}`);
} else {
  const metadata = await build({ out });
  console.log(`Built the content blocker data from ${metadata.lists.length} lists`);
}
