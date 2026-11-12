import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { importsOf, staticImports } from './start-path.ts';

describe('importsOf', () => {
  it('finds formatted imports and re-exports', () => {
    const code = "import { a } from './a.js';\nimport './b.js';\nexport * from '../c.js';\n";
    assert.deepEqual(importsOf(code), ['./a.js', './b.js', '../c.js']);
  });

  it('finds minified imports and re-exports', () => {
    const code =
      'import{A as e,D as t}from"./dist-1.js";import{t as E}from"./token.js";import"./side.js";' +
      'export{x as y}from"./re.js";export*from"./all.js";import x,{y as z}from"./mixed.js";';
    assert.deepEqual(importsOf(code), [
      './dist-1.js',
      './token.js',
      './side.js',
      './re.js',
      './all.js',
      './mixed.js',
    ]);
  });

  it('leaves out packages, imports with import() and other words', () => {
    const code =
      'import{app}from"electron";const m=import("./lazy.js");reimport("./no.js");' +
      'x.import("./no.js");const s=import.meta.url;';
    assert.deepEqual(importsOf(code), []);
  });
});

describe('staticImports', () => {
  it('follows the chunks of a minified entry and stops at lazy ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'start-path-'));
    try {
      writeFileSync(join(dir, 'index.js'), 'import{a}from"./a.js";const l=import("./lazy.js");');
      writeFileSync(join(dir, 'a.js'), 'import"./b.js";export const a=1;');
      writeFileSync(join(dir, 'b.js'), 'export{}from"./a.js";');
      writeFileSync(join(dir, 'lazy.js'), 'export const l=1;');
      const found = [...staticImports(join(dir, 'index.js'))].map((file) =>
        file.slice(dir.length + 1),
      );
      assert.deepEqual(found.toSorted(), ['a.js', 'b.js', 'index.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
