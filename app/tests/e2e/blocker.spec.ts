import { expect, test } from '@playwright/test';
import { FixtureServer, launch, waitForPage } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

// The test package carries filter data built from fixtures/blocker: it blocks the script
// fixture-ad.js and the image fixture-tracker.gif of the fixture server.
for (const enabled of [true, false]) {
  test(`loads the blocked requests of a page only when the blocker is ${enabled ? 'on' : 'off'}`, async () => {
    const browser = await launch([], { settings: { 'contentBlocker.enabled': enabled } });
    try {
      const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
      await address.fill(`${server.origin}/blocker.html`);
      await address.press('Enter');
      const page = await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
      await page.waitForLoadState('load');
      const loaded = await page.evaluate(() => ({
        script: (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded === true,
        image: (document.getElementById('tracker') as HTMLImageElement | null)?.naturalWidth === 1,
        page: document.querySelector('p')?.textContent,
      }));
      expect(loaded).toEqual({ script: !enabled, image: !enabled, page: 'Content' });
    } finally {
      await browser.close();
    }
  });
}

test('switches the blocker off from the settings page', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const toggle = settings.getByRole('switch', { name: /Block ads and trackers/ });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect
      .poll(() => settings.evaluate(() => window.bridge.invoke('settings.getAll', {})))
      .toMatchObject({
        settings: expect.arrayContaining([
          { key: 'contentBlocker.enabled', value: false, locked: false },
        ]),
      });
  } finally {
    await browser.close();
  }
});
