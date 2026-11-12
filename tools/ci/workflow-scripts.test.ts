import { strict as assert } from 'node:assert';
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
  it('run only scripts that exist in the folder of their step', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    assert.deepEqual(missingScripts(root), []);
  });
});
