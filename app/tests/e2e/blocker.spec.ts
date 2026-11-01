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
      // Scriptlets run before the page's own scripts, and elements are hidden, in the page
      // and in its frame.
      const frame = page.frames().find((f) => f.url().endsWith('/blocker-frame.html'));
      for (const target of [page, frame]) {
        expect(
          await target?.evaluate(
            () => (window as unknown as { scriptletBeforePage?: boolean }).scriptletBeforePage,
          ),
        ).toBe(enabled);
        await expect
          .poll(() =>
            target?.evaluate(() => {
              const ad = document.querySelector('.fixture-ad');
              return ad === null ? 'missing' : getComputedStyle(ad).display;
            }),
          )
          .toBe(enabled ? 'none' : 'block');
      }
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

test('counts blocked requests and switches the blocker off for one site', async () => {
  const browser = await launch();
  try {
    await browser.main.evaluate(({ Menu }) => {
      const recorded: Electron.Menu[] = [];
      Object.assign(globalThis, { recordedMenus: recorded });
      Menu.prototype.popup = function popup(this: Electron.Menu) {
        recorded.push(this);
      };
    });
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocker.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
    const shield = browser.shell.getByRole('button', { name: 'Content blocker: 2 blocked' });
    await expect(shield).toBeVisible();
    await shield.click();
    const items = (): Promise<string[] | undefined> =>
      browser.main.evaluate(() =>
        (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
          .at(-1)
          ?.items.map((item) => (item.type === 'separator' ? '-' : item.label.replaceAll('&', ''))),
      );
    await expect
      .poll(items)
      .toEqual(
        process.platform === 'darwin'
          ? [
              'Blocked on This Page: 2',
              '-',
              'Block Ads on 127.0.0.1',
              '-',
              'Content Blocker Settings…',
            ]
          : [
              'Blocked on this page: 2',
              '-',
              'Block ads on 127.0.0.1',
              '-',
              'Content blocker settings',
            ],
      );
    await browser.main.evaluate(() => {
      const menu = (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus.at(
        -1,
      );
      menu?.items[2]?.click();
    });
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded),
      )
      .toBe(true);
  } finally {
    await browser.close();
  }
});
