import { expect, test } from '@playwright/test';
import { FixtureServer, launch, waitForPage } from './harness.ts';

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

test('shows the icon of a page in its tab, loaded without cookies', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/icon.html`);
    await address.press('Enter');
    const tab = browser.shell.getByRole('tab', { name: 'Page with an icon' });
    await expect(tab.locator('.favicon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const icon = server.requests.find((request) => request.path === '/image.png');
    expect(icon?.headers.cookie).toBeUndefined();
    // The browser's own pages show an icon of their own.
    await address.fill('app://settings');
    await address.press('Enter');
    await expect(
      browser.shell.getByRole('tab', { name: 'Settings' }).locator('.favicon svg'),
    ).toBeVisible();
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('mutes a tab that plays sound and turns its sound on again', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/sound.html`);
    await address.press('Enter');
    const muted = (): Promise<boolean | undefined> =>
      browser.main.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith('/sound.html'))
          ?.isAudioMuted(),
      );
    const tab = browser.shell.getByRole('tab', { name: 'Sound' });
    await tab.getByRole('button', { name: 'Mute tab' }).click();
    await expect(tab.getByRole('button', { name: 'Unmute tab' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await muted()).toBe(true);
    await tab.getByRole('button', { name: 'Unmute tab' }).click();
    await expect(tab.getByRole('button', { name: 'Mute tab' })).toBeVisible();
    expect(await muted()).toBe(false);
  } finally {
    await browser.close();
    await server.stop();
  }
});
