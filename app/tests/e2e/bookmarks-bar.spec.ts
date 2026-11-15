import { expect, test } from '@playwright/test';
import {
  FixtureServer,
  launch,
  menuCount,
  menuEntries,
  overlayAttached,
  overlayMenu,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  waitForPage,
} from './harness.ts';

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
    // The bookmark is added at once; its popover keeps it as it is.
    await (
      await overlayPage(browser)
    )
      .getByRole('dialog', { name: 'Bookmark added' })
      .getByRole('button', { name: 'Done' })
      .click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);

    await address.fill(`${server.origin}/second.html`);
    await address.press('Enter');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture second');
    await bar.getByRole('button', { name: 'Fixture home' }).click();
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture home');

    // A folder of the bar opens a menu with its contents, in the overlay.
    await pressNative(browser, 'O', ['primary', 'shift']);
    const bookmarks = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
    await bookmarks.evaluate(() =>
      window.bridge.invoke('bookmarks.add', { parentId: 1, title: 'Work' }),
    );
    await recordMenus(browser);
    const work = bar.getByRole('button', { name: 'Work' });
    await expect(work).toHaveAttribute('aria-expanded', 'false');
    await work.click();
    const folder = await overlayMenu(browser, 'Work');
    await expect(work).toHaveAttribute('aria-expanded', 'true');
    const empty = process.platform === 'darwin' ? '(Empty)' : '(empty)';
    expect(await menuEntries(folder)).toEqual([empty]);
    await expect(folder.getByRole('menuitem', { name: empty })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await folder.page().keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(work).toHaveAttribute('aria-expanded', 'false');

    // Bookmarks that do not fit in the bar are in the menu of its » button.
    await bookmarks.evaluate(async () => {
      for (let n = 1; n <= 12; n += 1) {
        await window.bridge.invoke('bookmarks.add', {
          parentId: 1,
          title: `A bookmark with a long title ${n}`,
          url: `https://example.com/${n}`,
        });
      }
    });
    const more = bar.getByRole('button', { name: 'More bookmarks' });
    await expect(more).toBeVisible();
    await expect(bar.getByRole('button', { name: 'A bookmark with a long title 12' })).toBeHidden();
    await expect(bar.getByRole('button', { name: 'Fixture home' })).toBeVisible();
    await more.click();
    // The menus of macOS write English in title case, as the empty folder says (Empty) there.
    const hidden = await overlayMenu(
      browser,
      process.platform === 'darwin' ? 'More Bookmarks' : 'More bookmarks',
    );
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    const entries = await menuEntries(hidden);
    expect(entries.at(-1)).toBe('A bookmark with a long title 12');
    expect(entries).not.toContain('Fixture home');
    await hidden.page().keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // No menu of the system opened.
    expect(await menuCount(browser)).toBe(0);

    await pressNative(browser, 'B', ['primary', 'shift']);
    await expect(bar).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('opens bookmarks from the folders of the bookmarks bar, with their folders as submenus', async () => {
  const browser = await launch([], { settings: { 'bookmarks.bar': true } });
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await pressNative(browser, 'O', ['primary', 'shift']);
    const bookmarks = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
    await bookmarks.evaluate(async (origin) => {
      // Bookmarks with long titles before the folder move it into the right half of the bar.
      for (let n = 1; n <= 4; n += 1) {
        await window.bridge.invoke('bookmarks.add', {
          parentId: 1,
          title: `A bookmark with a long title ${n}`,
          url: `https://example.com/${n}`,
        });
      }
      const work = (await window.bridge.invoke('bookmarks.add', {
        parentId: 1,
        title: 'Work',
      })) as { id: number };
      await window.bridge.invoke('bookmarks.add', {
        parentId: work.id,
        title: 'Tom & Jerry',
        url: `${origin}/second.html`,
      });
      const reports = (await window.bridge.invoke('bookmarks.add', {
        parentId: work.id,
        title: 'Reports',
      })) as { id: number };
      await window.bridge.invoke('bookmarks.add', {
        parentId: reports.id,
        title: 'Second',
        url: `${origin}/second.html`,
      });
    }, server.origin);
    await recordMenus(browser);
    const bar = browser.shell.getByRole('toolbar', { name: 'Bookmarks bar' });
    await browser.shell.getByRole('tab', { name: 'Fixture home' }).click();
    // The keyboard opens the folder with its first item focused, and its folders to the side.
    await bar.getByRole('button', { name: 'Work' }).focus();
    await bar.getByRole('button', { name: 'Work' }).press('Enter');
    const work = await overlayMenu(browser, 'Work');
    const overlay = work.page();
    // The menu of a folder lines up with the start of its button, also in the right half of the
    // window, where the browser menu lines up with the end of its button.
    const button = await bar.getByRole('button', { name: 'Work' }).boundingBox();
    const middle = await browser.shell.evaluate(() => innerWidth / 2);
    expect((button?.x ?? 0) + (button?.width ?? 0) / 2).toBeGreaterThan(middle);
    expect(Math.abs(((await work.boundingBox())?.x ?? 0) - (button?.x ?? 0))).toBeLessThan(2);
    // A title shows as it is: its & is no mark of an access key.
    const tom = work.getByRole('menuitem', { name: 'Tom & Jerry' });
    await expect(tom).toBeFocused();
    await overlay.keyboard.press('ArrowDown');
    await expect(work.getByRole('menuitem', { name: 'Reports' })).toBeFocused();
    await overlay.keyboard.press('ArrowRight');
    const reports = await overlayMenu(browser, 'Reports');
    await expect(reports.getByRole('menuitem', { name: 'Second' })).toBeFocused();
    // Enter opens the bookmark in the active tab.
    await overlay.keyboard.press('Enter');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/second.html`, 'app://bookmarks/']);
    // Ctrl or Command with a click opens it in a new tab.
    await bar.getByRole('button', { name: 'Work' }).click();
    await (
      await overlayMenu(browser, 'Work')
    )
      .getByRole('menuitem', { name: 'Tom & Jerry' })
      .click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect.poll(async () => (await shellState(browser.shell)).tabs).toHaveLength(3);
    if (process.platform !== 'darwin') {
      // F10, the key of the browser menu, closes the menu of a folder as well, and opens no
      // other menu in its place.
      await bar.getByRole('button', { name: 'Work' }).click();
      await overlayMenu(browser, 'Work');
      await pressNative(browser, 'F10', [], 'app://overlay');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayAttached(browser)).toBe(false);
      await expect(
        browser.shell.getByRole('button', { name: 'Menu', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
    }
    expect(await menuCount(browser)).toBe(0);
  } finally {
    await browser.close();
  }
});
