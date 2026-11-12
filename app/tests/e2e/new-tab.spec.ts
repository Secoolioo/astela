import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  FixtureServer,
  launch,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

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
    search: true,
    clock: false,
    tiles: [],
    mostVisited: [],
    background: { kind: 'none' },
  });
  const shellCall = await page.evaluate(() =>
    window.bridge.invoke('shell.getState', {}).then(
      () => 'answered',
      () => 'refused',
    ),
  );
  expect(shellCall).toBe('refused');
});

/**
 * The addresses of the views that have the focus of the window, as the browser process sees
 * it: Playwright pretends that each page it drives has the focus.
 */
function focusedViews(): Promise<string[]> {
  return browser.main.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .filter((contents) => contents.isFocused())
      .map((contents) => contents.getURL()),
  );
}

test('leaves the focus in the address bar after the start, once the new tab page loaded', async () => {
  const page = await newTabPage();
  await page.waitForLoadState('load');
  await expect.poll(focusedViews).toEqual(['app://shell/']);
});

test('leaves the focus in the address bar when the new tab page loads after it', async () => {
  await newTabPage();
  await browser.main.evaluate(({ webContents }) => {
    webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('app://shell'))
      ?.focus();
  });
  await expect.poll(focusedViews).toEqual(['app://shell/']);
  // The page commits while the address bar has the focus, as when it loads after the address
  // bar of a new tab took the focus. Typing must go on in the address bar.
  await browser.main.evaluate(
    ({ webContents }) =>
      new Promise<void>((done) => {
        const page = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith('app://newtab'));
        if (page === undefined) {
          done();
          return;
        }
        page.once('did-finish-load', () => done());
        page.reload();
      }),
  );
  expect(await focusedViews()).toEqual(['app://shell/']);
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

test('shows the clock in the regional form of the system, such as British English', async () => {
  await browser.close();
  // On Linux, the environment names the locale of the system.
  const british = { LANG: 'en_GB.UTF-8', LANGUAGE: 'en_GB:en', LC_ALL: 'en_GB.UTF-8' };
  browser = await launch([], { settings: { 'newtab.clock': true }, env: british });
  const system = await browser.main.evaluate(({ app }) =>
    app.getSystemLocale().replace(/@.*$/, '').replaceAll('_', '-'),
  );
  const page = await newTabPage();
  await expect(page.locator('#clock')).toHaveText(/\d/);
  const [shown, expected] = await page.evaluate((tag) => {
    const clock = document.querySelector('time');
    const at = new Date(clock?.dateTime ?? '');
    return [clock?.textContent, new Intl.DateTimeFormat(tag, { timeStyle: 'short' }).format(at)];
  }, system);
  expect(shown).toBe(expected);
  // British English writes the time with 24 hours, unlike the English of the United States.
  if (process.platform === 'linux') expect(shown).toMatch(/^\d{2}:\d{2}$/);
});

test('shows the search field, a clock and shortcuts as the settings say', async () => {
  await browser.close();
  const url = `${server.origin}/index.html`;
  browser = await launch([], {
    settings: {
      'newtab.search': false,
      'newtab.clock': true,
      'newtab.tiles': [{ title: 'Fixture', url }],
    },
  });
  const page = await newTabPage();
  await expect(page.getByRole('searchbox')).toBeHidden();
  await expect(page.locator('#clock')).toHaveText(/\d/);
  const shortcuts = page.getByRole('list', { name: 'Shortcuts' });
  await shortcuts.getByRole('link', { name: 'Fixture' }).click();
  await expect.poll(activeTitle).toBe('Fixture home');
});

test('shows changes of the settings on an open new tab page', async () => {
  const page = await newTabPage();
  await expect(page.locator('#clock')).toBeHidden();
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await pressNative(browser, 'T', ['primary']);
  // What is typed goes to the active tab, so the typing waits until the new tab shows.
  await expect(browser.shell.getByRole('tab')).toHaveCount(2);
  await address.fill('app://settings/#newtab');
  await address.press('Enter');
  const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
  await settings.getByRole('switch', { name: /Show a clock/ }).check();
  await settings.getByRole('switch', { name: /Show the search field/ }).uncheck();
  await browser.shell.getByRole('tab', { name: 'New tab' }).click();
  await expect(page.locator('#clock')).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeHidden();
});

test('shows the sites opened most often, and none in a private window', async () => {
  await browser.close();
  browser = await launch([], { settings: { 'newtab.mostVisited': true } });
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  for (const page of ['index.html', 'second.html', 'index.html']) {
    await address.fill(`${server.origin}/${page}`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith(`/${page}`));
    await expect.poll(activeTitle).toMatch(/^Fixture/);
  }
  await pressNative(browser, 'T', ['primary']);
  const top = (await newTabPage()).getByRole('list', { name: 'Most visited' });
  await expect(top.getByRole('link')).toHaveCount(2);
  await expect(top.getByRole('link').nth(0)).toHaveAccessibleName('Fixture home');
  await expect(top.getByRole('link').nth(1)).toHaveAccessibleName('Fixture second');
  // A private window shows no sites from the history.
  await pressNative(browser, 'N', ['primary', 'shift']);
  const newTabPages = (): Page[] =>
    browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url().startsWith('app://newtab'));
  await expect.poll(() => newTabPages().length).toBe(2);
  const kinds = await Promise.all(
    newTabPages().map((page) =>
      page.evaluate(() => document.documentElement.hasAttribute('data-private')),
    ),
  );
  const privatePage = newTabPages()[kinds.indexOf(true)];
  expect(privatePage).toBeDefined();
  // The page hides the list only once it has its state, so the check waits for it.
  await expect(privatePage?.locator('html') ?? top).toHaveAttribute('data-ready', 'true');
  await expect(privatePage?.locator('#top') ?? top).toBeHidden();
  await expect(privatePage?.locator('#search') ?? top).toBeVisible();
});

test('paints the background of the settings: a color and an image', async () => {
  await browser.close();
  browser = await launch([], {
    settings: { 'newtab.background': { kind: 'color', color: '#123456' } },
  });
  const page = await newTabPage();
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe('rgb(18, 52, 86)');
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill('app://settings');
  await address.press('Enter');
  const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
  // Without a chosen image, the background stays as it was, and the page shows it so.
  await browser.main.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
  });
  await settings.getByRole('radio', { name: 'Image' }).click();
  await expect(settings.getByRole('radio', { name: 'Color', exact: true })).toBeChecked();
  await expect(settings.getByRole('radio', { name: 'Image' })).not.toBeChecked();
  const image = fileURLToPath(new URL('./fixtures/image.png', import.meta.url));
  await browser.main.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
  }, image);
  // The choice takes effect once the image is chosen, after the click.
  await settings.getByRole('radio', { name: 'Image' }).click();
  await expect(settings.getByRole('radio', { name: 'Image' })).toBeChecked();
  await expect(settings.getByRole('button', { name: 'Choose image…' })).toBeVisible();
  await pressNative(browser, 'T', ['primary']);
  const tab = await newTabPage();
  await expect
    .poll(() => tab.evaluate(() => getComputedStyle(document.documentElement).backgroundImage))
    .toMatch(/^url\("app:\/\/newtab\/background\/background-[0-9a-f]{16}\.png"\)$/);
  const loaded = await tab.evaluate(async () => {
    const url =
      /url\("(.*)"\)/.exec(getComputedStyle(document.documentElement).backgroundImage)?.[1] ?? '';
    const response = await fetch(url);
    return [response.status, response.headers.get('content-type')];
  });
  expect(loaded).toEqual([200, 'image/png']);
});
