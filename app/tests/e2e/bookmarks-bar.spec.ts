import { expect, test } from '@playwright/test';
import type * as Electron from 'electron';
import { FixtureServer, launch, pressNative, shellState, waitForPage } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('shows the bookmarks bar with its bookmarks and folders', async () => {
  const browser = await launch();
  try {
    const bar = browser.shell.getByRole('toolbar', { name: 'Bookmarks bar' });
    await expect(bar).toHaveCount(0);
    await pressNative(browser, 'B', ['primary', 'shift']);
    await expect(bar).toHaveText('Pages you bookmark with the star appear here.');

    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture home');
    await pressNative(browser, 'D', ['primary']);
    await expect(bar.getByRole('button', { name: 'Fixture home' })).toBeVisible();

    await address.fill(`${server.origin}/second.html`);
    await address.press('Enter');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture second');
    await bar.getByRole('button', { name: 'Fixture home' }).click();
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture home');

    // A folder of the bar opens a menu with its contents.
    await pressNative(browser, 'O', ['primary', 'shift']);
    const bookmarks = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
    await bookmarks.evaluate(() =>
      window.bridge.invoke('bookmarks.add', { parentId: 1, title: 'Work' }),
    );
    await browser.main.evaluate(({ Menu }) => {
      const recorded: Electron.Menu[] = [];
      Object.assign(globalThis, { recordedMenus: recorded });
      Menu.prototype.popup = function popup(this: Electron.Menu) {
        recorded.push(this);
      };
    });
    await bar.getByRole('button', { name: 'Work' }).click();
    await expect
      .poll(() =>
        browser.main.evaluate(() =>
          (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
            .at(-1)
            ?.items.map((item) => [item.label, item.enabled]),
        ),
      )
      .toEqual([[process.platform === 'darwin' ? '(Empty)' : '(empty)', false]]);

    await pressNative(browser, 'B', ['primary', 'shift']);
    await expect(bar).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
