import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './harness.ts';

test('logs an error of the browser process that no code catches, and goes on and quits', async () => {
  const browser = await launch();
  try {
    await browser.main.evaluate(() => {
      setTimeout(() => {
        throw new Error('An error that no code catches');
      }, 0);
    });
    const log = join(browser.profile, 'data', 'logs', 'main.log');
    await expect
      .poll(() => readFileSync(log, 'utf8'))
      .toContain('An error in the browser process was not caught');
    expect(readFileSync(log, 'utf8')).toContain('An error that no code catches');
    // The browser process still answers, and the test ends with a normal quit.
    expect(await browser.main.evaluate(({ app }) => app.getName())).not.toBe('');
  } finally {
    await browser.close();
  }
});
