import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { entries } from './workflow-scripts.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/merge.yml'), 'utf8');

/** The script of the step of merge.yml that runs failed CI jobs again. */
function rerunScript(): string {
  const read = entries(workflow);
  const id = read.find((entry) => entry.path.at(-1) === 'id' && entry.value === 'rerun');
  assert.ok(id, 'merge.yml has a step with the id rerun');
  const step = id.path.slice(0, -1).join('.');
  const script = read.find(
    (entry) => entry.path.slice(0, -1).join('.') === step && entry.path.at(-1) === 'run',
  );
  assert.ok(script, 'the rerun step has a script');
  return script.value;
}

// gh answers from the files of the case and records what the script posts; sleep returns at once.
const gh = `#!/usr/bin/env bash
shift
post=; expr=.; path=
while (($#)); do
  case $1 in
    --paginate) shift ;;
    -X) post=$2; shift 2 ;;
    --jq) expr=$2; shift 2 ;;
    *) path=$1; shift ;;
  esac
done
if [[ -n $post ]]; then echo "$post $path" >>"$CASE/calls"; exit 0; fi
case $path in
  */attempts/*/jobs*) file=jobs.json ;;
  */annotations) id=\${path%/annotations}; file=annotations-\${id##*/}.json ;;
  *) file=run.json ;;
esac
jq -r "$expr" "$CASE/$file"
`;

const folders: string[] = [];
after(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

interface Job {
  readonly id: number;
  readonly name: string;
  readonly conclusion: string;
  readonly steps: readonly {
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
  }[];
  readonly annotations: readonly string[];
}

function run(jobs: readonly Job[], attempt = 1): { output: string; reran: boolean } {
  const folder = mkdtempSync(join(tmpdir(), 'merge-rerun-'));
  folders.push(folder);
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), gh);
  writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\n');
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'sleep'), 0o755);
  writeFileSync(
    join(folder, 'jobs.json'),
    JSON.stringify({
      jobs: jobs.map(({ id, name, conclusion, steps }) => ({ id, name, conclusion, steps })),
    }),
  );
  for (const job of jobs) {
    writeFileSync(
      join(folder, `annotations-${job.id}.json`),
      JSON.stringify(job.annotations.map((message) => ({ annotation_level: 'failure', message }))),
    );
  }
  writeFileSync(
    join(folder, 'run.json'),
    JSON.stringify({ run_attempt: attempt + 1, status: 'completed', conclusion: 'success' }),
  );
  const result = spawnSync('bash', ['-c', rerunScript()], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
      CASE: folder,
      REPOSITORY: 'owner/repo',
      RUN_ID: '1',
      ATTEMPT: String(attempt),
      GITHUB_OUTPUT: join(folder, 'output'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return { output: result.stdout, reran: existsSync(join(folder, 'calls')) };
}

const limit = 'The job has exceeded the maximum execution time of 25m0s';

describe('the rerun step of merge.yml', () => {
  it('runs a job again whose runner stopped answering while a step ran', () => {
    const { output, reran } = run([
      {
        id: 7,
        name: 'smoke (windows-x64-msi)',
        conclusion: 'cancelled',
        steps: [
          { name: 'Set up job', status: 'completed', conclusion: 'success' },
          {
            name: 'Install, start and remove each package',
            status: 'in_progress',
            conclusion: null,
          },
        ],
        annotations: [limit],
      },
    ]);
    assert.match(output, /Lost its runner: smoke \(windows-x64-msi\)/);
    assert.ok(reran);
  });

  it('keeps the failure of a job whose test failed before its runner was lost', () => {
    // Job 131478536154 of run 43301479946: the MSI test failed, then the runner stopped answering.
    const { output, reran } = run([
      {
        id: 8,
        name: 'smoke (windows-x64-msi)',
        conclusion: 'cancelled',
        steps: [
          { name: 'Set up job', status: 'completed', conclusion: 'success' },
          {
            name: 'Install, start and remove each package',
            status: 'completed',
            conclusion: 'failure',
          },
          { name: 'Post Run actions/checkout@v7', status: 'in_progress', conclusion: null },
        ],
        annotations: [limit],
      },
    ]);
    assert.match(
      output,
      /A job failed after it started: smoke \(windows-x64-msi\); the failure stands\./,
    );
    assert.ok(!reran);
  });

  it('runs a job again that never got a runner', () => {
    const { output, reran } = run([
      { id: 9, name: 'e2e (macos-15)', conclusion: 'failure', steps: [], annotations: [] },
    ]);
    assert.match(output, /Never got a runner: e2e \(macos-15\)/);
    assert.ok(reran);
  });

  it('runs a job again that again got no runner, while GitHub has too few', () => {
    // Run 43912342222: package (macos) got no runner in its first two attempts.
    const { output, reran } = run(
      [{ id: 10, name: 'package (macos)', conclusion: 'cancelled', steps: [], annotations: [] }],
      2,
    );
    assert.match(output, /Never got a runner: package \(macos\)/);
    assert.match(output, /Attempt 3 ended with success\./);
    assert.ok(reran);
  });

  it('runs the jobs of a CI run again after its first and its second attempt only', () => {
    const condition = entries(workflow).find((entry) => entry.path.join('.') === 'jobs.rerun.if');
    assert.match(condition?.value ?? '', /github\.event\.workflow_run\.run_attempt < 3 &&/);
  });

  it('keeps the failure of a second attempt whose runner was lost', () => {
    const { output, reran } = run(
      [
        {
          id: 11,
          name: 'smoke (windows-x64-msi)',
          conclusion: 'cancelled',
          steps: [
            { name: 'Set up job', status: 'completed', conclusion: 'success' },
            {
              name: 'Install, start and remove each package',
              status: 'in_progress',
              conclusion: null,
            },
          ],
          annotations: [limit],
        },
      ],
      2,
    );
    assert.match(output, /the failure stands\./);
    assert.ok(!reran);
  });
});
