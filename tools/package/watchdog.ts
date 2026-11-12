/**
 * Runs a command under a deadline; CI runs each package smoke test with it. On Windows, the MSI
 * smoke test sometimes hung in a way that the runner could not cancel, and GitHub then completed
 * the job without its log, so where the test hung could not be seen; why it hung is not known.
 * The time limit of a step is no backstop for that, because the runner enforces it through the
 * same cancel. The watchdog therefore ends the command on its own, well before that limit, and
 * reports where it was: a safeguard and a diagnosis, not a fix of the hang.
 *
 * The command runs detached: in a process group of its own and, on Windows, without the
 * console of the runner, so nothing it starts shares that console or receives its Ctrl+C. Each
 * line of its output is forwarded as soon as it is complete, after the seconds since the start.
 * Lines `## <phase>` name the phase the command is in, and lines `## log <path>` name a log it
 * writes. At the deadline the watchdog reports the last phase, the last lines, the end of each
 * named log, the running processes and, on Windows, the events of Windows Installer. It then
 * stops the command and every process below it, waits up to two seconds for the output to end
 * and exits with 124, without waiting for output that a leftover process keeps open. When it is
 * interrupted, it stops them as well and exits with 130.
 *
 * Usage: `node tools/package/watchdog.ts --until <unix seconds> [--image <program>]... --
 * <command> [args...]`, where each `--image` names a program whose processes are stopped by
 * name on Windows as well, such as the browser's helpers whose browser has already exited.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { parseArgs } from 'node:util';

/** Milliseconds that each command of the report or of the stop may take. */
export const commandTimeoutMs = 15_000;

/** Milliseconds that the watchdog waits for the output to end once the command ended or stopped. */
export const closeWaitMs = 2000;

/**
 * The longest time from the deadline until the watchdog exits: five commands at most (on
 * Windows tasklist, PowerShell if tasklist fails, the events and two calls of taskkill), the
 * wait for the output and a few seconds for reading the logs and writing the report.
 */
export const reportAndStopMs = 5 * commandTimeoutMs + closeWaitMs + 3000;

/** How many lines of output the report repeats. */
const lastLineCount = 30;

/** How many lines of each log the report shows. */
const logLineCount = 60;

/** A process of a snapshot of `ps`. */
export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
}

/** What {@link supervise} runs and where its output goes. */
export interface SuperviseOptions {
  readonly command: string;
  readonly args: readonly string[];
  /** Milliseconds from the start until the command is stopped. */
  readonly deadlineMs: number;
  /** Programs whose processes are also stopped by name on Windows, such as `astela.exe`. */
  readonly images?: readonly string[];
  /** Stops the command early, as when the watchdog itself is interrupted. */
  readonly signal?: AbortSignal;
  /** Receives each line of output and of the report; by default standard output. */
  readonly write?: (line: string) => void;
}

/** How a supervised command ended. */
export interface SuperviseResult {
  /** The exit code of the command, or 124 at the deadline and 130 when interrupted. */
  readonly code: number;
  readonly timedOut: boolean;
  /** The last phase the command named. */
  readonly phase: string | undefined;
  /** The processes that the watchdog stopped. */
  readonly stopped: readonly number[];
}

/**
 * Parses the output of `ps -A -o pid=,ppid=,pgid=`.
 * @param text - The output.
 */
export function parsePs(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    const [pid, ppid, pgid, ...rest] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || pgid === undefined || rest.length > 0) continue;
    if ([pid, ppid, pgid].every(Number.isInteger)) rows.push({ pid, ppid, pgid });
  }
  return rows;
}

/**
 * Every process below `root` in a snapshot, children before their parents and `root` last.
 * @param rows - The snapshot.
 * @param root - The process at the top.
 */
export function processTree(rows: readonly ProcessRow[], root: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    const list = children.get(row.ppid);
    if (list === undefined) children.set(row.ppid, [row.pid]);
    else list.push(row.pid);
  }
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (pid: number): void => {
    if (seen.has(pid)) return;
    seen.add(pid);
    for (const child of children.get(pid) ?? []) visit(child);
    order.push(pid);
  };
  visit(root);
  return order;
}

/**
 * The last lines of a log. Windows Installer writes its logs in UTF-16 with a byte order mark.
 * @param path - The log.
 */
function logTail(path: string): string[] {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    return [`(cannot be read: ${error instanceof Error ? error.message : String(error)})`];
  }
  const text =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8');
  return text.trimEnd().split(/\r?\n/).slice(-logLineCount);
}

/**
 * Runs a command of the report or of the stop, without a window and the runner's console.
 * @returns Its output, or why there is none.
 */
function capture(command: string, args: readonly string[]): string[] {
  return captureOrFail(command, args).lines;
}

function captureOrFail(
  command: string,
  args: readonly string[],
): { readonly lines: string[]; readonly failed: boolean } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: commandTimeoutMs,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
  const lines = output === '' ? [] : output.split(/\r?\n/);
  if (result.error !== undefined) {
    return { lines: [...lines, `(${command} failed: ${result.error.message})`], failed: true };
  }
  return { lines, failed: result.status !== 0 };
}

/**
 * The running processes; on Windows with their state and window. tasklist and taskkill may
 * find processes through WMI, which may be what hangs. When tasklist fails, PowerShell's
 * Get-Process lists the processes instead; it reads them without WMI.
 */
function processList(): string[] {
  if (process.platform !== 'win32') {
    return capture('ps', ['-A', '-o', 'pid,ppid,pgid,stat,etime,args']);
  }
  const detailed = captureOrFail('tasklist', ['/v', '/fo', 'csv']);
  if (!detailed.failed) return detailed.lines;
  return [
    ...detailed.lines,
    ...capture('pwsh', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-Process | Format-Table -AutoSize Id, @{ Name = 'Parent'; Expression = { $_.Parent.Id } }, ProcessName, StartTime, MainWindowTitle | Out-String -Width 250",
    ]),
  ];
}

/**
 * Sends SIGKILL to a process or, for a negative number, a process group.
 * @returns Whether it was sent; not when the target has already ended.
 */
function kill(target: number): boolean {
  try {
    process.kill(target, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops a process and every process below it.
 * @param pid - The process.
 * @param images - Programs whose processes are also stopped by name on Windows.
 * @returns The processes that were stopped, and what the stop printed.
 */
function stopTree(
  pid: number,
  images: readonly string[],
): { readonly pids: number[]; readonly output: string[] } {
  if (process.platform === 'win32') {
    // taskkill finds the processes below the command by their parents. Processes whose parent
    // has exited are no longer part of that tree and are found by their program.
    const output = capture('taskkill', ['/F', '/T', '/PID', String(pid)]);
    if (images.length > 0) {
      output.push(
        ...capture('taskkill', ['/F', '/T', ...images.flatMap((image) => ['/IM', image])]),
      );
    }
    const pids = new Set(
      output.flatMap((line) => {
        const match = /^SUCCESS:.*?\bPID (\d+)/.exec(line);
        return match?.[1] === undefined ? [] : [Number(match[1])];
      }),
    );
    // Should taskkill fail, the command still ends: process.kill terminates it without WMI.
    // The processes that a Node.js command such as smoke.ts started without detaching them end
    // with it, because Node.js ties them to it through a job object.
    if (kill(pid)) pids.add(pid);
    return { pids: [...pids], output };
  }
  // The snapshot is taken before any kill, while the parents still exist. The process groups
  // of the tree also hold processes whose parent has exited; they all belong to the session
  // that the detached command started, never to the watchdog's own group.
  const rows = parsePs(capture('ps', ['-A', '-o', 'pid=,ppid=,pgid=']).join('\n'));
  const tree = new Set(processTree(rows, pid));
  const own = rows.find((row) => row.pid === process.pid)?.pgid;
  const groups = new Set([pid, ...rows.filter((row) => tree.has(row.pid)).map((row) => row.pgid)]);
  if (own !== undefined) groups.delete(own);
  const pids = new Set(tree);
  for (const row of rows) if (groups.has(row.pgid)) pids.add(row.pid);
  pids.delete(process.pid);
  for (const each of pids) kill(each);
  for (const group of groups) kill(-group);
  return { pids: [...pids], output: [] };
}

/**
 * Runs a command under a deadline and forwards its output line by line.
 * @param options - The command, its deadline and where the output goes.
 */
export function supervise(options: SuperviseOptions): Promise<SuperviseResult> {
  const write = options.write ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const start = Date.now();
  const stamp = (): string => `[${((Date.now() - start) / 1000).toFixed(1).padStart(6)} s]`;
  let phase: string | undefined;
  const logs = new Set<string>();
  const last: string[] = [];
  const child = spawn(options.command, [...options.args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  });
  const take = (line: string): void => {
    if (line.startsWith('## log ')) logs.add(line.slice('## log '.length).trim());
    else if (line.startsWith('## ')) phase = line.slice('## '.length).trim();
    const stamped = `${stamp()} ${line}`;
    last.push(stamped);
    if (last.length > lastLineCount) last.shift();
    write(stamped);
  };
  const flushes: (() => void)[] = [];
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) take(line);
    });
    flushes.push(() => {
      if (rest !== '') take(rest);
      rest = '';
    });
  }
  const section = (title: string, lines: readonly string[]): void => {
    write(`${stamp()} ${title}:`);
    for (const line of lines) write(`  ${line}`);
  };

  return new Promise((done) => {
    let outcome: number | undefined;
    let timedOut = false;
    let stopped: number[] = [];
    let closed = false;
    let finished = false;
    let wait: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(wait);
      options.signal?.removeEventListener('abort', interrupt);
      for (const flush of flushes) flush();
      // A leftover process may keep the pipes open; their end is not awaited.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      done({ code: outcome ?? 1, timedOut, phase, stopped });
    };
    // The result is known; the last lines may still be on their way.
    const settle = (code: number): void => {
      if (outcome !== undefined) return;
      outcome = code;
      clearTimeout(deadline);
      if (closed) finish();
      else wait = setTimeout(finish, closeWaitMs);
    };
    const stop = (code: number, reason: string): void => {
      if (outcome !== undefined) return;
      if (child.pid !== undefined) {
        write(`${stamp()} ${reason}`);
        const result = stopTree(child.pid, options.images ?? []);
        for (const line of result.output) write(`  ${line}`);
        stopped = result.pids;
        write(`${stamp()} Stopped ${stopped.length} processes: ${stopped.join(' ')}`);
      }
      settle(code);
    };
    const interrupt = (): void =>
      stop(130, `Interrupted in phase ${phase ?? 'none'}; stopping every process of the command.`);
    child.on('error', (error) => {
      write(`::error::Could not start ${options.command}: ${error.message}`);
      settle(127);
    });
    child.on('exit', (code, signal) =>
      settle(code ?? 128 + (signal === null ? 0 : constants.signals[signal])),
    );
    child.on('close', () => {
      closed = true;
      if (outcome !== undefined) finish();
    });
    const deadline = setTimeout(() => {
      timedOut = true;
      // A line without its end yet may tell the most.
      for (const flush of flushes) flush();
      const seconds = Math.round((Date.now() - start) / 1000);
      write(`::error::No result after ${seconds} s; last phase: ${phase ?? 'none'}`);
      section('The last lines', last);
      for (const log of logs) section(`The end of ${log}`, logTail(log));
      section('Processes', processList());
      if (process.platform === 'win32') {
        section(
          'The latest events of Windows Installer',
          capture('wevtutil', [
            'qe',
            'Application',
            "/q:*[System[Provider[@Name='MsiInstaller']]]",
            '/c:30',
            '/rd:true',
            '/f:text',
          ]),
        );
      }
      stop(124, 'Stopping the command and every process below it.');
    }, options.deadlineMs);
    options.signal?.addEventListener('abort', interrupt, { once: true });
  });
}

if (import.meta.main) {
  const usage =
    'Usage: node tools/package/watchdog.ts --until <unix seconds> [--image <program>]... -- <command> [args...]';
  let parsed;
  try {
    parsed = parseArgs({
      options: { until: { type: 'string' }, image: { type: 'string', multiple: true } },
      allowPositionals: true,
    });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
    process.exit(2);
  }
  const until = Number(parsed.values.until);
  const [command, ...args] = parsed.positionals;
  if (!Number.isFinite(until) || command === undefined) {
    console.error(usage);
    process.exit(2);
  }
  const controller = new AbortController();
  // The runner of GitHub Actions sends Ctrl+C to its console when it cancels a step.
  for (const name of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(name, () => controller.abort());
  }
  const result = await supervise({
    command,
    args,
    deadlineMs: Math.max(0, until * 1000 - Date.now()),
    images: parsed.values.image ?? [],
    signal: controller.signal,
  });
  process.exitCode = result.code;
}
