import { expect, test } from '@playwright/test';
import { FixtureServer, launch, pressNative, shellState, waitForPage } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('bookmarks a page with the star and edits, moves and removes it on the bookmarks page', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture home');
    const star = browser.shell.getByRole('button', { name: 'Bookmark this page' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await pressNative(browser, 'D', ['primary']);
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await pressNative(browser, 'O', ['primary', 'shift']);
    const page = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
    await expect(page.getByRole('button', { name: /^Fixture home/ })).toBeVisible();

    await page.getByRole('button', { name: 'New folder in Other bookmarks' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Work');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Work', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Edit Fixture home' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Home page');
    await page.getByLabel('Address', { exact: true }).fill('not an address');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toHaveText(/starts with http/);
    await page.getByLabel('Address', { exact: true }).fill(`${server.origin}/index.html`);
    const folder = page.getByLabel('Folder', { exact: true });
    const work = await folder.locator('option', { hasText: 'Work' }).getAttribute('value');
    await folder.selectOption(work ?? '');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('This folder is empty.')).toBeVisible();
    await page.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Home page/ })).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search bookmarks' }).fill('home');
    await expect(page.getByRole('button', { name: /^Home page/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search bookmarks' }).fill('');

    await page.getByRole('button', { name: 'Remove Work' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Home page/ })).toHaveCount(0);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.bookmarked)
      .toBe(false);
  } finally {
    await browser.close();
  }
});
