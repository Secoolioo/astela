import { expect, test, type Page } from '@playwright/test';
import { launch, waitForPage, type Browser } from './harness.ts';

/** Clicks a button that replaces the page, once the click call has returned. */
async function clickAway(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name }).evaluate((button) => {
    setTimeout(() => {
      if (button instanceof HTMLElement) button.click();
    }, 0);
  });
}

test('guides a new profile through its look, tabs and search engine', async () => {
  const browser: Browser = await launch([], { firstRun: true });
  try {
    const page = await waitForPage(browser, (url) => url.startsWith('app://setup'));
    await expect(page.getByRole('heading', { name: 'Welcome to Astela' })).toBeVisible();
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByRole('radio', { name: 'Dark' }).check();
    await expect
      .poll(() => browser.main.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('dark');
    await page.getByRole('radio', { name: 'Teal' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: 'Left' }).check();
    await expect(browser.shell.getByRole('tablist')).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    await page.getByRole('radio', { name: 'Compact' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('radio', { name: 'Ecosia' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Bring your bookmarks along' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Blocker and default browser' })).toBeVisible();
    await expect(page.getByRole('switch', { name: /^Block ads and trackers/ })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Make default' })).toBeVisible();
    await page.getByRole('switch', { name: /^Block ads and trackers/ }).uncheck();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'You are all set' })).toBeVisible();
    await clickAway(page, 'Start browsing');
    const newTab = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
    await expect(
      newTab.getByRole('searchbox', { name: 'Search with Ecosia or enter address' }),
    ).toBeVisible();
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  } finally {
    await browser.close();
  }
});

test('opens the setup guide again from the settings page', async () => {
  const browser = await launch();
  try {
    expect(
      await browser.main.evaluate(({ webContents }) =>
        webContents.getAllWebContents().some((c) => c.getURL().startsWith('app://setup')),
      ),
    ).toBe(false);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('button', { name: 'Open the setup guide' }).click();
    const page = await waitForPage(browser, (url) => url.startsWith('app://setup'));
    await expect(page.getByRole('heading', { name: 'Welcome to Astela' })).toBeVisible();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    // The guide changes settings through the settings channels, and nothing else.
    const shellCall = await page.evaluate(() =>
      window.bridge.invoke('shell.getState', {}).then(
        () => 'answered',
        () => 'refused',
      ),
    );
    expect(shellCall).toBe('refused');
  } finally {
    await browser.close();
  }
});
