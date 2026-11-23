import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { coreSettings } from '../../app/src/main/core-settings.ts';
import { allPolicies } from '../../app/src/main/policy-definitions.ts';
import { policyNotes } from './notes.ts';
import {
  exampleOf,
  patternOf,
  referenceFiles,
  referenceMarkdown,
  referencePaths,
  referenceSchema,
  shapeOf,
  staleFiles,
  type JsonSchema,
} from './reference.ts';

const root = resolve(import.meta.dirname, '../..');
const brand = { productName: 'Astela', slug: 'astela', appId: 'io.github.secoolioo.astela' };
const defaults = new Map<string, unknown>(
  coreSettings.map((setting) => [setting.key, setting.default]),
);
const schema = referenceSchema(allPolicies, policyNotes, brand, defaults);

function get(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/**
 * Whether a value matches a JSON Schema, for the keywords that the reference writes. Every
 * other keyword fails, so a new one needs a check here first.
 */
function matches(node: unknown, value: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  return Object.entries(node).every(([keyword, rule]) => {
    switch (keyword) {
      case '$schema':
      case 'title':
      case 'description':
      case 'examples':
      case 'format':
        return true;
      case 'type':
        return rule === 'integer'
          ? Number.isInteger(value)
          : rule === 'array'
            ? Array.isArray(value)
            : rule === 'object'
              ? typeof value === 'object' && value !== null && !Array.isArray(value)
              : typeof value === rule;
      case 'enum':
        return Array.isArray(rule) && rule.includes(value);
      case 'const':
        return value === rule;
      case 'anyOf':
        return Array.isArray(rule) && rule.some((option) => matches(option, value));
      case 'items':
        return !Array.isArray(value) || value.every((item) => matches(rule, item));
      case 'maxItems':
        return !Array.isArray(value) || value.length <= Number(rule);
      case 'maxLength':
        return typeof value !== 'string' || value.length <= Number(rule);
      case 'minimum':
        return typeof value !== 'number' || value >= Number(rule);
      case 'maximum':
        return typeof value !== 'number' || value <= Number(rule);
      case 'pattern':
        return typeof value !== 'string' || new RegExp(String(rule), 'u').test(value);
      case 'properties':
        return Object.entries(value ?? {}).every(
          ([name, item]) => get(rule, name) === undefined || matches(get(rule, name), item),
        );
      case 'additionalProperties':
        return (
          rule !== false ||
          Object.keys(value ?? {}).every((name) => get(get(node, 'properties'), name) !== undefined)
        );
      default:
        return false;
    }
  });
}

describe('the policy reference', () => {
  it('lists every policy of the browser in the page and in the schema', () => {
    const markdown = referenceMarkdown(allPolicies, policyNotes, brand, defaults);
    for (const policy of allPolicies) {
      assert.match(markdown, new RegExp(`^## ${policy.name}$`, 'm'));
    }
    assert.deepEqual(
      Object.keys(get(schema, 'properties') ?? {}).toSorted(),
      allPolicies.map((policy) => policy.name).toSorted(),
    );
  });

  it('says which policies take effect only at the next start', () => {
    const markdown = referenceMarkdown(allPolicies, policyNotes, brand, defaults);
    const restart = (name: string): string | undefined =>
      new RegExp(`^## ${name}$[\\s\\S]*?^- Restart needed: (\\w+)$`, 'm').exec(markdown)?.[1];
    // The update service reads its policies once, when it is created after the first window
    // loads, so a running browser does not follow a change of them.
    for (const name of [
      'UpdatePolicy',
      'TargetChannel',
      'TargetVersionPrefix',
      'UpdateURL',
      'AutoUpdateCheckPeriodMinutes',
    ]) {
      assert.equal(restart(name), 'yes', name);
      assert.match(String(get(get(get(schema, 'properties'), name), 'description')), /restart/);
    }
    assert.equal(restart('ApplicationLocaleValue'), 'yes');
    assert.equal(restart('ShowHomeButton'), 'no');
  });

  it('writes a schema that accepts the documented examples', () => {
    for (const policy of allPolicies) {
      const example = exampleOf(policy, policyNotes[policy.name] ?? { summary: '' }, defaults);
      assert.ok(
        matches(schema, { [policy.name]: example }),
        `${policy.name}: ${JSON.stringify(example)}`,
      );
    }
    assert.ok(
      matches(schema, {
        ShowHomeButton: true,
        HomepageLocation: '',
        HttpAllowlist: ['Intranet.Example.com', '[*.]example.org'],
        RestoreOnStartup: 5,
        AutoUpdateCheckPeriodMinutes: 60,
      }),
    );
  });

  it('writes a schema that refuses unknown names and wrong values', () => {
    const refused: JsonSchema[] = [
      // Chrome knows it; this version does not.
      { NewTabPageLocation: 'https://intranet.example.com/' },
      { showHomeButton: true },
      { ShowHomeButton: 'yes' },
      { RestoreOnStartup: 2 },
      { DeveloperToolsAvailability: '2' },
      { AutoUpdateCheckPeriodMinutes: 30 },
      { AutoUpdateCheckPeriodMinutes: 90.5 },
      { HomepageLocation: 'javascript:alert(1)' },
      { RestoreOnStartupURLs: 'https://intranet.example.com/' },
      { DefaultSearchProviderSearchURL: 'http://search.example.com/?q=%s' },
      { HttpAllowlist: ['intranet example'] },
    ];
    for (const file of refused) {
      assert.equal(matches(schema, file), false, JSON.stringify(file));
    }
  });

  it('refuses a policy without texts, texts without a policy and an example that is not valid', () => {
    const [first] = allPolicies;
    assert.ok(first !== undefined);
    assert.throws(
      () =>
        referenceMarkdown(
          [...allPolicies, { ...first, name: 'MadeUpPolicy' }],
          policyNotes,
          brand,
          defaults,
        ),
      /MadeUpPolicy needs an entry in tools\/policies\/notes\.ts/,
    );
    assert.throws(
      () =>
        referenceMarkdown(
          allPolicies,
          { ...policyNotes, MadeUpPolicy: { summary: 'x' } },
          brand,
          defaults,
        ),
      /names no policy MadeUpPolicy/,
    );
    const home = allPolicies.find((policy) => policy.name === 'HomepageLocation');
    assert.ok(home !== undefined);
    assert.throws(
      () => exampleOf(home, { summary: 'x', example: 'intranet' }, defaults),
      /The example of HomepageLocation is not valid/,
    );
    assert.throws(() => exampleOf(home, { summary: 'x' }, defaults), /needs an example/);
  });

  it('describes the values of a schema and refuses kinds it does not know', () => {
    const update = allPolicies.find((policy) => policy.name === 'AutoUpdateCheckPeriodMinutes');
    assert.ok(update !== undefined);
    assert.deepEqual(shapeOf(update.schema), {
      json: { type: 'integer', minimum: 60, maximum: 43_200 },
      type: 'integer',
      rules: ['at least 60', 'at most 43200'],
    });
    assert.throws(() => shapeOf({ type: 'object' }), /does not know schemas of the type object/);
    assert.throws(
      () =>
        shapeOf({
          type: 'string',
          pipe: [{ type: 'string' }, { kind: 'validation', type: 'email' }],
        }),
      /does not know checks of the type email/,
    );
  });

  it('folds the case of letters in patterns', () => {
    assert.equal(patternOf(/^a.b$/), '^a.b$');
    assert.equal(patternOf(/^https?:\/\/\S+$/i), '^[hH][tT][tT][pP][sS]?:\\/\\/\\S+$');
    assert.equal(patternOf(/^[a-z0-9-]+x$/i), '^[a-zA-Z0-9-]+[xX]$');
    const folded = new RegExp(patternOf(/^(?:\[\*\.\]|\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i), 'u');
    assert.ok(folded.test('[*.]Example.ORG'));
    assert.ok(!folded.test('a b'));
    assert.throws(() => patternOf(/a/g), /cannot write the flags/);
    assert.throws(() => patternOf(/\x41/i), /cannot fold/);
  });

  it('finds files that are out of date or missing', async () => {
    const files = await referenceFiles(root);
    assert.deepEqual([...files.keys()], [referencePaths.markdown, referencePaths.schema]);
    const folder = mkdtempSync(join(tmpdir(), 'policy-reference-'));
    try {
      assert.deepEqual(staleFiles(folder, files), [referencePaths.markdown, referencePaths.schema]);
      for (const [path, text] of files) {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), text);
      }
      assert.deepEqual(staleFiles(folder, files), []);
      writeFileSync(join(folder, referencePaths.schema), '{}\n');
      assert.deepEqual(staleFiles(folder, files), [referencePaths.schema]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
    // The files in the repository are the ones that the reference writes.
    assert.deepEqual(staleFiles(root, files), []);
  });
});
