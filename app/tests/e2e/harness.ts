import {
  chromium,
  test,
  type Browser as CdpBrowser,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import type * as Electron from 'electron';
import type { ShellState } from '../../src/shared/ipc/shell-contracts.ts';

const fixtures = resolve(import.meta.dirname, 'fixtures');
const appDir = resolve(import.meta.dirname, '../..');

declare global {
  interface Window {
    /** The shell's preload bridge; only internal pages have it. */
    readonly bridge: {
      invoke(channel: string, payload: unknown): Promise<unknown>;
      on(channel: string, listener: (payload: unknown) => void): () => void;
    };
  }
}

/** The content type of a fixture file. */
function contentType(file: string): string {
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.gif')) return 'image/gif';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.pdf')) return 'application/pdf';
  return 'text/html; charset=utf-8';
}

/** A local web server for test pages; tests never load third-party sites. */
export class FixtureServer {
  private server: Server | undefined;
  origin = '';
  /** The requests the server got, newest last, with their headers. */
  readonly requests: { readonly path: string; readonly headers: IncomingHttpHeaders }[] = [];

  /** Starts the server on a random port of 127.0.0.1. */
  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      this.requests.push({ path: request.url ?? '/', headers: request.headers });
      const name =
        new URL(request.url ?? '/', 'http://x').pathname.replace(/^\//, '') || 'index.html';
      try {
        const file = name.replace(/[^a-z0-9.-]/gi, '');
        const body = readFileSync(join(fixtures, file));
        response.writeHead(200, { 'content-type': contentType(file) });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => this.server?.listen(0, '127.0.0.1', done));
    const address = this.server.address();
    this.origin =
      typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : '';
  }

  /** Stops the server. */
  async stop(): Promise<void> {
    await new Promise((done) => this.server?.close(done));
  }
}

/**
 * The browser's main process, reached through the Node.js inspector. Functions are sent as
 * source text and run with the `electron` module as their first argument.
 */
export class MainProcess {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, (message: InspectorMessage) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as InspectorMessage;
      if (message.id !== undefined) this.pending.get(message.id)?.(message);
    });
  }

  /** Connects to the inspector of a started browser. */
  static async connect(url: string): Promise<MainProcess> {
    const socket = new WebSocket(url);
    await new Promise<void>((done, fail) => {
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => fail(new Error('Inspector connection failed')), {
        once: true,
      });
    });
    return new MainProcess(socket);
  }

  /**
   * Runs a function in the main process and returns its result.
   * @param fn - Function of the `electron` module and the argument.
   * @param arg - A JSON value passed to the function.
   */
  async evaluate<R, A = undefined>(
    fn: (electron: typeof Electron, arg: A) => R | Promise<R>,
    arg?: A,
  ): Promise<R> {
    const id = this.nextId;
    this.nextId += 1;
    const expression = `(async () => (${fn.toString()})(require('electron'), ${JSON.stringify(arg ?? null)}))()`;
    const answer = new Promise<InspectorMessage>((done) => this.pending.set(id, done));
    this.socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression,
          includeCommandLineAPI: true,
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
    const message = await answer;
    this.pending.delete(id);
    const details = message.result?.exceptionDetails;
    if (details !== undefined) {
      throw new Error(details.exception?.description ?? details.text ?? 'Evaluation failed');
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value comes from fn
    return message.result?.result?.value as R;
  }

  /** Disconnects, so the process can exit without waiting for the debugger. */
  close(): void {
    this.socket.close();
  }
}

interface InspectorMessage {
  readonly id?: number;
  readonly result?: {
    readonly result?: { readonly value?: unknown };
    readonly exceptionDetails?: {
      readonly text?: string;
      readonly exception?: { readonly description?: string };
    };
  };
}

/** A running browser with its shell page. */
export interface Browser {
  readonly main: MainProcess;
  readonly cdp: CdpBrowser;
  readonly shell: Page;
  readonly process: ChildProcess;
  readonly profile: string;
  /** Quits the browser; the profile is removed unless it is kept for another start. */
  close(options?: { readonly keepProfile?: boolean }): Promise<void>;
}

/** Waits until the process prints a line that matches, and returns the match. */
function waitForLine(child: ChildProcess, pattern: RegExp): Promise<RegExpExecArray> {
  return new Promise((done, fail) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const match = pattern.exec(buffer);
      if (match !== null) {
        child.stderr?.off('data', onData);
        done(match);
      }
    };
    child.stderr?.on('data', onData);
    child.once('exit', (code) => fail(new Error(`The browser exited with ${String(code)}`)));
  });
}

/**
 * Starts the browser with a fresh profile and connects once its shell has rendered, which
 * the self-test report announces. `E2E_APP` points to a packaged test build; without it,
 * the development build in `out/` is started with the local Electron.
 * @param extraArgs - Further command line switches, such as a device scale factor.
 * @param options - User settings to store in the profile before the browser starts, and
 *   whether the setup guide of a new profile may open, which it does not by default.
 */
export async function launch(
  extraArgs: readonly string[] = [],
  options: {
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly firstRun?: boolean;
    /** The profile of an earlier start to use again. */
    readonly profile?: string;
    /** Environment variables for the browser, such as another home folder. */
    readonly env?: Readonly<Record<string, string>>;
    /** Another packaged browser to start, such as {@link packageWithoutBlockerData}. */
    readonly app?: string;
    /** Called once the browser reported its start, before the harness connects to it. */
    readonly onReady?: (child: ChildProcess) => void;
  } = {},
): Promise<Browser> {
  const profile = options.profile ?? mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  rmSync(join(profile, 'ready.json'), { force: true });
  if (options.settings !== undefined) {
    mkdirSync(join(profile, 'data'), { recursive: true });
    writeFileSync(
      join(profile, 'data', 'settings.json'),
      JSON.stringify({ $schemaVersion: 1, user: options.settings }),
    );
  }
  const report = join(profile, 'ready.json');
  const args = [
    '--inspect=0',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(profile, 'data')}`,
    '--lang=en-US',
    `--smoke-test=${report}`,
    '--smoke-test-keep-running',
    ...(options.firstRun === true ? [] : ['--no-first-run']),
    // On macOS, a test that moves the home folder leaves the browser without a login
    // keychain, and its cookie encryption would wait for one when it quits; a mock keychain
    // keeps every test independent of the keychain of the machine.
    ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
    ...extraArgs,
  ];
  // Switches go first: after --, the browser takes every argument as a link.
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
  const packaged = options.app ?? process.env['E2E_APP'];
  const electronPath = createRequire(join(appDir, 'package.json'))('electron') as string;
  const spawnOptions = {
    stdio: ['ignore', 'inherit', 'pipe'] as ['ignore', 'inherit', 'pipe'],
    env: { ...process.env, ...options.env },
  };
  const child =
    packaged === undefined
      ? spawn(electronPath, [appDir, ...args], spawnOptions)
      : spawn(packaged, args, spawnOptions);
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  const inspector = waitForLine(child, /Debugger listening on (ws:\/\/\S+)/);
  const devtools = waitForLine(child, /DevTools listening on (ws:\/\/\S+)/);
  const [inspectorMatch, devtoolsMatch] = await Promise.all([inspector, devtools]);
  for (let i = 0; !existsSync(report); i += 1) {
    if (i > 300 || child.exitCode !== null) {
      await reportFailedStart(child, undefined, profile, 'The shell did not become ready');
      throw new Error('The shell did not become ready');
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  options.onReady?.(child);
  let main: MainProcess | undefined;
  let cdp: CdpBrowser;
  let shell: Page;
  try {
    main = await within(
      MainProcess.connect(inspectorMatch[1] ?? ''),
      answerTime,
      'The browser process',
    );
    cdp = await chromium.connectOverCDP(devtoolsMatch[1] ?? '');
    shell = await waitForPage({ cdp }, (url) => url.startsWith('app://shell'));
    await shell.waitForSelector('app-shell');
  } catch (error) {
    await reportFailedStart(child, main, profile, String(error));
    throw error;
  }
  return {
    main,
    cdp,
    shell,
    process: child,
    profile,
    async close(closeOptions: { readonly keepProfile?: boolean } = {}): Promise<void> {
      // The browser saves its state before it quits, so wait for the process to exit.
      const exited =
        child.exitCode === null
          ? new Promise<void>((done) => child.once('exit', () => done()))
          : Promise.resolve();
      const answered = await reportState(main, shell, profile);
      await within(
        main.evaluate(({ app }) => {
          setTimeout(() => app.quit(), 0);
        }),
        answerTime,
        'The browser process',
      ).catch(() => undefined);
      main.close();
      await cdp.close().catch(() => undefined);
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise((_, fail) => {
          timer = setTimeout(() => {
            // A browser that does not quit shows its log and is stopped, so that it does not
            // slow down the tests after it.
            printLog(profile);
            child.kill('SIGKILL');
            fail(new Error('The browser did not exit within 15 seconds'));
          }, 15_000);
        }),
      ]).finally(() => clearTimeout(timer));
      if (closeOptions.keepProfile !== true) rmSync(profile, { recursive: true, force: true });
      if (!answered) throw new Error('The shell did not answer at the end of the test');
    },
  };
}

/**
 * Records what the browser showed at the end of a test: the shell's state and address bar,
 * every web contents, and the end of the browser's log. The record goes with the files of the
 * test, which CI keeps when a test fails: a failed expectation fails the test only after the
 * test closed its browser. A test that has failed by now, such as by its time limit, also
 * prints the record to the job log.
 */
async function reportState(main: MainProcess, shell: Page, profile: string): Promise<boolean> {
  let info: TestInfo;
  try {
    info = test.info();
  } catch {
    return true;
  }
  let report: string;
  let answered = true;
  try {
    const state = await within(shellState(shell), answerTime, 'The shell');
    const address = await within(
      shell.evaluate(() => {
        const root = document.querySelector('app-shell')?.shadowRoot;
        const input = root?.querySelector('input');
        return {
          value: input?.value,
          focused: input !== undefined && root?.activeElement === input,
        };
      }),
      answerTime,
      'The shell',
    );
    const views = await within(
      main.evaluate(({ webContents }) =>
        webContents.getAllWebContents().map((contents) => ({
          id: contents.id,
          url: contents.getURL(),
          title: contents.getTitle(),
          loading: contents.isLoading(),
          crashed: contents.isCrashed(),
          focused: contents.isFocused(),
        })),
      ),
      answerTime,
      'The browser process',
    );
    report = `Browser at the end of the test: ${JSON.stringify({ state, address, views })}\n`;
  } catch (error) {
    // A shell that was closed throws at once; one that does not answer hangs.
    answered = !(error instanceof NoAnswer);
    report = `Browser state not available: ${String(error)}\n`;
    report += await within(processReport(main), answerTime, 'The browser process').then(
      (known) => `Browser process: ${JSON.stringify(known)}\n`,
      (failure: unknown) => `Browser process not available: ${String(failure)}\n`,
    );
  }
  report += logTail(profile);
  if (info.status !== info.expectedStatus) process.stdout.write(report);
  // A test can start the browser more than once.
  const count = info.attachments.filter((attachment) => attachment.name === 'browser').length;
  const file = info.outputPath(count === 0 ? 'browser.txt' : `browser-${String(count + 1)}.txt`);
  writeFileSync(file, report);
  await info.attach('browser', { path: file, contentType: 'text/plain' });
  return answered;
}

/**
 * Records a browser that started but could not be reached, such as one whose browser process
 * hangs, and stops it, so that it does not slow down the tests after it. The record holds what
 * the browser process still answers, the call stacks of its threads where the system can
 * sample them, and the end of its log; it goes with the files of the test and to the job log.
 * @param child - The browser process.
 * @param main - Its main process, if the harness reached it.
 * @param profile - Its profile.
 * @param reason - What failed.
 */
async function reportFailedStart(
  child: ChildProcess,
  main: MainProcess | undefined,
  profile: string,
  reason: string,
): Promise<void> {
  let report = `The browser started, but the harness could not use it: ${reason}\n`;
  if (main !== undefined) {
    report += await within(processReport(main), answerTime, 'The browser process').then(
      (known) => `Browser process: ${JSON.stringify(known)}\n`,
      (failure: unknown) => `Browser process not available: ${String(failure)}\n`,
    );
  }
  report += threadStacks(child.pid, profile);
  report += logTail(profile);
  process.stdout.write(report);
  main?.close();
  const exited =
    child.exitCode === null && child.signalCode === null
      ? new Promise<void>((done) => child.once('exit', () => done()))
      : Promise.resolve();
  child.kill('SIGKILL');
  await within(exited, answerTime, 'The browser process').catch(() => undefined);
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  try {
    const info = test.info();
    const file = info.outputPath('failed-start.txt');
    writeFileSync(file, report);
    await info.attach('failed start', { path: file, contentType: 'text/plain' });
  } catch {
    // Outside a test there is nothing to attach to.
  }
}

/**
 * Runs a tool and returns its output, with `sudo` when it fails without, or nothing.
 * @param command - The tool.
 * @param args - Its arguments.
 */
function runTool(command: string, args: readonly string[]): string {
  for (const prefix of [[], ['sudo', '-n']]) {
    const [program, ...rest] = [...prefix, command, ...args];
    const result = spawnSync(program ?? command, rest, { encoding: 'utf8', timeout: 60_000 });
    if (result.status === 0) return result.stdout;
  }
  return '';
}

/**
 * The call stacks of the threads of a process, where the system has a tool for them: `sample`
 * on macOS and `gdb` on Linux, run with `sudo` when the process may not be examined otherwise,
 * as on the runners of CI.
 * @param pid - The process.
 * @param profile - A folder for the tool's output.
 */
function threadStacks(pid: number | undefined, profile: string): string {
  if (pid === undefined) return '';
  if (process.platform === 'darwin') {
    const file = join(profile, 'sample.txt');
    runTool('sample', [String(pid), '3', '-mayDie', '-file', file]);
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    return text === ''
      ? 'No sample of the browser process\n'
      : `Sample of the browser process:\n${text.split('\n').slice(0, 400).join('\n')}\n`;
  }
  if (process.platform === 'linux') {
    const text = runTool('gdb', ['-p', String(pid), '-batch', '-ex', 'thread apply all bt 40']);
    return text === ''
      ? 'No call stacks of the browser process\n'
      : `Call stacks of the browser process:\n${text.split('\n').slice(0, 400).join('\n')}\n`;
  }
  return '';
}

/** How long the end of a test waits for an answer of the shell or the browser process. */
const answerTime = 10_000;

/** An answer that did not come in time. */
class NoAnswer extends Error {}

/**
 * Waits for an answer, but not longer than a given time, so that a browser that hangs fails
 * its test with a report instead of holding it until its time limit.
 * @param answer - The answer.
 * @param ms - The time to wait.
 * @param who - Who should answer, for the error.
 */
async function within<T>(answer: Promise<T>, ms: number, who: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      answer,
      new Promise<never>((_, fail) => {
        timer = setTimeout(
          () => fail(new NoAnswer(`${who} did not answer within ${String(ms / 1000)} seconds`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the browser process knows when the shell does not answer: its windows, its views and
 * its processes with the processor time that each one uses.
 */
function processReport(main: MainProcess): Promise<unknown> {
  return main.evaluate(({ app, BaseWindow, webContents }) => ({
    windows: BaseWindow.getAllWindows().map((window) => ({
      id: window.id,
      focused: window.isFocused(),
      visible: window.isVisible(),
      minimized: window.isMinimized(),
    })),
    views: webContents.getAllWebContents().map((contents) => ({
      id: contents.id,
      url: contents.getURL(),
      loading: contents.isLoading(),
      crashed: contents.isCrashed(),
      focused: contents.isFocused(),
      pid: contents.getOSProcessId(),
    })),
    processes: app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      cpu: metric.cpu.percentCPUUsage,
    })),
  }));
}

/** The end of the browser's log, or nothing when it has none. */
function logTail(profile: string): string {
  const log = join(profile, 'data', 'logs', 'main.log');
  return existsSync(log)
    ? `End of the browser log:\n${readFileSync(log, 'utf8').split('\n').slice(-40).join('\n')}\n`
    : '';
}

/** Prints the end of the browser's log to the job log. */
function printLog(profile: string): void {
  process.stdout.write(logTail(profile));
}

/**
 * Waits until a page whose URL matches exists.
 * @param browser - The connected browser.
 * @param match - URL test.
 */
export async function waitForPage(
  browser: Pick<Browser, 'cdp'>,
  match: (url: string) => boolean,
): Promise<Page> {
  for (let i = 0; i < 100; i += 1) {
    const page = browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .find((p) => match(p.url()));
    if (page !== undefined) {
      return page;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Page not found');
}

/** Reads the shell state through the shell's own bridge. */
export async function shellState(shell: Page): Promise<ShellState> {
  return (await shell.evaluate(() => window.bridge.invoke('shell.getState', {}))) as ShellState;
}

/**
 * Presses a key as a native input event, so the browser's own shortcut handling sees it.
 * @param browser - The running browser.
 * @param keyCode - Electron key code, such as `T`.
 * @param modifiers - Modifier names; `primary` is Cmd on macOS and Ctrl elsewhere.
 * @param target - Start of the URL of the view that gets the key; the shell by default.
 */
export async function pressNative(
  browser: Browser,
  keyCode: string,
  modifiers: readonly ('primary' | 'control' | 'shift' | 'alt')[] = [],
  target = 'app://shell',
): Promise<void> {
  const mapped = modifiers.map((m) =>
    m === 'primary' ? (process.platform === 'darwin' ? 'meta' : 'control') : m,
  );
  await browser.main.evaluate(
    ({ webContents }, { keyCode: key, mapped: mods, target: prefix }) => {
      const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(prefix));
      view?.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
      view?.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
    },
    { keyCode, mapped, target },
  );
}

/**
 * Clicks the back or forward button of a mouse through the DevTools protocol, so the page
 * gets the mouse events of a real button. Playwright's mouse has no such buttons.
 * @param page - The page under the pointer.
 * @param button - The button.
 * @param point - Where the pointer is, in CSS pixels of the page.
 */
export async function clickHistoryButton(
  page: Page,
  button: 'back' | 'forward',
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await session.send('Input.dispatchMouseEvent', { type, ...point, button, clickCount: 1 });
  }
  await session.detach();
}

/**
 * Starts the browser a second time with the profile of a running one, as another app does
 * to open a link, and waits until that start has handed over and quit.
 * @param browser - The running browser.
 * @param args - Arguments of the second start, such as the link.
 * @returns The exit code of the second start.
 */
export async function startAgain(
  browser: Browser,
  args: readonly string[],
): Promise<number | null> {
  const all = [`--user-data-dir=${join(browser.profile, 'data')}`, ...args];
  if (process.platform === 'linux' && process.getuid?.() === 0) all.unshift('--no-sandbox');
  const packaged = process.env['E2E_APP'];
  const electronPath = createRequire(join(appDir, 'package.json'))('electron') as string;
  const child =
    packaged === undefined
      ? spawn(electronPath, [appDir, ...all], { stdio: 'ignore' })
      : spawn(packaged, all, { stdio: 'ignore' });
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    new Promise<number | null>((done) => child.once('exit', (code) => done(code))),
    new Promise<never>((_, fail) => {
      timer = setTimeout(() => {
        child.kill();
        fail(new Error('The second start did not quit within 30 seconds'));
      }, 30_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * A copy of the test package without the content blocker's filter data, for a test of a
 * browser whose blocker has nothing to load. The copy is made of hard links, so it is quick
 * and leaves the package itself as it is; it lies next to the package, because hard links
 * cannot reach another drive.
 * @returns The browser executable in the copy, and a function that removes the copy.
 */
export function packageWithoutBlockerData(): { app: string; remove: () => void } {
  const packaged = process.env['E2E_APP'];
  if (packaged === undefined) throw new Error('E2E_APP must point to a packaged test build');
  // On macOS, the executable is inside the app bundle, in Contents/MacOS.
  const root = process.platform === 'darwin' ? resolve(packaged, '../../..') : dirname(packaged);
  const copy = mkdtempSync(join(dirname(root), 'e2e-package-'));
  const target = join(copy, relative(dirname(root), root));
  const link = (from: string, to: string): void => {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else if (stat.isDirectory()) {
      mkdirSync(to);
      for (const entry of readdirSync(from)) link(join(from, entry), join(to, entry));
    } else linkSync(from, to);
  };
  link(root, target);
  const resources =
    process.platform === 'darwin'
      ? join(target, 'Contents', 'Resources')
      : join(target, 'resources');
  rmSync(join(resources, 'blocker'), { recursive: true, force: true });
  return {
    app: join(target, relative(root, packaged)),
    remove: () => rmSync(copy, { recursive: true, force: true }),
  };
}
