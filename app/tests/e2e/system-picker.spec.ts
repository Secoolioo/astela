import { expect, test } from '@playwright/test';
import { FixtureServer, launch, systemPicker, waitForPage } from './harness.ts';

// The picker of the system stays open after the browser quits, and every browser that starts
// later runs behind it, without the focus. The configuration therefore runs this file in a
// project of its own, after every other test.
test.skip(!systemPicker, 'Only macOS 15 and later have a picker of the system');

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('leaves the choice of the screen or the window to the picker of the system', async () => {
  const browser = await launch();
  try {
    const address = `${server.origin}/permissions.html`;
    const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await field.fill(address);
    await field.press('Enter');
    const page = await waitForPage(browser, (current) => current === address);
    await page.getByRole('button', { name: 'Share the screen' }).click();
    // The picker of the system asks, and a test cannot answer it: the browser shows no
    // picker of its own, and the site waits.
    await new Promise((done) => setTimeout(done, 2000));
    const pages = browser.cdp.contexts().flatMap((context) => context.pages());
    expect(pages.some((current) => current.url().startsWith('app://overlay'))).toBe(false);
    await expect(page.locator('#result')).toHaveText('');
  } finally {
    await browser.close();
  }
});
