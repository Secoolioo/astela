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
    // The tab of the pages can go back, until the whole history is cleared.
    const moves = async (): Promise<[boolean, boolean] | undefined> => {
      const tab = (await shellState(browser.shell)).tabs[0];
      return tab === undefined ? undefined : [tab.canGoBack, tab.canGoForward];
    };
    expect(await moves()).toEqual([true, false]);
    await history.getByRole('button', { name: 'Clear history' }).click();
    await history.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(history.getByText('No pages found.')).toBeVisible();
    await expect.poll(moves).toEqual([false, false]);
  } finally {
    await browser.close();
  }
});

test('writes each time on one line, also the times of English with AM and PM, and lines up the titles', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    for (const name of ['index.html', 'second.html']) {
      await address.fill(`${server.origin}/${name}`);
      await address.press('Enter');
      await waitForPage(browser, (url) => url.endsWith(`/${name}`));
    }
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture second');
    await pressNative(browser, mac ? 'Y' : 'H', ['primary']);
    const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
    await expect(history.getByRole('button', { name: /^Fixture home/ })).toBeVisible();
    await expect(history.getByRole('button', { name: /^Fixture second/ })).toBeVisible();
    const times = await history.locator('li time').evaluateAll((cells) =>
      cells.map((cell) => {
        // A range gives a box for each line of its text.
        const range = document.createRange();
        range.selectNodeContents(cell);
        return { text: cell.textContent, lines: range.getClientRects().length };
      }),
    );
    expect(times.length).toBeGreaterThanOrEqual(2);
    for (const time of times) {
      expect(time.text).toMatch(/^\d{1,2}:\d{2}\s(?:AM|PM)$/);
      expect(time, time.text).toMatchObject({ lines: 1 });
    }
    const starts = await history
      .locator('li .open')
      .evaluateAll((titles) => titles.map((title) => title.getBoundingClientRect().left));
    expect(new Set(starts).size).toBe(1);
  } finally {
    await browser.close();
  }
});
