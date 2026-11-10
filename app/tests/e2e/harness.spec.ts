import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { launch } from './harness.ts';

test('fails a test with a report of the browser process when the shell stops answering', async () => {
  const browser = await launch();
  // The shell asks the browser process for its state, which now never answers.
  await browser.main.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('shell.getState');
    ipcMain.handle('shell.getState', () => new Promise(() => undefined));
  });
  const started = Date.now();
  await expect(browser.close()).rejects.toThrow('The shell did not answer at the end of the test');
  // The test ends long before its time limit, and the browser has quit.
  expect(Date.now() - started).toBeLessThan(30_000);
  expect(browser.process.exitCode !== null || browser.process.signalCode !== null).toBe(true);
  const report = test.info().attachments.find((attachment) => attachment.name === 'browser');
  const text = readFileSync(report?.path ?? '', 'utf8');
  expect(text).toContain('The shell did not answer within 10 seconds');
  expect(text).toContain('Browser process: {"windows":[{');
});

test('records and stops a browser that does not let the harness connect', async () => {
  test.skip(process.platform === 'win32', 'Windows has no signal that stops a process');
  // Sampling the threads of the process can take a while.
  test.setTimeout(120_000);
  let pid: number | undefined;
  // Stopped right after it reported its start, the browser answers nothing, as one that hangs.
  const started = launch([], {
    onReady: (child) => {
      pid = child.pid;
      child.kill('SIGSTOP');
    },
  });
  // Depending on when the stop takes hold, the main process or the pages do not answer.
  await expect(started).rejects.toThrow(
    /The browser process did not answer within 10 seconds|connectOverCDP: Timeout/,
  );
  // The browser is gone, so it does not slow down the tests after it.
  await expect
    .poll(() => {
      try {
        process.kill(pid ?? 0, 0);
        return 'running';
      } catch {
        return 'gone';
      }
    })
    .toBe('gone');
  const record = test.info().attachments.find((attachment) => attachment.name === 'failed start');
  const text = readFileSync(record?.path ?? '', 'utf8');
  expect(text).toContain('The browser started, but the harness could not use it');
});
