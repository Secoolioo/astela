import { expect, test } from '@playwright/test';
import { launch, waitForPage } from './harness.ts';

test('places the tab strip at a side and fits the page next to it', async () => {
  const browser = await launch([], { settings: { 'tabs.position': 'left' } });
  try {
    const page = (): Promise<Electron.Rectangle | undefined> =>
      browser.main.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.contentView.children[1]?.getBounds(),
      );
    const tabs = browser.shell.getByRole('tablist');
    await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
    await expect.poll(async () => (await page())?.x).toBe(240);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('radio', { name: 'Bottom' }).check();
    await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');
    await expect.poll(async () => (await page())?.x).toBe(0);
    const { height } = await browser.shell.evaluate(() => ({ height: window.innerHeight }));
    const strip = await tabs.boundingBox();
    const bounds = await page();
    expect(bounds !== undefined && strip !== null && bounds.y + bounds.height).toBe(
      Math.round(strip?.y ?? 0),
    );
    expect(Math.round((strip?.y ?? 0) + (strip?.height ?? 0))).toBe(height);
  } finally {
    await browser.close();
  }
});
