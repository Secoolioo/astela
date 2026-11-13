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
    await page.getByRole('radio', { name: 'Custom' }).check();
    await expect(page.getByRole('textbox', { name: 'Search address' })).toHaveValue('');
    await page.getByRole('radio', { name: 'Ecosia' }).check();
    await expect(page.getByRole('textbox', { name: 'Search address' })).toHaveCount(0);
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

/** The colors of the window, the toolbar and the separators, as the tokens of a page give them. */
function tokenColors(): { window: string; bar: string; line: string } {
  const probe = document.createElement('div');
  document.body.append(probe);
  const computed = (value: string): string => {
    probe.style.borderTop = `1px solid ${value}`;
    return getComputedStyle(probe).borderTopColor;
  };
  const colors = {
    window: computed('var(--surface-0)'),
    bar: computed('var(--surface-1)'),
    line: computed('var(--line-1)'),
  };
  probe.remove();
  return colors;
}

/**
 * The colors that the preview of a color mode card draws its rectangles in, in their order: a
 * fill drawn at an opacity gives the color with that alpha.
 */
function drawnColors(page: Page, card: string): Promise<string[]> {
  return page
    .locator('label.card', { has: page.getByRole('radio', { name: card, exact: true }) })
    .locator('rect')
    .evaluateAll((rects) =>
      rects.map((rect) => {
        const style = getComputedStyle(rect);
        return style.fillOpacity === '1'
          ? style.fill
          : style.fill.replace(/\)$/, ` / ${style.fillOpacity})`);
      }),
    );
}

test('draws the previews of the color modes in the colors of each mode', async () => {
  const browser = await launch([], { firstRun: true });
  try {
    const page = await waitForPage(browser, (url) => url.startsWith('app://setup'));
    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeVisible();
    // A window preview draws the window, the toolbar and the line below it, then two lines.
    await page.emulateMedia({ colorScheme: 'light' });
    const light = await page.evaluate(tokenColors);
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await page.evaluate(tokenColors);
    expect(dark.line).toMatch(/ \/ 0\.6\)$/);
    const look = (colors: typeof light): string[] => [colors.window, colors.bar, colors.line];
    expect((await drawnColors(page, 'Light')).slice(0, 3)).toEqual(look(light));
    expect((await drawnColors(page, 'Dark')).slice(0, 3)).toEqual(look(dark));
    // The system mode shows the light half and the dark half.
    const system = await drawnColors(page, 'System');
    expect([...system.slice(0, 3), ...system.slice(5, 8)]).toEqual([...look(light), ...look(dark)]);
    // The lists of the guide lie inside the same line.
    await page.getByRole('button', { name: 'Continue' }).click();
    const options = page.locator('.options').first();
    await expect(options).toBeVisible();
    expect(await options.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(
      dark.line,
    );
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
