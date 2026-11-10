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
