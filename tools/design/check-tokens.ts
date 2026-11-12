/**
 * Checks that the browser's own interface takes its durations, easings and shadows from the
 * design tokens (docs/architecture/design-system.md): outside `tokens.css`, no duration or
 * easing is written out, and the only shadows are the elevation tokens and 1 px rings.
 *
 * Usage: `node tools/design/check-tokens.ts`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** A place that does not take its value from the tokens. */
export interface Problem {
  readonly file: string;
  /** The line, counted from 1. */
  readonly line: number;
  readonly rule: 'duration' | 'easing' | 'shadow';
  readonly text: string;
}

/** A duration such as `120ms`, `.2s` or `1s`, not part of a longer word or number. */
const duration = /(?<![\w.#-])\d*\.?\d+m?s(?![\w-])/;
/** Properties whose values are durations. */
const timed = /transition|animation|duration|delay/i;
/** An easing by its CSS name, such as `ease-out`, but not a token such as `--ease-out`. */
const namedEasing = /(?<![\w-])(?:ease(?:-in|-out|-in-out)?|linear)(?![\w-])/;
/** A ring of 1 or 2 px in a token color, such as a focus ring, which is no shadow of depth. */
const ring = /box-shadow\s*:\s*(?:inset\s+)?0 0 0 [12]px var\(--[\w-]+\)\s*(?:;|$)/;

/**
 * Finds the lines of one file that write out a duration, an easing or a shadow.
 * @param file - The path that problems name.
 * @param text - The content of the file.
 */
export function problemsIn(file: string, text: string): Problem[] {
  const problems: Problem[] = [];
  for (const [index, content] of text.split('\n').entries()) {
    const line = content.trim();
    const at = { file, line: index + 1, text: line };
    if (timed.test(line) && duration.test(line)) problems.push({ ...at, rule: 'duration' });
    if (/cubic-bezier\(|steps\(/.test(line) || (timed.test(line) && namedEasing.test(line))) {
      problems.push({ ...at, rule: 'easing' });
    }
    if (/box-shadow\s*:/.test(line) && !/var\(--shadow-/.test(line) && !ring.test(line)) {
      problems.push({ ...at, rule: 'shadow' });
    }
  }
  return problems;
}

/** The style and component files of the interface, without the tokens and the tests. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(?:css|ts|html)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes('__tests__') && !path.endsWith('tokens.css'));
}

/**
 * Checks the interface under `app/src/ui`.
 * @param root - The root of the repository.
 */
export function checkTokens(root: string): Problem[] {
  return sources(join(root, 'app/src/ui')).flatMap((path) =>
    problemsIn(relative(root, path), readFileSync(path, 'utf8')),
  );
}

if (import.meta.main) {
  const problems = checkTokens(resolve(import.meta.dirname, '../..'));
  for (const problem of problems) {
    console.error(
      `${problem.file}:${problem.line}: ${problem.rule} not from a token: ${problem.text}`,
    );
  }
  if (problems.length > 0) {
    console.error('Use the motion, easing and shadow tokens of app/src/ui/ui-kit/tokens.css.');
    process.exitCode = 1;
  } else {
    console.log('Durations, easings and shadows all come from the tokens.');
  }
}
