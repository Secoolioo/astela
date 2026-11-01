import { expect, test, type Page } from '@playwright/test';
import { FixtureServer, launch, shellState, waitForPage, type Browser } from './harness.ts';

const server = new FixtureServer();
let browser: Browser;

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});
test.beforeEach(async () => {
  browser = await launch();
});
test.afterEach(async () => {
  await browser.close();
});

const newTabPage = (): Promise<Page> =>
  waitForPage(browser, (url) => url.startsWith('app://newtab'));

/** Types into the new tab page and submits it, as pressing Enter does. */
async function submit(input: string): Promise<void> {
  const page = await newTabPage();
  await page.getByRole('searchbox').fill(input);
  // Submitting replaces the page, so a key press would lose its target. A script submits
  // the form once the call has returned.
  await page.locator('form').evaluate((form) => {
    setTimeout(() => {
      if (form instanceof HTMLFormElement) form.requestSubmit();
    }, 0);
  });
}

async function activeTitle(): Promise<string | undefined> {
  const state = await shellState(browser.shell);
  return state.tabs.find((tab) => tab.id === state.activeTabId)?.title;
}

test('opens new tabs on the new tab page with the search engine', async () => {
  const page = await newTabPage();
  await expect(
    page.getByRole('searchbox', { name: 'Search with DuckDuckGo or enter address' }),
  ).toBeVisible();
  await expect(browser.shell.getByRole('tab', { name: 'New tab' })).toBeVisible();
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await expect(address).toHaveValue('');
  await expect(address).toBeFocused();
  // The page only reaches its own channels; the browser process checks them again.
  expect(await page.evaluate(() => window.bridge.invoke('newtab.getState', {}))).toEqual({
    engine: 'DuckDuckGo',
  });
  const shellCall = await page.evaluate(() =>
    window.bridge.invoke('shell.getState', {}).then(
      () => 'answered',
      () => 'refused',
    ),
  );
  expect(shellCall).toBe('refused');
});

test('searches from the new tab page with the chosen engine', async () => {
  // Tests never reach third-party sites: the search request is recorded and cancelled.
  await browser.main.evaluate(({ session }) => {
    session
      .fromPartition('persist:default')
      .webRequest.onBeforeRequest({ urls: ['https://duckduckgo.com/*'] }, (details, callback) => {
        Object.assign(globalThis, { searched: details.url });
        callback({ cancel: true });
      });
  });
  await submit('astela tabs');
  await expect
    .poll(() =>
      browser.main.evaluate(() => (globalThis as unknown as { searched?: string }).searched),
    )
    .toBe('https://duckduckgo.com/?q=astela%20tabs');
});

test('goes back from a web page to the new tab page and forward again', async () => {
  await submit(`${server.origin}/index.html`);
  await expect.poll(activeTitle).toBe('Fixture home');
  const back = browser.shell.getByRole('button', { name: 'Back' });
  await expect(back).toBeEnabled();
  await back.click();
  await expect.poll(activeTitle).toBe('New tab');
  await expect(browser.shell.getByRole('button', { name: 'Back' })).toBeDisabled();
  await browser.shell.getByRole('button', { name: 'Forward' }).click();
  await expect.poll(activeTitle).toBe('Fixture home');
  const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
  await page.click('#second');
  await expect.poll(activeTitle).toBe('Fixture second');
  await back.click();
  await expect.poll(activeTitle).toBe('Fixture home');
  await back.click();
  await expect.poll(activeTitle).toBe('New tab');
});
