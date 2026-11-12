import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { entries, missingScripts, scriptUses } from './workflow-scripts.ts';

const workflow = `name: Test
defaults:
  run:
    working-directory: website
jobs:
  build:
    defaults:
      run:
        shell: bash
        working-directory: app
    steps:
      - uses: actions/checkout@v7 # tools/not-a-step.sh
      - name: In the folder of the job
        run: node tests/run.ts --out "$RUNNER_TEMP/out.js"
      - name: In the folder of the step
        working-directory: tools
        run: |
          # ci/commented.sh is not run
          ci/apt-install.sh xvfb
          bash ./ci/pull-images.sh https://example.com/remote.sh \${{ runner.temp }}/x/later.sh
      - run: >-
          ../tools/ci/folded.sh
  docs:
    steps:
      - run: 'node scripts/build.ts'
`;

describe('entries', () => {
  it('reads keys, sequence items, quoted values and block scalars', () => {
    const read = entries(workflow);
    assert.deepEqual(
      read.find((entry) => entry.path.join('.') === 'jobs.build.steps.[2].run')?.value.split('\n'),
      [
        '# ci/commented.sh is not run',
        'ci/apt-install.sh xvfb',
        'bash ./ci/pull-images.sh https://example.com/remote.sh ${{ runner.temp }}/x/later.sh',
      ],
    );
    assert.equal(
      read.find((entry) => entry.path.join('.') === 'jobs.build.steps.[0].uses')?.value,
      'actions/checkout@v7',
    );
    assert.equal(
      read.find((entry) => entry.path.join('.') === 'jobs.docs.steps.[0].run')?.value,
      'node scripts/build.ts',
    );
  });
});

describe('scriptUses', () => {
  it('resolves each script against the folder its step runs in', () => {
    assert.deepEqual(
      scriptUses(workflow).map((use) => [use.job, use.step, use.directory, use.path]),
      [
        ['build', 'In the folder of the job', 'app', 'app/tests/run.ts'],
        ['build', 'In the folder of the step', 'tools', 'tools/ci/apt-install.sh'],
        ['build', 'In the folder of the step', 'tools', 'tools/ci/pull-images.sh'],
        ['build', 'step 4', 'app', 'tools/ci/folded.sh'],
        ['docs', 'step 1', 'website', 'website/scripts/build.ts'],
      ],
    );
  });

  it('leaves out steps whose folder comes from an expression', () => {
    const text =
      'jobs:\n  a:\n    steps:\n      - working-directory: ${{ matrix.dir }}\n        run: x/y.sh\n';
    assert.deepEqual(scriptUses(text), []);
  });
});

describe('the workflows of this repository', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const folder = join(root, '.github', 'workflows');
  const workflows = readdirSync(folder).filter((name) => /\.ya?ml$/.test(name));

  it('run only scripts that exist in the folder of their step', () => {
    assert.deepEqual(missingScripts(root), []);
  });

  // install-lychee.sh puts lychee on the PATH through $GITHUB_PATH, which only the later
  // steps of the job see.
  it('install the link checker in a step before each step that checks links', () => {
    const missing: string[] = [];
    for (const name of workflows) {
      const runs = entries(readFileSync(join(folder, name), 'utf8')).filter(
        (entry) => entry.path[0] === 'jobs' && entry.path[2] === 'steps' && entry.path[4] === 'run',
      );
      for (const [index, entry] of runs.entries()) {
        if (!/\bpnpm verify\b|check-links\.sh/.test(entry.value)) continue;
        const job = entry.path[1];
        const installed = runs
          .slice(0, index)
          .some(
            (earlier) => earlier.path[1] === job && earlier.value.includes('install-lychee.sh'),
          );
        if (!installed) missing.push(`${name}: ${job ?? ''}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
