import { FiltersEngine, Request } from '@ghostery/adblocker';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { build, isolatedScriptletMark, markIsolatedScriptlets, popupFilters } from './build.ts';
import { contentTypeOf } from './redirects.ts';
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

describe('markIsolatedScriptlets', () => {
  it('marks only the scriptlets of the isolated world, once', () => {
    const resources = JSON.stringify({
      scriptlets: [
        { name: 'a.js', body: 'function a() {}', executionWorld: 'ISOLATED' },
        { name: 'b.js', body: 'function b() {}', executionWorld: 'MAIN' },
        { name: 'c.js', body: 'function c() {}' },
      ],
      redirects: [],
    });
    const marked = markIsolatedScriptlets(resources);
    const bodies = (JSON.parse(marked) as { scriptlets: { body: string }[] }).scriptlets.map(
      (item) => item.body,
    );
    assert.deepEqual(bodies, [
      `${isolatedScriptletMark}function a() {}`,
      'function b() {}',
      'function c() {}',
    ]);
    assert.equal(markIsolatedScriptlets(marked), marked);
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
      // A redirect filter names its stand-in, which the data carries.
      const redirected = engine.match(
        Request.fromRawDetails({
          url: 'http://127.0.0.1:8080/fixture-redirect.js',
          sourceUrl: 'http://127.0.0.1:8080/page.html',
          type: 'script',
        }),
      );
      assert.equal(redirected.redirect?.filename, 'noop.js');
      assert.equal(
        engine.resources.getResource('fixture-ima.js').contentType,
        'application/javascript',
      );
      // Generic element rules apply to the classes that a page reports from its document.
      const cosmetics = engine.getCosmeticsFilters({
        url: 'http://127.0.0.1:8080/page.html',
        hostname: '127.0.0.1',
        domain: '127.0.0.1',
        classes: ['fixture-ad'],
      });
      assert.match(cosmetics.styles, /\.fixture-ad/);
      // Five fixture scriptlets apply; the isolated one carries its mark.
      assert.equal(cosmetics.scripts.length, 5);
      assert.equal(
        cosmetics.scripts.filter((script) => script.includes(isolatedScriptletMark)).length,
        1,
      );
      // Procedural rules reach the page as extended rules.
      const extended = engine.getCosmeticsFilters({
        url: 'http://127.0.0.1:8080/procedural.html',
        hostname: '127.0.0.1',
        domain: '127.0.0.1',
        getExtendedRules: true,
      }).extended;
      assert.equal(extended.length, 2);
      // Popup filters form an engine of their own, asked with the popup as the document.
      const popups = FiltersEngine.deserialize(readFileSync(join(out, 'popups.bin')));
      const popup = (url: string): boolean =>
        popups.match(
          Request.fromRawDetails({
            url,
            sourceUrl: 'http://127.0.0.1:8080/popup.html',
            type: 'main_frame',
          }),
        ).match;
      assert.equal(popup('http://127.0.0.1:8080/fixture-popup.html'), true);
      assert.equal(popup('http://127.0.0.1:8080/second.html'), false);
      // The main engine leaves the popup filter out, so the page itself still loads.
      assert.equal(blocked('http://127.0.0.1:8080/fixture-popup.html', 'script'), false);
      assert.match(readFileSync(join(out, 'NOTICE.txt'), 'utf8'), /License: MPL-2.0/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('contentTypeOf', () => {
  it('keeps scripts usable for +js() and binary files as Base64', () => {
    assert.equal(contentTypeOf('noop.js'), 'application/javascript');
    assert.equal(contentTypeOf('1x1.gif'), 'image/gif;base64');
    assert.equal(contentTypeOf('noop-0.1s.mp3'), 'audio/mp3;base64');
    assert.equal(contentTypeOf('empty'), 'text/plain');
  });
});

describe('popupFilters', () => {
  it('keeps the network filters for popups without their popup option', () => {
    assert.deepEqual(
      popupFilters(
        [
          '! comment',
          '||ads.example^$popup',
          '||track.example^$popup,third-party',
          '||other.example^$script',
          'example.com##.ad',
          '@@||good.example^$popup',
        ].join('\n'),
      ),
      ['||ads.example^', '||track.example^$third-party', '@@||good.example^'],
    );
  });
});
