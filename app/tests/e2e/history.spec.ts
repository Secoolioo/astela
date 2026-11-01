import { expect, test } from '@playwright/test';
import { FixtureServer, launch, pressNative, shellState, waitForPage } from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('records pages and finds, opens and removes them on the history page', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await page.click('#second');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture second');
    await pressNative(browser, mac ? 'Y' : 'H', ['primary']);
    const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
    const entry = (name: string): ReturnType<typeof history.getByRole> =>
      history.getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(entry('Fixture second')).toBeVisible();
    await expect(entry('Fixture home')).toBeVisible();
    await history.getByRole('searchbox', { name: 'Search history' }).fill('second');
    await expect(entry('Fixture home')).toHaveCount(0);
    await expect(entry('Fixture second')).toBeVisible();
    await history.getByRole('searchbox', { name: 'Search history' }).fill('');
    await history.getByRole('button', { name: 'Remove Fixture home from the history' }).click();
    await expect(entry('Fixture home')).toHaveCount(0);
    await history.getByRole('button', { name: 'Clear history' }).click();
    await history.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(history.getByText('No pages found.')).toBeVisible();
  } finally {
    await browser.close();
  }
});
