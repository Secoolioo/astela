/**
 * Writes the policy reference for administrators, `docs/admin/policies.md`, and the JSON Schema
 * of the Linux policy files, `docs/admin/policies.schema.json`, from the policy definitions of
 * the browser and the texts of `notes.ts`. `pnpm verify` runs it with `--check`, which fails
 * when the files in the repository differ from what it would write, so a change of a policy
 * changes its documentation in the same commit
 * ([ADR 0062](../../docs/adr/0062-policy-reference-generated-into-the-docs.md)).
 *
 * Usage: `node tools/policies/reference.ts [--check]`
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as prettier from 'prettier';
import type { PolicyDefinition } from '../../app/src/domain/policy/policy.ts';
import { coreSettings } from '../../app/src/main/core-settings.ts';
import { allPolicies } from '../../app/src/main/policy-definitions.ts';
import { policyInputs } from '../../app/src/main/policy-inputs.ts';
import { policyNotes, type PolicyNote } from './notes.ts';

/** The names that the policy sources derive from, as in `brand.json`. */
export interface Brand {
  readonly productName: string;
  readonly slug: string;
  readonly appId: string;
}

/** A JSON Schema, as far as the reference writes one. */
export type JsonSchema = Readonly<Record<string, unknown>>;

/** The value of a policy in the words of the reference and as a JSON Schema. */
export interface ValueShape {
  readonly json: JsonSchema;
  /** The type in words, such as `boolean` or `list of strings`. */
  readonly type: string;
  /** The rules of the value in words, such as `at most 100 entries`. */
  readonly rules: readonly string[];
}

/** The files of the reference, by their path in the repository. */
export const referencePaths = {
  markdown: 'docs/admin/policies.md',
  schema: 'docs/admin/policies.schema.json',
} as const;

/** A field of a part of a Valibot schema, which the reference reads without Valibot. */
function field(node: object, name: string): unknown {
  return Reflect.get(node, name);
}

function parts(value: unknown): object[] {
  return Array.isArray(value)
    ? value.filter((part): part is object => typeof part === 'object' && part !== null)
    : [];
}

/** A value as Markdown code. */
function code(value: unknown): string {
  return `\`${String(value)}\``;
}

/** A message of a Valibot check, as part of a sentence. */
function rule(message: unknown): string | undefined {
  return typeof message === 'string'
    ? message.charAt(0).toLowerCase() + message.slice(1)
    : undefined;
}

/**
 * The pattern of a regular expression for JSON Schema, which has no flags: with the flag `i`,
 * every letter becomes a class of both cases.
 * @param regex - The expression of a check.
 * @throws Error for other flags, and for escapes and groups whose letters must keep their case.
 */
export function patternOf(regex: RegExp): string {
  if (regex.flags === '') return regex.source;
  if (regex.flags !== 'i')
    throw new Error(`The reference cannot write the flags of ${String(regex)}`);
  const source = regex.source;
  const letter = /[a-z]/i;
  let pattern = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i);
    if (char === '\\') {
      const next = source.charAt(i + 1);
      if (/[uxcpPk]/.test(next))
        throw new Error(`The reference cannot fold \\${next} in ${String(regex)}`);
      pattern += char + next;
      i += 1;
    } else if (char === '(' && source.startsWith('(?<', i)) {
      throw new Error(`The reference cannot fold named groups in ${String(regex)}`);
    } else if (!letter.test(char)) {
      if (char === '[') inClass = true;
      if (char === ']') inClass = false;
      pattern += char;
    } else if (inClass && source.charAt(i + 1) === '-' && letter.test(source.charAt(i + 2))) {
      const end = source.charAt(i + 2);
      pattern += `${char.toLowerCase()}-${end.toLowerCase()}${char.toUpperCase()}-${end.toUpperCase()}`;
      i += 2;
    } else {
      const both = `${char.toLowerCase()}${char.toUpperCase()}`;
      pattern += inClass ? both : `[${both}]`;
    }
  }
  return pattern;
}

/**
 * Describes the value that a Valibot schema accepts. Transformations change only what the
 * browser makes of a value, so they do not count, and neither does what follows them, which
 * checks the value that the browser made; `policy-inputs.ts` describes the values of the
 * policies whose conversion matters, such as a search address with `{searchTerms}`.
 * @param schema - A schema, or a part of one.
 * @throws Error for a kind of schema or check that the reference does not know yet.
 */
export function shapeOf(schema: object): ValueShape {
  const [base, ...actions] = parts(field(schema, 'pipe'));
  if (base !== undefined) {
    const made = actions.findIndex((action) => field(action, 'type') === 'transform');
    return actions.slice(0, made === -1 ? undefined : made).reduce(withAction, shapeOf(base));
  }
  const type = field(schema, 'type');
  switch (type) {
    case 'boolean':
    case 'string':
    case 'number':
      return { json: { type }, type, rules: [] };
    case 'literal': {
      const literal = field(schema, 'literal');
      return {
        json: { const: literal },
        type: literal === '' ? 'empty' : code(literal),
        rules: [],
      };
    }
    case 'picklist': {
      const listed = field(schema, 'options');
      const options: unknown[] = Array.isArray(listed) ? [...listed] : [];
      const kind = options.every(Number.isInteger) ? 'integer' : 'string';
      return {
        json: { type: kind, enum: options },
        type: kind,
        rules: [`one of ${options.map(code).join(', ')}`],
      };
    }
    case 'union': {
      const options = parts(field(schema, 'options')).map(shapeOf);
      return {
        json: { anyOf: options.map((o) => o.json) },
        type: options.map(describe).join(' or '),
        rules: [],
      };
    }
    case 'array': {
      const [item] = parts([field(schema, 'item')]);
      if (item === undefined) throw new Error('A list without the schema of its entries');
      const entry = shapeOf(item);
      return {
        json: { type: 'array', items: entry.json },
        type: `list of ${entry.type}s`,
        rules: entry.rules.map((text) => `each ${text}`),
      };
    }
    default:
      throw new Error(`The policy reference does not know schemas of the type ${String(type)}`);
  }
}

function withAction(shape: ValueShape, action: object): ValueShape {
  const requirement = field(action, 'requirement');
  const message = rule(field(action, 'message'));
  const list = shape.json['type'] === 'array';
  const add = (json: JsonSchema, text?: string): ValueShape => ({
    json: { ...shape.json, ...json },
    type: shape.type,
    rules: text === undefined ? shape.rules : [...shape.rules, text],
  });
  const type = field(action, 'type');
  switch (type) {
    case 'max_length':
      return add(
        list ? { maxItems: requirement } : { maxLength: requirement },
        `at most ${amount(requirement, list)}`,
      );
    case 'min_length':
      return add(
        list ? { minItems: requirement } : { minLength: requirement },
        requirement === 1 ? 'not empty' : `at least ${amount(requirement, list)}`,
      );
    case 'min_value':
      return add({ minimum: requirement }, `at least ${String(requirement)}`);
    case 'max_value':
      return add({ maximum: requirement }, `at most ${String(requirement)}`);
    case 'integer':
      return { ...add({ type: 'integer' }), type: 'integer' };
    case 'url':
      return add({ format: 'uri' }, message ?? 'must be a URL');
    case 'regex': {
      if (!(requirement instanceof RegExp)) throw new Error('A regex check without an expression');
      const words = requirement.flags.includes('i') ? ', in any case' : '';
      return add(
        { pattern: patternOf(requirement) },
        message ?? `must match ${code(requirement.source)}${words}`,
      );
    }
    case 'check':
      if (message === undefined) throw new Error('A check of a policy needs a message');
      return add({}, message);
    default:
      throw new Error(`The policy reference does not know checks of the type ${String(type)}`);
  }
}

/** A number of the entries of a list or of the characters of a string, such as `1 entry`. */
function amount(requirement: unknown, list: boolean): string {
  const one = requirement === 1;
  return `${String(requirement)} ${list ? (one ? 'entry' : 'entries') : one ? 'character' : 'characters'}`;
}

/** A value shape in words, such as `string (at most 2048 characters)`. */
export function describe(shape: ValueShape): string {
  return shape.rules.length === 0 ? shape.type : `${shape.type} (${shape.rules.join('; ')})`;
}

/** The schema that a pipe starts with. */
function baseOf(schema: object): object {
  const [base] = parts(field(schema, 'pipe'));
  return base === undefined ? schema : baseOf(base);
}

/**
 * The value of the examples of a policy: the one of its notes, or the opposite of the
 * setting's default for a boolean, or the last value of a choice.
 * @param policy - The policy.
 * @param note - Its texts.
 * @param defaults - The defaults of the settings, by key.
 * @throws Error when the policy needs an example in its notes, or the example is not valid.
 */
export function exampleOf(
  policy: PolicyDefinition<unknown>,
  note: PolicyNote,
  defaults: ReadonlyMap<string, unknown>,
): unknown {
  const base = baseOf(policy.schema);
  const fallback = defaults.get(policy.setting ?? '');
  const options = field(base, 'options');
  let example = note.example;
  if (example === undefined && field(base, 'type') === 'boolean') {
    example = typeof fallback === 'boolean' ? !fallback : false;
  } else if (
    example === undefined &&
    field(base, 'type') === 'picklist' &&
    Array.isArray(options)
  ) {
    example = options.at(-1);
  }
  if (example === undefined) {
    throw new Error(`${policy.name} needs an example in tools/policies/notes.ts`);
  }
  for (const schema of [policy.schema, policyInputs.get(policy.name)]) {
    const result = schema?.['~standard'].validate(example);
    if (result instanceof Promise)
      throw new Error(`${policy.name} checks its value asynchronously`);
    if (result?.issues !== undefined) {
      throw new Error(
        `The example of ${policy.name} is not valid: ${result.issues[0]?.message ?? ''}`,
      );
    }
  }
  return example;
}

/** The texts of a policy. */
function noteOf(
  policy: PolicyDefinition<unknown>,
  notes: Readonly<Record<string, PolicyNote>>,
): PolicyNote {
  const note = notes[policy.name];
  if (note === undefined)
    throw new Error(`${policy.name} needs an entry in tools/policies/notes.ts`);
  return note;
}

function levelsOf(policy: PolicyDefinition<unknown>): string {
  return policy.recommended === true ? 'mandatory or recommended' : 'mandatory only';
}

/** A text in quotes for the command prompt. */
function quoted(text: string): string {
  if (text.includes('"') || text.endsWith('\\')) throw new Error(`Cannot quote ${text} for reg`);
  return `"${text}"`;
}

/** The lines of `reg add` that set a value below a key. */
function registryLines(key: string, name: string, value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(
      (entry, index) =>
        `reg add ${quoted(`${key}\\${name}`)} /v ${String(index + 1)} /t REG_SZ /d ${quoted(String(entry))} /f`,
    );
  }
  const typed =
    typeof value === 'boolean'
      ? `REG_DWORD /d ${value ? '1' : '0'}`
      : typeof value === 'number'
        ? `REG_DWORD /d ${String(value)}`
        : typeof value === 'string'
          ? `REG_SZ /d ${quoted(value)}`
          : undefined;
  if (typed === undefined) throw new Error(`${name}: the registry example has no type`);
  return [`reg add ${quoted(key)} /v ${name} /t ${typed} /f`];
}

/** Markdown without its code marks, for the descriptions of the schema. */
function plainText(text: string): string {
  return text.replaceAll('`', '');
}

function xml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** The lines of a property list that hold a value. */
function plistLines(value: unknown): string[] {
  if (typeof value === 'boolean') return [value ? '<true/>' : '<false/>'];
  if (typeof value === 'number' && Number.isInteger(value))
    return [`<integer>${String(value)}</integer>`];
  if (typeof value === 'string') return [`<string>${xml(value)}</string>`];
  if (Array.isArray(value)) {
    return ['<array>', ...value.flatMap(plistLines).map((line) => `  ${line}`), '</array>'];
  }
  throw new Error('The property list example has no type');
}

/** One policy as the reference shows it. */
interface Entry {
  readonly policy: PolicyDefinition<unknown>;
  readonly note: PolicyNote;
  readonly shape: ValueShape;
  readonly example: unknown;
}

function entriesOf(
  policies: readonly PolicyDefinition<unknown>[],
  notes: Readonly<Record<string, PolicyNote>>,
  defaults: ReadonlyMap<string, unknown>,
): Entry[] {
  const names = new Set(policies.map((policy) => policy.name));
  const orphan = Object.keys(notes).find((name) => !names.has(name));
  if (orphan !== undefined) throw new Error(`tools/policies/notes.ts names no policy ${orphan}`);
  return policies
    .toSorted((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((policy) => {
      const note = noteOf(policy, notes);
      // Where the browser converts a value first, the reference describes what it takes.
      return {
        policy,
        note,
        shape: shapeOf(policyInputs.get(policy.name) ?? policy.schema),
        example: exampleOf(policy, note, defaults),
      };
    });
}

function sectionOf(entry: Entry, brand: Brand): string {
  const { policy, note, shape, example } = entry;
  const policyKey = `HKLM\\SOFTWARE\\Policies\\${brand.productName}`;
  const windowsValue = note.windowsExample ?? example;
  return [
    `## ${policy.name}`,
    note.summary,
    [
      `- Value: ${describe(shape)}`,
      `- Levels: ${levelsOf(policy)}`,
      `- Sensitive: ${policy.sensitive === true ? 'yes, applies only from machine-wide mandatory sources' : 'no'}`,
      `- Restart needed: ${policy.restartRequired === true ? 'yes' : 'no'}`,
      `- Setting: ${policy.setting === undefined ? 'none' : code(policy.setting)}`,
    ].join('\n'),
    ...(note.details === undefined ? [] : [note.details]),
    `Linux, in a file in \`/etc/${brand.slug}/policies/managed/\`${policy.recommended === true ? ` or \`/etc/${brand.slug}/policies/recommended/\`` : ''}:`,
    ['```json', JSON.stringify({ [policy.name]: example }, null, 2), '```'].join('\n'),
    'Windows:',
    ['```bat', ...registryLines(policyKey, policy.name, windowsValue), '```'].join('\n'),
    `macOS, in a configuration profile for \`${brand.appId}\`:`,
    ['```xml', `<key>${policy.name}</key>`, ...plistLines(example), '```'].join('\n'),
  ].join('\n\n');
}

/**
 * The Markdown of the policy reference, before formatting.
 * @param policies - Every policy of the browser.
 * @param notes - The texts of the policies.
 * @param brand - The names of the product.
 * @param defaults - The defaults of the settings, by key.
 */
export function referenceMarkdown(
  policies: readonly PolicyDefinition<unknown>[],
  notes: Readonly<Record<string, PolicyNote>>,
  brand: Brand,
  defaults: ReadonlyMap<string, unknown>,
): string {
  const entries = entriesOf(policies, notes, defaults);
  const root = `/etc/${brand.slug}/policies`;
  return [
    '# Policy reference',
    `This page lists every policy of ${brand.productName}. \`tools/policies/reference.ts\` writes it from the policy definitions of the browser, and \`pnpm verify\` fails when it no longer matches them. The [admin guide](README.md) says where the policies are stored, which value wins and how to check that they apply. The [JSON Schema](policies.schema.json) of the policy files of Linux lists the same policies.`,
    `A policy that is not on this page is unknown to this version. The browser ignores it, as it ignores every value that is not valid, and writes a \`Policy value ignored\` record to its log.`,
    [
      `- **Levels:** a mandatory policy sets a value and locks it; a recommended policy sets the value that people start from and may change. A policy that is mandatory only is ignored as a recommended value. On macOS, every value of a configuration profile is mandatory.`,
      `- **Sensitive:** a sensitive policy applies only from machine-wide mandatory sources: \`HKLM\` on Windows, a profile for the whole computer on macOS, and the files in \`${root}/managed/\` on Linux.`,
      `- **Restart needed:** the policy takes effect when the browser starts again.`,
      `- **Windows:** booleans are \`REG_DWORD\` values \`1\` or \`0\`, numbers \`REG_DWORD\`, and texts \`REG_SZ\`. A list is a key named after the policy, with the entries as \`REG_SZ\` values named \`1\`, \`2\` and so on. Recommended values go below the key \`Recommended\`. The \`reg add\` lines are for a command prompt of an administrator; in a batch file, write every \`%\` twice.`,
    ].join('\n'),
    [
      '| Policy | Setting | Levels | Sensitive |',
      '| --- | --- | --- | --- |',
      ...entries.map(
        ({ policy }) =>
          `| [${policy.name}](#${policy.name.toLowerCase()}) | ${policy.setting === undefined ? '' : code(policy.setting)} | ${levelsOf(policy)} | ${policy.sensitive === true ? 'yes' : 'no'} |`,
      ),
    ].join('\n'),
    ...entries.map((entry) => sectionOf(entry, brand)),
  ].join('\n\n');
}

/**
 * The JSON Schema of the policy files of Linux. It refuses names that the browser does not
 * know, so an editor marks them.
 * @param policies - Every policy of the browser.
 * @param notes - The texts of the policies.
 * @param brand - The names of the product.
 * @param defaults - The defaults of the settings, by key.
 */
export function referenceSchema(
  policies: readonly PolicyDefinition<unknown>[],
  notes: Readonly<Record<string, PolicyNote>>,
  brand: Brand,
  defaults: ReadonlyMap<string, unknown>,
): JsonSchema {
  const root = `/etc/${brand.slug}/policies`;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${brand.productName} policies`,
    description: `A policy file of ${brand.productName} on Linux, in ${root}/managed/ for mandatory or ${root}/recommended/ for recommended policies. Written by tools/policies/reference.ts; docs/admin/policies.md describes every policy.`,
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      entriesOf(policies, notes, defaults).map(({ policy, note, shape, example }) => [
        policy.name,
        {
          description: plainText(
            [
              note.summary,
              note.details,
              policy.recommended === true ? undefined : 'Mandatory only.',
              policy.sensitive === true ? 'Sensitive: applies only from managed/.' : undefined,
              policy.restartRequired === true ? 'Takes effect after a restart.' : undefined,
            ]
              .filter((text) => text !== undefined)
              .join(' '),
          ),
          ...shape.json,
          examples: [example],
        },
      ]),
    ),
  };
}

/**
 * The files of the reference, formatted as Prettier formats them in the repository.
 * @param root - The root of the repository.
 * @returns The content of each file, by its path in the repository.
 */
export async function referenceFiles(root: string): Promise<Map<string, string>> {
  const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8')) as Brand;
  const defaults = new Map<string, unknown>(
    coreSettings.map((setting) => [setting.key, setting.default]),
  );
  const raw: [string, string][] = [
    [referencePaths.markdown, referenceMarkdown(allPolicies, policyNotes, brand, defaults)],
    [
      referencePaths.schema,
      JSON.stringify(referenceSchema(allPolicies, policyNotes, brand, defaults)),
    ],
  ];
  const files = new Map<string, string>();
  for (const [path, text] of raw) {
    const filepath = join(root, path);
    const options = (await prettier.resolveConfig(filepath)) ?? {};
    files.set(path, await prettier.format(text, { ...options, filepath }));
  }
  return files;
}

/**
 * The files that differ from what the reference writes, or that are missing.
 * @param root - The root of the repository.
 * @param files - The files of the reference, by their path in the repository.
 */
export function staleFiles(root: string, files: ReadonlyMap<string, string>): string[] {
  return [...files].flatMap(([path, text]) => {
    try {
      return readFileSync(join(root, path), 'utf8') === text ? [] : [path];
    } catch {
      return [path];
    }
  });
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '../..');
  const files = await referenceFiles(root);
  if (process.argv.includes('--check')) {
    const stale = staleFiles(root, files);
    if (stale.length > 0) {
      console.error(
        `Out of date: ${stale.join(', ')}. Run node tools/policies/reference.ts and commit the result.`,
      );
      process.exitCode = 1;
    } else {
      console.log('The policy reference matches the policy definitions.');
    }
  } else {
    for (const [path, text] of files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    console.log(`Wrote ${[...files.keys()].join(' and ')}.`);
  }
}
