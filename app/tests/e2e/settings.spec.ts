import { expect, test, type Page } from '@playwright/test';
import { launch, pressNative, waitForPage, type Browser } from './harness.ts';

let browser: Browser;

test.beforeEach(async () => {
  browser = await launch();
});
test.afterEach(async () => {
  await browser.close();
});

async function openSettings(): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill('app://settings');
  await address.press('Enter');
  return waitForPage(browser, (url) => url.startsWith('app://settings'));
}

/** A design token as a page computes it. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

test('changes the appearance at once in every view', async () => {
  const page = await openSettings();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect
    .poll(() => browser.main.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
    .toBe('dark');
  await page.getByRole('radio', { name: 'Green' }).check();
  await expect
    .poll(() => browser.shell.evaluate(token, '--accent-light'))
    .toBe('oklch(54.8% 0.150 150.0)');
  await page.getByRole('radio', { name: 'Compact' }).check();
  await expect.poll(() => browser.shell.evaluate(token, '--tab-height')).toBe('28px');
  expect(await page.evaluate(token, '--tab-height')).toBe('28px');
  // The page only reaches its own channels.
  const shellCall = await page.evaluate(() =>
    window.bridge.invoke('shell.getState', {}).then(
      () => 'answered',
      () => 'refused',
    ),
  );
  expect(shellCall).toBe('refused');
});

test('tells whether the browser is the default browser and offers to make it one', async () => {
  const page = await openSettings();
  await expect(page.getByText('Links from other apps open in another browser.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make default' })).toBeVisible();
  expect(await page.evaluate(() => window.bridge.invoke('settings.getDefaultBrowser', {}))).toEqual(
    {
      isDefault: false,
      allowed: true,
    },
  );
});

test('chooses the search engine of the new tab page and the address bar', async () => {
  const page = await openSettings();
  const engine = page.getByRole('combobox', { name: 'Search engine' });
  await engine.selectOption('google');
  await pressNative(browser, 'T', ['primary']);
  const newTab = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
  await expect(
    newTab.getByRole('searchbox', { name: 'Search with Google or enter address' }),
  ).toBeVisible();
  await engine.selectOption('custom');
  const address = page.getByRole('textbox', { name: /Search address/ });
  await address.fill('http://search.example/?q=%s');
  await address.blur();
  await expect(page.getByRole('alert')).toHaveText('Enter an https address that contains %s.');
  await address.fill('https://search.example/?q=%s');
  await address.blur();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.bridge.invoke('settings.getAll', {}))).toMatchObject({
    settings: expect.arrayContaining([
      { key: 'search.urlTemplate', value: 'https://search.example/?q=%s', locked: false },
    ]),
  });
});

test('opens the settings from the browser menu in place of a new tab page', async () => {
  await browser.main.evaluate(({ Menu }) => {
    const recorded: Electron.Menu[] = [];
    Object.assign(globalThis, { recordedMenus: recorded });
    Menu.prototype.popup = function popup(this: Electron.Menu) {
      recorded.push(this);
    };
  });
  await browser.shell.getByRole('button', { name: 'Menu' }).click();
  await expect
    .poll(() =>
      browser.main.evaluate(() =>
        (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
          .at(-1)
          ?.items.map((item) => (item.type === 'separator' ? '-' : item.label)),
      ),
    )
    .toEqual(
      process.platform === 'darwin'
        ? ['New Tab', '-', 'History', 'Bookmarks', '-', 'Settings…']
        : ['New &tab', '-', '&History', '&Bookmarks', '-', '&Settings'],
    );
  await browser.main.evaluate(() => {
    const menu = (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus.at(-1);
    menu?.items.at(-1)?.click();
  });
  await waitForPage(browser, (url) => url.startsWith('app://settings'));
  await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  await expect(browser.shell.getByRole('tab', { name: 'Settings' })).toBeVisible();
});
