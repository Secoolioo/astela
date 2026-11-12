/**
 * Finds the scripts of the repository that the steps of the GitHub workflows run, resolved
 * against the folder each step runs in (`working-directory` of the step, else the defaults of
 * its job, else those of the workflow). A step that names a script relative to the wrong folder
 * fails only when its workflow runs, which for the release workflow is the release itself; the
 * tool tests check every workflow in each pull request instead.
 *
 * The reader covers the block style of the formatted workflows of this repository: mappings,
 * indented sequences, plain and quoted values and block scalars. It is not a YAML parser.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** A value of the document with the keys that lead to it; sequence items appear as `[n]`. */
export interface Entry {
  readonly path: readonly string[];
  readonly value: string;
}

/** A script that a step runs. */
export interface ScriptUse {
  readonly job: string;
  /** The name of the step, or its position in the job when it has none. */
  readonly step: string;
  /** The folder the step runs in, relative to the root of the repository. */
  readonly directory: string;
  /** The script as the step names it. */
  readonly script: string;
  /** The script relative to the root of the repository. */
  readonly path: string;
}

/** A script that a workflow runs but the repository does not have. */
export interface MissingScript extends ScriptUse {
  readonly workflow: string;
}

const keyLine = /^([\w.$-]+):(?:\s+(.*))?$/;
const blockScalar = /^[|>][-+]?\d*$/;
const scriptPath =
  /(?<![\w$./{:-])((?:\.{1,2}\/|[\w-]+\/)+[\w.-]+\.(?:sh|ts|mts|js|mjs|cjs|ps1|py))(?![\w./-])/g;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function plainValue(value: string): string {
  const text = value.replace(/\s+#.*$/, '').trim();
  const quoted = /^(["'])(.*)\1$/.exec(text);
  return quoted ? (quoted[2] ?? '') : text;
}

/** Reads the values of a workflow with the keys that lead to each of them. */
export function entries(text: string): Entry[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const stack: { indent: number; key: string; items: number }[] = [];
  const result: Entry[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    let content = line.trim();
    if (content === '' || content.startsWith('#')) continue;
    let indent = indentOf(line);
    while (content === '-' || content.startsWith('- ')) {
      while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
      const parent = stack.at(-1);
      const item = parent ? ++parent.items : 0;
      stack.push({ indent, key: `[${item}]`, items: -1 });
      const rest = content.slice(1).trimStart();
      indent += content.length - rest.length;
      content = rest;
    }
    const match = keyLine.exec(content);
    if (!match) continue;
    while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
    stack.push({ indent, key: match[1] ?? '', items: -1 });
    const raw = match[2] ?? '';
    if (!blockScalar.test(raw.trim())) {
      if (raw.trim() !== '')
        result.push({ path: stack.map((entry) => entry.key), value: plainValue(raw) });
      continue;
    }
    const block: string[] = [];
    while (index + 1 < lines.length) {
      const next = lines[index + 1] ?? '';
      if (next.trim() !== '' && indentOf(next) <= indent) break;
      block.push(next);
      index++;
    }
    const margin = Math.min(...block.filter((part) => part.trim() !== '').map(indentOf));
    result.push({
      path: stack.map((entry) => entry.key),
      value: block.map((part) => part.slice(Number.isFinite(margin) ? margin : 0)).join('\n'),
    });
  }
  return result;
}

function valueAt(all: readonly Entry[], path: readonly string[]): string | undefined {
  return all.find(
    (entry) => entry.path.length === path.length && entry.path.every((key, at) => key === path[at]),
  )?.value;
}

/** Finds the scripts of the repository that the steps of a workflow run. */
export function scriptUses(text: string): ScriptUse[] {
  const all = entries(text);
  const result: ScriptUse[] = [];
  for (const entry of all) {
    const [jobs, job, steps, item, key] = entry.path;
    if (entry.path.length !== 5 || jobs !== 'jobs' || steps !== 'steps' || key !== 'run') continue;
    if (job === undefined || item === undefined) continue;
    const at = ['jobs', job, 'steps', item];
    const directory =
      valueAt(all, [...at, 'working-directory']) ??
      valueAt(all, ['jobs', job, 'defaults', 'run', 'working-directory']) ??
      valueAt(all, ['defaults', 'run', 'working-directory']) ??
      '.';
    // A folder from an expression is known only when the workflow runs.
    if (directory.includes('${{')) continue;
    const step = valueAt(all, [...at, 'name']) ?? `step ${Number(item.slice(1, -1)) + 1}`;
    for (const line of entry.value.split('\n')) {
      if (line.trim().startsWith('#')) continue;
      for (const match of line.matchAll(scriptPath)) {
        const script = match[1] ?? '';
        result.push({ job, step, directory, script, path: posix.join(directory, script) });
      }
    }
  }
  return result;
}

/** Finds the scripts that the workflows of a repository run but the repository does not have. */
export function missingScripts(root: string): MissingScript[] {
  const folder = join(root, '.github', 'workflows');
  const result: MissingScript[] = [];
  for (const workflow of readdirSync(folder)
    .filter((name) => /\.ya?ml$/.test(name))
    .toSorted()) {
    for (const use of scriptUses(readFileSync(join(folder, workflow), 'utf8'))) {
      const file = join(root, use.path);
      const present = !use.path.startsWith('../') && existsSync(file) && statSync(file).isFile();
      if (!present) result.push({ workflow, ...use });
    }
  }
  return result;
}
