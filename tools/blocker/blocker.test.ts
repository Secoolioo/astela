import { FiltersEngine, Request } from '@ghostery/adblocker';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { build } from './build.ts';
import { applyConditions, evaluateCondition, loadList } from './preprocess.ts';
import { fetchSources, relativeImports, type UboSources } from './scriptlets.ts';

const env = new Set(['env_chromium', 'cap_user_stylesheet']);

describe('evaluateCondition', () => {
  it('handles tokens, negation, and, or and parentheses', () => {
    assert.equal(evaluateCondition('env_chromium', env), true);
    assert.equal(evaluateCondition('env_firefox', env), false);
    assert.equal(evaluateCondition('!env_mobile', env), true);
    assert.equal(evaluateCondition('env_chromium && !env_mobile', env), true);
    assert.equal(evaluateCondition('env_firefox || env_chromium', env), true);
    assert.equal(evaluateCondition('!(env_firefox || env_chromium)', env), false);
    assert.equal(evaluateCondition('false', env), false);
  });
});

describe('applyConditions', () => {
  it('keeps the lines of true blocks, nested and with else', () => {
    const text = [
      'a',
      '!#if env_chromium',
      'b',
      '!#if env_mobile',
      'c',
      '!#else',
      'd',
      '!#include more.txt',
      '!#endif',
      '!#endif',
      '!#if env_firefox',
      'e',
      '!#include firefox.txt',
      '!#endif',
    ].join('\n');
    const { lines, includes } = applyConditions(text, env);
    assert.deepEqual(lines, ['a', 'b', 'd']);
    assert.deepEqual(includes, ['more.txt']);
  });
});

describe('loadList', () => {
  it('includes files next to the list and refuses other paths', async () => {
    const files: Record<string, string> = {
      'https://lists.example/f/main.txt': 'one\n!#include part.txt',
      'https://lists.example/f/part.txt': 'two',
      'https://lists.example/f/bad.txt': '!#include ../secret.txt',
    };
    const fetchText = (url: string): Promise<string> => Promise.resolve(files[url] ?? '');
    assert.equal(await loadList('https://lists.example/f/main.txt', fetchText, env), 'one\ntwo');
    await assert.rejects(loadList('https://lists.example/f/bad.txt', fetchText, env), /Refusing/);
  });
});

describe('scriptlet sources', () => {
  it('follows named, side-effect and re-export imports', () => {
    const source = [
      "import './a.js';",
      "import { b } from './b.js';",
      'import {\n  c,\n} from "../c.js";',
      "export * from './d.js';",
      "import x from 'https://cdn.example/x.js';",
    ].join('\n');
    assert.deepEqual(relativeImports('src/js/resources/scriptlets.js', source).toSorted(), [
      'src/js/c.js',
      'src/js/resources/a.js',
      'src/js/resources/b.js',
      'src/js/resources/d.js',
    ]);
  });

  it('refuses files whose hash differs from the recorded one', async () => {
    const sources: UboSources = {
      repository: 'example/repo',
      tag: '1.0.0',
      license: 'GPL-3.0-or-later',
      files: { 'src/js/resources/scriptlets.js': '0'.repeat(64) },
    };
    await assert.rejects(
      fetchSources(sources, () => Promise.resolve('export const builtinScriptlets = [];')),
      /does not match/,
    );
  });
});

describe('build', () => {
  it('builds a working engine with notices from fixture lists', async () => {
    const out = mkdtempSync(join(tmpdir(), 'blocker-'));
    try {
      const fixture = resolve(import.meta.dirname, '../../app/tests/e2e/fixtures/blocker');
      const metadata = await build({ out, fixture });
      assert.equal(metadata.lists.length, 1);
      const engine = FiltersEngine.deserialize(readFileSync(join(out, 'engine.bin')));
      const blocked = (url: string, type: 'script' | 'image'): boolean =>
        engine.match(
          Request.fromRawDetails({ url, sourceUrl: 'http://127.0.0.1:8080/page.html', type }),
        ).match;
      assert.equal(blocked('http://127.0.0.1:8080/fixture-ad.js', 'script'), true);
      assert.equal(blocked('http://127.0.0.1:8080/fixture-tracker.gif', 'image'), true);
      assert.equal(blocked('http://127.0.0.1:8080/app.js', 'script'), false);
      // Generic element rules apply to the classes that a page reports from its document.
      const cosmetics = engine.getCosmeticsFilters({
        url: 'http://127.0.0.1:8080/page.html',
        hostname: '127.0.0.1',
        domain: '127.0.0.1',
        classes: ['fixture-ad'],
      });
      assert.match(cosmetics.styles, /\.fixture-ad/);
      assert.equal(cosmetics.scripts.length, 1);
      assert.match(readFileSync(join(out, 'NOTICE.txt'), 'utf8'), /License: MPL-2.0/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
