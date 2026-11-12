/**
 * The main process start-up path: the entry of the main process and every chunk that it loads
 * through static imports, as Node loads them before the entry runs. Chunks that load with
 * `import()` are not part of it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The relative modules that a piece of code imports or re-exports statically, in the formatted
 * form (`import { a } from './a.js'`) and in the minified one (`import{a}from"./a.js"`). Packages
 * such as `electron` and imports with `import()` do not count.
 * @param code - The code of a module.
 */
export function importsOf(code: string): string[] {
  const statements =
    /(?:^|[^\w$.])(?:import|export)\s*(?:[\w$*{}\s,]*?from\s*)?["'](\.{1,2}\/[^"']+)["']/g;
  return [...code.matchAll(statements)].map((match) => match[1] ?? '');
}

/**
 * A module and the modules it imports statically, recursively.
 * @param file - The module.
 * @param seen - The modules already found.
 */
export function staticImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const relative of importsOf(readFileSync(file, 'utf8'))) {
    staticImports(resolve(dirname(file), relative), seen);
  }
  return seen;
}
