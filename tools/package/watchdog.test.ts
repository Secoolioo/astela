import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { entries } from '../ci/workflow-scripts.ts';
import { parsePs, processTree, reportAndStopMs, supervise } from './watchdog.ts';

const windows = process.platform === 'win32';
const watchdog = fileURLToPath(new URL('./watchdog.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'watchdog-test-'));
// The processes of the fixtures that a test saw end. Windows soon gives the number of an ended
// process to another one, so only the others are stopped after the tests, when a test failed.
const gone = new Set<number>();
after(() => {
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.pid'))) {
    const pid = recorded(join(dir, name))();
    if (pid === undefined || gone.has(pid) || !running(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already stopped.
    }
  }
  try {
    // Windows keeps the program of a stopped process locked for a moment.
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  } catch (error) {
    console.error(`${dir} could not be removed: ${String(error)}`);
  }
});

function script(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

// Runs until it is killed and ignores SIGTERM, as a hung installer or browser helper can.
const forever = script(
  'forever.mjs',
  "process.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n",
);

// On Windows only its program name ties a process whose parent has exited to the command, so
// that process runs as a copy of Node.js with a name of its own.
const orphanProgram = windows ? join(dir, 'watchdog-orphan.exe') : process.execPath;
if (windows) {
  copyFileSync(process.execPath, orphanProgram);
  // The first start of a new program can wait for a scan of it; the tests then start it at once.
  spawnSync(orphanProgram, ['-e', ''], { timeout: 60_000, windowsHide: true });
}
const images = windows ? [basename(orphanProgram)] : [];

// The deadline of the hanging fixtures: they start four processes, which takes longer on Windows.
const hangDeadlineMs = windows ? 6000 : 3000;

const record = `const record = (file, pid) => {
  writeFileSync(file + '.part', String(pid));
  renameSync(file + '.part', file);
};`;

// On Windows, Node.js ties each process it starts without detaching it to a job object that
// ends the process with its parent. The fixtures therefore detach there the processes that
// must outlive their parent; on POSIX those stay in the process group of the command.
const outlives = "detached: process.platform === 'win32'";

// Starts a process that keeps its output and, on POSIX, its process group, and exits at once.
const parent = script(
  'parent.mjs',
  `import { spawn } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
${record}
const [program, file] = process.argv.slice(2);
const child = spawn(program, [${JSON.stringify(forever)}], {
  ${outlives},
  stdio: 'inherit',
  windowsHide: true,
});
record(file, child.pid);
process.exit(0);
`,
);

// The supervised command: it names a phase and a log, as smoke.ts does, and starts a helper in
// a process group of its own that keeps the output open. Then it either hangs, ignoring SIGTERM,
// after it left a helper whose parent has exited, or it exits with 3 while one more process
// still writes a line.
const commandScript = script(
  'command.mjs',
  `import { spawn, spawnSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
${record}
const [mode, log, commandFile, helperFile, orphanFile] = process.argv.slice(2);
record(commandFile, process.pid);
console.log('## install');
console.log('## log ' + log);
const helper = spawn(process.execPath, [${JSON.stringify(forever)}], {
  detached: true,
  stdio: 'inherit',
  windowsHide: true,
});
record(helperFile, helper.pid);
if (mode === 'hang') {
  spawnSync(process.execPath, [${JSON.stringify(parent)}, ${JSON.stringify(orphanProgram)}, orphanFile], {
    stdio: 'inherit',
    windowsHide: true,
  });
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  spawn(process.execPath, ['-e', "setTimeout(() => console.log('late line'), 200)"], {
    ${outlives},
    stdio: 'inherit',
    windowsHide: true,
  });
  console.error('Error: the last words');
  process.exit(3);
}
`,
);

interface Fixture {
  /** The arguments of Node.js that run the command. */
  readonly args: readonly string[];
  /** The command itself, once it runs. */
  readonly command: () => number | undefined;
  /** The helper in a process group of its own, once it runs. */
  readonly helper: () => number | undefined;
  /** The helper whose parent has exited, once it runs. */
  readonly orphan: () => number | undefined;
}

/** Reads the process that a fixture wrote to a file, once it has. */
function recorded(file: string): () => number | undefined {
  return () => {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    const value = Number(text);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };
}

let fixtures = 0;

function fixture(mode: 'hang' | 'exit'): Fixture {
  fixtures += 1;
  const name = `${mode}-${String(fixtures)}`;
  const log = join(dir, `${name}.log`);
  // Windows Installer writes its log as UTF-16 with a byte order mark.
  writeFileSync(
    log,
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(
        'MSI (s) (1C:2C) [12:00:00:000]: Action start 12:00:00: InstallFiles.\r\n',
        'utf16le',
      ),
    ]),
  );
  const files = ['command', 'helper', 'orphan'].map((role) => join(dir, `${name}-${role}.pid`));
  const [command, helper, orphan] = files.map(recorded);
  assert.ok(command !== undefined && helper !== undefined && orphan !== undefined);
  return { args: [commandScript, mode, log, ...files], command, helper, orphan };
}

/** Whether a process runs; a zombie that waits for its parent does not count. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (windows) return true;
  const state = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return state.stdout.trim() !== '' && !state.stdout.trim().startsWith('Z');
}

/** Waits until a process has ended; a stop takes effect a moment after it was sent. */
async function ended(name: string, pid: number | undefined): Promise<void> {
  assert.ok(pid !== undefined, `the ${name} did not start`);
  for (let tries = 0; tries < 100 && running(pid); tries++) await sleep(50);
  assert.equal(running(pid), false, `the ${name} ${String(pid)} still runs`);
  gone.add(pid);
}

/** Waits until every process of a fixture has ended. */
async function allEnded(run: Fixture): Promise<void> {
  await ended('command', run.command());
  await ended('helper', run.helper());
  await ended('helper without a parent', run.orphan());
}

// How the tests run the watchdog as a command. spawnSync sends its kill signal once, and the
// watchdog handles SIGTERM, so a watchdog that does not end fails the test instead of blocking it.
const cliOptions = { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' } as const;

describe('processTree', () => {
  it('lists the processes below a root, children before their parents', () => {
    const rows = parsePs(
      '    1     0     1\n   10     1    10\n   11    10    10\n   12    11    10\n   20     1    20\n   13    10    13\n',
    );
    assert.deepEqual(processTree(rows, 10), [12, 11, 13, 10]);
    assert.deepEqual(processTree(rows, 99), [99]);
  });
});

describe('supervise', () => {
  it(
    'stops a hung command and every process it started at the deadline, and reports how far it got',
    { timeout: 60_000 },
    async () => {
      const run = fixture('hang');
      const lines: string[] = [];
      const begin = Date.now();
      const result = await supervise({
        command: process.execPath,
        args: run.args,
        deadlineMs: hangDeadlineMs,
        images,
        write: (line) => lines.push(line),
      });
      const took = Date.now() - begin;
      const output = lines.join('\n');
      assert.deepEqual(
        { code: result.code, timedOut: result.timedOut, phase: result.phase },
        { code: 124, timedOut: true, phase: 'install' },
      );
      // The line arrived as it came, with the seconds since the start.
      assert.match(output, /^\[\s+\d+\.\d s\] ## install$/m);
      assert.match(output, /^::error::No result after \d+ s; last phase: install$/m);
      assert.match(output, /Action start 12:00:00: InstallFiles\./);
      // Both helpers keep the output open; the watchdog stops them and waits for no pipe.
      assert.ok(took < hangDeadlineMs + 15_000, `took ${String(took)} ms`);
      for (const pid of [run.helper(), run.orphan()]) {
        assert.ok(
          pid !== undefined && result.stopped.includes(pid),
          `${String(pid)} was not stopped: ${result.stopped.join(' ')}`,
        );
      }
      await allEnded(run);
    },
  );

  it(
    'passes the exit code on with the last lines, without waiting for a helper that keeps the output open',
    { timeout: 60_000 },
    async () => {
      const run = fixture('exit');
      const lines: string[] = [];
      const begin = Date.now();
      const result = await supervise({
        command: process.execPath,
        args: run.args,
        deadlineMs: 30_000,
        write: (line) => lines.push(line),
      });
      const took = Date.now() - begin;
      const output = lines.join('\n');
      assert.deepEqual(
        { code: result.code, timedOut: result.timedOut },
        { code: 3, timedOut: false },
      );
      assert.match(output, /Error: the last words/);
      assert.match(output, /late line/);
      assert.ok(took < 10_000, `took ${String(took)} ms`);
      await ended('command', run.command());
      // The runner stops what is left at the end of the job; here the test does.
      const helper = run.helper();
      if (helper !== undefined && running(helper)) process.kill(helper, 'SIGKILL');
      await ended('helper', helper);
    },
  );

  it('works as the command of a CI step', { timeout: 60_000 }, async () => {
    const run = fixture('hang');
    const until = Math.ceil((Date.now() + hangDeadlineMs) / 1000);
    const cli = spawnSync(
      process.execPath,
      [
        watchdog,
        '--until',
        String(until),
        ...images.flatMap((image) => ['--image', image]),
        '--',
        process.execPath,
        ...run.args,
      ],
      cliOptions,
    );
    assert.equal(cli.error, undefined);
    assert.equal(cli.status, 124, `${cli.stdout}${cli.stderr}`);
    assert.match(cli.stdout, /^::error::No result after \d+ s; last phase: install$/m);
    await allEnded(run);
  });

  it(
    'stops the command although the tools that list and stop processes fail',
    { timeout: 60_000 },
    async () => {
      const run = fixture('hang');
      const until = Math.ceil((Date.now() + hangDeadlineMs) / 1000);
      // Without a search path, ps, tasklist, PowerShell, wevtutil and taskkill cannot start, as
      // when WMI, which tasklist and taskkill may use, does not answer.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
      );
      const cli = spawnSync(
        process.execPath,
        [
          watchdog,
          '--until',
          String(until),
          ...images.flatMap((image) => ['--image', image]),
          '--',
          process.execPath,
          ...run.args,
        ],
        { ...cliOptions, env: { ...env, PATH: join(dir, 'nowhere') } },
      );
      assert.equal(cli.error, undefined);
      assert.equal(cli.status, 124, `${cli.stdout}${cli.stderr}`);
      // On Windows, PowerShell lists the processes when tasklist fails.
      assert.match(cli.stdout, windows ? /\(pwsh failed: / : /\(ps failed: /);
      const stopped = /Stopped \d+ processes:((?: \d+)*)$/m.exec(cli.stdout)?.[1] ?? '';
      const command = run.command();
      assert.ok(
        command !== undefined && stopped.split(' ').includes(String(command)),
        `the command was not stopped: ${cli.stdout}`,
      );
      await ended('command', command);
      // Without those tools the watchdog reaches only the command and, on POSIX, its process
      // group; the test stops the helpers that are left.
      for (const [name, pid] of [
        ['helper', run.helper()],
        ['helper without a parent', run.orphan()],
      ] as const) {
        if (pid !== undefined && running(pid)) process.kill(pid, 'SIGKILL');
        await ended(name, pid);
      }
    },
  );

  it(
    'stops every process of the command when it is interrupted',
    {
      timeout: 60_000,
      skip: windows && 'Node.js cannot send Ctrl+C to a single process on Windows',
    },
    async () => {
      const run = fixture('hang');
      const until = Math.ceil(Date.now() / 1000) + 60;
      const cli = spawn(
        process.execPath,
        [watchdog, '--until', String(until), '--', process.execPath, ...run.args],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      cli.stdout.setEncoding('utf8');
      cli.stdout.on('data', (chunk: string) => {
        output += chunk;
      });
      const exited = new Promise<number | null>((done) => cli.on('exit', (code) => done(code)));
      for (let tries = 0; tries < 400 && run.orphan() === undefined; tries++) await sleep(50);
      assert.ok(run.orphan() !== undefined, `the command did not start its helpers: ${output}`);
      cli.kill('SIGINT');
      assert.equal(await exited, 130, output);
      assert.match(output, /Interrupted in phase install/);
      await allEnded(run);
    },
  );
});

describe('the smoke step of ci.yml', () => {
  // In the successful smoke jobs of 31 runs from 28 October to 12 November 2026, the steps
  // before the smoke step took up to 4.3 minutes and the steps after it up to 2; the upload of
  // the log follows them.
  const otherStepsMs = 8 * 60_000;

  it('ends a hang with the report of the watchdog before the runner would cancel the step', () => {
    const workflow = entries(
      readFileSync(
        fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url)),
        'utf8',
      ),
    );
    const value = (path: readonly string[]): string | undefined =>
      workflow.find((entry) => entry.path.join('/') === path.join('/'))?.value;
    const step = workflow.find(
      (entry) =>
        entry.path.length === 5 &&
        entry.path[1] === 'smoke' &&
        entry.path[4] === 'run' &&
        entry.value.includes('tools/package/smoke.ts'),
    );
    assert.ok(step !== undefined, 'the smoke job runs tools/package/smoke.ts');
    const jobMs = Number(value(['jobs', 'smoke', 'timeout-minutes'])) * 60_000;
    const stepMs = Number(value([...step.path.slice(0, 4), 'timeout-minutes'])) * 60_000;
    assert.ok(
      stepMs + otherStepsMs <= jobMs,
      `the smoke step may take ${String(stepMs / 60_000)} of the ${String(jobMs / 60_000)} minutes of the job, which leaves less than ${String(otherStepsMs / 60_000)} to the other steps`,
    );
    const seconds = /^deadline=\$\(\(\$\(date \+%s\) \+ (\d+)\)\)$/m.exec(step.value)?.[1];
    assert.ok(seconds !== undefined, 'the step sets one deadline for all its tests');
    const deadlineMs = Number(seconds) * 1000;
    assert.ok(
      deadlineMs + reportAndStopMs < stepMs,
      `the watchdog may need ${String((deadlineMs + reportAndStopMs) / 1000)} s, more than the ${String(stepMs / 1000)} s of the step`,
    );
    const tests = step.value.split('\n').filter((line) => line.includes('tools/package/smoke.ts'));
    assert.ok(tests.length > 0);
    for (const line of tests) {
      assert.match(
        line,
        /^\s*node tools\/package\/watchdog\.ts --until "\$deadline" (?:--image \S+ )*-- node tools\/package\/smoke\.ts /,
      );
    }
  });
});
