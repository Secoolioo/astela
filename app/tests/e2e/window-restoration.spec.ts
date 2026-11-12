import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from './harness.ts';

const appDir = resolve(import.meta.dirname, '../..');

/** The user default that makes AppKit ignore the windows it kept for the next start. */
const ignoreState = 'ApplePersistenceIgnoreState';

/**
 * Starts the browser with a fresh profile in self-test mode, in which it quits once its shell
 * has rendered, and returns what it printed to its error output, where AppKit logs. The
 * harness reads that output from the start on, before a test could. A start that has not
 * ended within 30 seconds, such as one that AppKit's alert holds back, is stopped and fails.
 */
async function startInSelfTest(): Promise<{ pid: number; ok: boolean; output: string }> {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  const report = join(profile, 'ready.json');
  const args = [
    `--user-data-dir=${join(profile, 'data')}`,
    '--lang=en-US',
    '--no-first-run',
    '--use-mock-keychain',
    `--smoke-test=${report}`,
  ];
  const packaged = process.env['E2E_APP'];
  const electron = createRequire(join(appDir, 'package.json'))('electron') as string;
  const child = spawn(packaged ?? electron, packaged === undefined ? [appDir, ...args] : args, {
    stdio: ['ignore', 'inherit', 'pipe'],
  });
  let output = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text: string) => {
    output += text;
    process.stderr.write(text);
  });
  const exited = new Promise<void>((done, fail) => {
    child.once('exit', () => done());
    child.once('error', fail);
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const ended = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(false), 30_000);
      }),
    ]);
    if (!ended) {
      child.kill('SIGKILL');
      await exited;
      throw new Error(`The browser did not end its self-test within 30 seconds:\n${output}`);
    }
    const ok =
      existsSync(report) && (JSON.parse(readFileSync(report, 'utf8')) as { ok: boolean }).ok;
    return { pid: child.pid ?? -1, ok, output };
  } finally {
    clearTimeout(timer);
    child.stderr.destroy();
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

test('leaves the windows of the last start to the browser instead of macOS', async () => {
  test.skip(process.platform !== 'darwin', 'Only macOS keeps the windows of an app itself');
  // After an abnormal end during a start, macOS would ask before any window whether to
  // reopen the windows of the last start; the browser tells AppKit to ignore them.
  const browser = await launch();
  try {
    // Registered as NO for a moment, the default shows what every source above the browser's
    // own registration gives: the command line, the app's and the global preferences, those
    // of the host and those an organization manages.
    const values = await browser.main.evaluate(({ systemPreferences }, name) => {
      const inEffect = systemPreferences.getUserDefault(name, 'boolean');
      systemPreferences.registerDefaults({ [name]: false });
      const elsewhere = systemPreferences.getUserDefault(name, 'boolean');
      systemPreferences.registerDefaults({ [name]: true });
      return { inEffect, elsewhere };
    }, ignoreState);
    expect(values.elsewhere, `${ignoreState} is set outside the browser`).toBe(false);
    expect(values.inEffect).toBe(true);
  } finally {
    await browser.close();
  }
  // AppKit logs where it keeps new state once it ignores the kept state, which it decides
  // when it handles the launch: the browser's default was registered in time for that.
  const start = await startInSelfTest();
  expect(start.ok, start.output).toBe(true);
  expect(start.output, 'AppKit logged no line that it ignores the kept state').toMatch(
    new RegExp(
      `\\[${String(start.pid)}:[^\\]]*\\] ${ignoreState}: Existing state will not be touched`,
    ),
  );
});
