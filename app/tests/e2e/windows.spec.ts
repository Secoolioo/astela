import { expect, test, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';
import {
  FixtureServer,
  launch,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

async function open(browser: Browser, url: string): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
  return waitForPage(browser, (current) => current === url);
}

function windowCount(browser: Browser): Promise<number> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
}

test('keeps the opener of a page that a script opens, which can close itself', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a tab' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const opened = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    await expect(opened).toHaveTitle('Fixture opened by a page');
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveText(
      'Fixture opened by a page',
    );
    await opened.getByRole('button', { name: 'Reply' }).click();
    await expect(opener.locator('#message')).toHaveText('Hello from the opened page');
    // A page that a script opened may close itself, and its tab closes with it.
    // The page closes itself a moment later, so the call into it has returned by then.
    await opened.evaluate(() => void setTimeout(() => window.close(), 50));
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    expect(await windowCount(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('opens a popup with a size in a window of its own, which closes with its page', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    await expect.poll(() => windowCount(browser)).toBe(2);
    const size = await browser.main.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((window) => window.getBounds().width),
    );
    expect(size).toContain(520);
    const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    await expect(popup).toHaveTitle('Fixture opened by a page');
    await popup.getByRole('button', { name: 'Reply' }).click();
    await expect(opener.locator('#message')).toHaveText('Hello from the opened page');
    await popup.evaluate(() => void setTimeout(() => window.close(), 50));
    await expect.poll(() => windowCount(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('opens a link in the background with a middle click, and in a new window with Shift', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    const link = opener.getByRole('link', { name: 'A link' });
    await link.click({ button: 'middle' });
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveText('Fixture opener');
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    await link.click({ modifiers: ['Shift'] });
    await expect.poll(() => windowCount(browser)).toBe(2);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    // The new window shows only the link.
    await expect
      .poll(async () => {
        const others = browser.cdp
          .contexts()
          .flatMap((context) => context.pages())
          .filter((page) => page.url().startsWith('app://shell') && page !== browser.shell);
        return Promise.all(
          others.map(async (page) => (await shellState(page)).tabs.map((tab) => tab.url)),
        );
      })
      .toEqual([[`${server.origin}/second.html`]]);
  } finally {
    await browser.close();
  }
});

test('opens new windows from the shortcut and the menu, and keeps where they were', async () => {
  const browser = await launch();
  const { profile } = browser;
  try {
    try {
      await open(browser, `${server.origin}/opener.html`);
      await pressNative(browser, 'N', ['primary'], server.origin);
      await expect.poll(() => windowCount(browser)).toBe(2);
      // The menu offers new windows too, with the other tools.
      await browser.main.evaluate(({ Menu }) => {
        const recorded: Electron.Menu[] = [];
        Object.assign(globalThis, { recordedMenus: recorded });
        Menu.prototype.popup = function popup(this: Electron.Menu) {
          recorded.push(this);
        };
      });
      await browser.shell.getByRole('button', { name: 'Menu', exact: true }).click();
      const newWindow = mac ? 'New Window' : 'New &window';
      await expect
        .poll(() =>
          browser.main.evaluate(() =>
            (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
              .at(-1)
              ?.items.map((item) => item.label),
          ),
        )
        .toEqual(
          expect.arrayContaining(
            mac
              ? [newWindow, 'Downloads', 'Zoom', 'Find…', 'Print…', 'More Tools', 'Quit Astela']
              : [newWindow, '&Downloads', '&Zoom', '&Find…', '&Print…', 'More t&ools'],
          ),
        );
      await browser.main.evaluate((_electron, label) => {
        (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
          .at(-1)
          ?.items.find((item) => item.label === label)
          ?.click();
      }, newWindow);
      await expect.poll(() => windowCount(browser)).toBe(3);
      // The first window goes to a place of its own, which the next start restores. It fits
      // the smallest screen of the test machines, 1024 × 768 with the menu bar and the Dock
      // of macOS, because a larger window is fitted to its screen.
      await browser.main.evaluate(({ BaseWindow }) => {
        const first = BaseWindow.getAllWindows().find((window) => window.id === 1);
        first?.setBounds({ x: 40, y: 60, width: 800, height: 500 });
      });
    } finally {
      await browser.close({ keepProfile: true });
    }
    const again = await launch([], { profile });
    try {
      await expect.poll(() => windowCount(again)).toBe(3);
      const bounds = await again.main.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows().map((window) => window.getBounds()),
      );
      expect(bounds).toContainEqual({ x: 40, y: 60, width: 800, height: 500 });
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});
