/**
 * Checks that the browser's own interface takes its durations, easings and shadows from the
 * design tokens (docs/architecture/design-system.md). Outside `tokens.css`, it finds durations
 * and easings that transitions, animations and the options of `animate()` write out, such as
 * `120ms`, `ease-out` or `duration: 200`, and box shadows other than the elevation tokens and
 * rings of 1 or 2 px in a token color. The text between `;`, `{` and `}` counts as one
 * declaration, so a value on a later line than its property name, or after a template
 * interpolation, is found as well; comments are left out. Durations and easings that code
 * computes, or keeps in a constant or a custom property of its own, are not checked. In
 * `tokens.css`, every motion token must be 0 in the block for reduced motion, so that code
 * which reads a duration from the tokens moves nothing either.
 *
 * Usage: `node tools/design/check-tokens.ts`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** A place that does not take its value from the tokens. */
export interface Problem {
  readonly file: string;
  /** The line of the value, counted from 1. */
  readonly line: number;
  readonly rule: 'duration' | 'easing' | 'shadow' | 'reduced-motion';
  readonly text: string;
}

/** A duration such as `120ms`, `.2s` or `1s`, not part of a longer word or number. */
const duration = /(?<![\w.#-])\d*\.?\d+m?s(?![\w-])/g;
/**
 * A duration or delay given as a number to a property of an object, such as `duration: 200` in
 * the options of `animate()`, but not `duration` in `animate ? duration : 0`.
 */
const numericDuration = /(?<=^|,)\s*(?:duration|delay|endDelay)\s*:\s*(?=-?\.?\d)/g;
/** Names of properties whose values hold durations or easings, in styles and in code. */
const timed = /transition|animation|duration|delay|easing/i;
/** An easing by its CSS name, such as `ease-out`, but not a token such as `--ease-out`. */
const namedEasing = /(?<![\w-])(?:ease(?:-in|-out|-in-out)?|linear|step-start|step-end)(?![\w-])/g;
/** An easing written as a function, which is never a token. */
const easingFunction = /cubic-bezier\(|steps\(/g;
/** The name of a box shadow, up to its value. */
const boxShadow = /box-shadow\s*:\s*/g;
/** A ring of 1 or 2 px in a token color, such as a focus ring, which is no shadow of depth. */
const ring = /^(?:inset\s+)?0 0 0 [12]px var\(--[\w-]+\)$/;
/** Comments of styles, markup and code; `//` only where a space or the line starts before it. */
const comment = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(?<!\S)\/\/.*/g;

/** A motion token and its value as `tokens.css` sets it, such as `--motion-base: 180ms`. */
const motionToken = /(--motion-[\w-]+)\s*:\s*([^;{}]*)/g;
/** The start of the block that applies when the system asks for reduced motion. */
const reducedMotion = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;

/** The order of the rules for the problems of one line. */
const order: Readonly<Record<Problem['rule'], number>> = {
  duration: 0,
  easing: 1,
  shadow: 2,
  'reduced-motion': 3,
};

/** What each rule reports. */
const messages: Readonly<Record<Problem['rule'], string>> = {
  duration: 'duration not from a token',
  easing: 'easing not from a token',
  shadow: 'shadow not from a token',
  'reduced-motion': 'motion token that reduced motion does not set to 0',
};

/**
 * Blanks out the braces of template interpolations, `${…}`, so that a declaration with an
 * interpolation in its value stays one declaration. Every offset stays where it was.
 * @param code - Text without comments.
 */
function withoutInterpolationBraces(code: string): string {
  const characters = code.split('');
  // For each brace that is open inside an interpolation: whether it opened the interpolation.
  const open: boolean[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (character === '$' && characters[index + 1] === '{') {
      open.push(true);
      index += 1;
      characters[index] = ' ';
    } else if (character === '{' && open.length > 0) {
      open.push(false);
    } else if (character === '}' && open.length > 0 && open.pop() === true) {
      characters[index] = ' ';
    }
  }
  return characters.join('');
}

/**
 * Finds the places in one file that write out a duration, an easing or a shadow. A problem
 * names the line of the value, once for each rule.
 * @param file - The path that problems name.
 * @param text - The content of the file.
 */
export function problemsIn(file: string, text: string): Problem[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const problems = new Map<string, Problem>();
  const report = (index: number, rule: Problem['rule']): void => {
    const line = starts.findLastIndex((start) => start <= index);
    const key = `${line}:${rule}`;
    if (!problems.has(key)) {
      problems.set(key, { file, line: line + 1, rule, text: (lines[line] ?? '').trim() });
    }
  };
  // Comments and the braces of interpolations become spaces, so every offset stays the same.
  const code = withoutInterpolationBraces(
    text.replace(comment, (part) => part.replace(/[^\n]/g, ' ')),
  );
  for (const { index: start, 0: part } of code.matchAll(/[^;{}]+/g)) {
    // A duration or an easing counts where the name of a timed property comes before it.
    const isTimed = (at: number): boolean => timed.test(part.slice(0, at));
    for (const match of part.matchAll(duration)) {
      if (isTimed(match.index)) report(start + match.index, 'duration');
    }
    for (const match of part.matchAll(numericDuration)) {
      report(start + match.index + match[0].length, 'duration');
    }
    for (const match of part.matchAll(easingFunction)) report(start + match.index, 'easing');
    for (const match of part.matchAll(namedEasing)) {
      if (isTimed(match.index)) report(start + match.index, 'easing');
    }
    for (const match of part.matchAll(boxShadow)) {
      const at = match.index + match[0].length;
      const value = part.slice(at).replace(/\s+/g, ' ').trim();
      if (!value.includes('var(--shadow-') && !ring.test(value)) report(start + at, 'shadow');
    }
  }
  return [...problems.values()].toSorted(
    (a, b) => a.line - b.line || order[a.rule] - order[b.rule],
  );
}

/**
 * Finds the motion tokens of a style sheet of tokens that the block for reduced motion does
 * not set to 0: each one once, at the line where it is first defined.
 * @param file - The path that problems name.
 * @param text - The content of the style sheet, such as `tokens.css`.
 */
export function reducedMotionProblems(file: string, text: string): Problem[] {
  const lines = text.split('\n');
  const code = text.replace(comment, (part) => part.replace(/[^\n]/g, ' '));
  // Where the blocks for reduced motion start and end, by their braces.
  const blocks: (readonly [number, number])[] = [];
  for (const match of code.matchAll(reducedMotion)) {
    let depth = 1;
    let end = match.index + match[0].length;
    for (; end < code.length && depth > 0; end += 1) {
      if (code[end] === '{') depth += 1;
      else if (code[end] === '}') depth -= 1;
    }
    blocks.push([match.index, end]);
  }
  const reduced = (at: number): boolean => blocks.some(([start, end]) => at >= start && at < end);
  const zero = new Set<string>();
  const defined = new Map<string, number>();
  for (const match of code.matchAll(motionToken)) {
    const [, name = '', value = ''] = match;
    if (reduced(match.index)) {
      if (/^0(?:m?s)?$/.test(value.trim())) zero.add(name);
    } else if (!defined.has(name)) {
      defined.set(name, match.index);
    }
  }
  return [...defined].flatMap(([name, at]) => {
    if (zero.has(name)) return [];
    const line = code.slice(0, at).split('\n').length - 1;
    return [
      { file, line: line + 1, rule: 'reduced-motion' as const, text: (lines[line] ?? '').trim() },
    ];
  });
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
  const tokens = join(root, 'app/src/ui/ui-kit/tokens.css');
  return [
    ...sources(join(root, 'app/src/ui')).flatMap((path) =>
      problemsIn(relative(root, path), readFileSync(path, 'utf8')),
    ),
    ...reducedMotionProblems(relative(root, tokens), readFileSync(tokens, 'utf8')),
  ];
}

if (import.meta.main) {
  const problems = checkTokens(resolve(import.meta.dirname, '../..'));
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line}: ${messages[problem.rule]}: ${problem.text}`);
  }
  if (problems.length > 0) {
    console.error(
      'Use the motion, easing and shadow tokens of app/src/ui/ui-kit/tokens.css, and set every motion token to 0 there for reduced motion.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Durations, easings and shadows all come from the tokens, and reduced motion stops every motion token.',
    );
  }
}
