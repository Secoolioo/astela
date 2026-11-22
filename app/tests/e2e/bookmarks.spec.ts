import { expect, test, type Page } from '@playwright/test';
import {
  FixtureServer,
  launch,
  overlayAttached,
  overlayPage,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('bookmarks a page with the star and edits, moves and removes it on the bookmarks page', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
      .toBe('Fixture home');
    const star = browser.shell.getByRole('button', { name: 'Bookmark this page' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    // The shortcut adds the bookmark and shows it in the popover of the star, which keeps it.
    await pressNative(browser, 'D', ['primary']);
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    const overlay = await overlayPage(browser);
    await overlay
      .getByRole('dialog', { name: 'Bookmark added' })
      .getByRole('button', { name: 'Done' })
      .click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    // The star opens the popover of the bookmark, which removes it.
    await star.click();
    await overlay
      .getByRole('dialog', { name: 'Edit bookmark' })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await overlay
      .getByRole('dialog', { name: 'Bookmark added' })
      .getByRole('button', { name: 'Done' })
      .click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);

    await pressNative(browser, 'O', ['primary', 'shift']);
    const page = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
    await expect(page.getByRole('button', { name: /^Fixture home/ })).toBeVisible();

    // The name of a new folder has the focus, all of it selected, so that typing replaces it
    // and Enter saves it.
    await page.getByRole('button', { name: 'New folder in Other bookmarks' }).click();
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toBeFocused();
    await page.keyboard.type('Work stuff');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Work stuff', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New folder', exact: true })).toHaveCount(0);

    // So has the name of a bookmark that ✎ edits.
    await page.getByRole('button', { name: 'Edit Fixture home' }).click();
    await expect(name).toBeFocused();
    expect(
      await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
    ).toEqual([0, 'Fixture home'.length]);
    await name.fill('Home page');
    await page.getByLabel('Address', { exact: true }).fill('not an address');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert')).toHaveText(/starts with http/);
    await page.getByLabel('Address', { exact: true }).fill(`${server.origin}/index.html`);
    const folder = page.getByLabel('Folder', { exact: true });
    const work = await folder.locator('option', { hasText: 'Work' }).getAttribute('value');
    await folder.selectOption(work ?? '');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('This folder is empty.')).toBeVisible();
    await page.getByRole('button', { name: 'Work stuff', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Home page/ })).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search bookmarks' }).fill('home');
    await expect(page.getByRole('button', { name: /^Home page/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search bookmarks' }).fill('');

    await page.getByRole('button', { name: 'Remove Work stuff' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Home page/ })).toHaveCount(0);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.bookmarked)
      .toBe(false);
  } finally {
    await browser.close();
  }
});

/** Opens a page of the fixture server in the first tab, once it has its title. */
async function open(browser: Browser, name: string, title: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${server.origin}/${name}`);
  await address.press('Enter');
  await waitForPage(browser, (url) => url.endsWith(`/${name}`));
  await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.title).toBe(title);
}

/** The bookmarks of the profile, as the bookmarks page lists them, in a tab of its own. */
async function stored(bookmarks: Page): Promise<unknown> {
  return (
    (await bookmarks.evaluate(() => window.bridge.invoke('bookmarks.list', {}))) as {
      items: { parentId: number | null; title: string; url: string | null }[];
    }
  ).items.flatMap((item) => (item.url === null ? [] : [[item.title, item.parentId, item.url]]));
}

test('adds a bookmark with the star and names, moves or removes it in its popover', async () => {
  let browser = await launch();
  try {
    await open(browser, 'index.html', 'Fixture home');
    const url = `${server.origin}/index.html`;
    const star = browser.shell.getByRole('button', { name: 'Bookmark this page' });
    await expect(star).toHaveAttribute('aria-haspopup', 'dialog');
    await star.click();
    const overlay = await overlayPage(browser);
    const added = overlay.getByRole('dialog', { name: 'Bookmark added' });
    await expect(added).toBeVisible();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(star).toHaveAttribute('aria-expanded', 'true');
    // The name takes the focus, all of it selected, so that typing replaces it.
    const name = added.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('Fixture home');
    expect(
      await name.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
    ).toEqual([0, 'Fixture home'.length]);
    await name.fill('Home');
    const folder = added.getByRole('listbox', { name: 'Folder' });
    await expect(folder).toHaveJSProperty('size', 6);
    await folder.selectOption({ label: 'Other bookmarks' });
    await added.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(star).toHaveAttribute('aria-expanded', 'false');
    await pressNative(browser, 'O', ['primary', 'shift']);
    const bookmarks = await waitForPage(browser, (current) =>
      current.startsWith('app://bookmarks'),
    );
    await expect.poll(() => stored(bookmarks)).toEqual([['Home', 2, url]]);
    // A second click on the star edits the bookmark. A folder lists below the folder it is in,
    // indented, and Enter in the list saves, as Done does.
    const { id: travel } = (await bookmarks.evaluate(() =>
      window.bridge.invoke('bookmarks.add', { parentId: 2, title: 'Travel' }),
    )) as { id: number };
    await browser.shell.getByRole('tab', { name: 'Fixture home' }).click();
    await star.click();
    const edit = overlay.getByRole('dialog', { name: 'Edit bookmark' });
    await expect(edit.getByRole('textbox', { name: 'Name' })).toHaveValue('Home');
    const list = edit.getByRole('listbox', { name: 'Folder' });
    await expect(list).toHaveValue('2');
    const indent = (label: string): Promise<number> =>
      list
        .getByRole('option', { name: label, exact: true })
        .evaluate((option) => Number.parseFloat(getComputedStyle(option).paddingInlineStart));
    expect(await indent('Travel')).toBeGreaterThan(await indent('Other bookmarks'));
    await list.focus();
    await overlay.keyboard.press('ArrowDown');
    await expect(list).toHaveValue(String(travel));
    await overlay.keyboard.press('Enter');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect.poll(() => stored(bookmarks)).toEqual([['Home', travel, url]]);
    // Escape closes without a change.
    await star.click();
    await expect(edit.getByRole('textbox', { name: 'Name' })).toHaveValue('Home');
    await edit.getByRole('textbox', { name: 'Name' }).fill('Changed');
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect.poll(() => stored(bookmarks)).toEqual([['Home', travel, url]]);
    // A click next to the popover saves the name, as Done does.
    await star.click();
    await expect(edit.getByRole('textbox', { name: 'Name' })).toHaveValue('Home');
    await edit.getByRole('textbox', { name: 'Name' }).fill('Clicked');
    const size = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const box = await edit.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThan(size.height - 20);
    await overlay.mouse.click(10, size.height - 10);
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect.poll(() => stored(bookmarks)).toEqual([['Clicked', travel, url]]);
    // The shortcut opens the same popover, whose Remove removes every bookmark of the page.
    await pressNative(browser, 'D', ['primary'], server.origin);
    await expect(edit).toBeVisible();
    await edit.getByRole('button', { name: 'Remove' }).click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => stored(bookmarks)).toEqual([]);
  } finally {
    await browser.close();
  }
  // Without the star in the toolbar, the shortcut opens the popover at the menu button.
  browser = await launch([], { settings: { 'toolbar.items': ['shield', 'downloads'] } });
  try {
    await open(browser, 'index.html', 'Fixture home');
    await expect(browser.shell.getByRole('button', { name: 'Bookmark this page' })).toHaveCount(0);
    await pressNative(browser, 'D', ['primary'], server.origin);
    const overlay = await overlayPage(browser);
    const added = overlay.getByRole('dialog', { name: 'Bookmark added' });
    await expect(added).toBeVisible();
    const button = await browser.shell
      .getByRole('button', { name: 'Menu', exact: true })
      .boundingBox();
    const popover = await added.boundingBox();
    // The popover lies below the menu button, its end at the button's end.
    expect(
      Math.abs((popover?.x ?? 0) + (popover?.width ?? 0) - (button?.x ?? 0) - (button?.width ?? 0)),
    ).toBeLessThan(2);
    expect(popover?.y ?? 0).toBeGreaterThan((button?.y ?? 0) + (button?.height ?? 0));
    await expect(browser.shell.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await added.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
  } finally {
    await browser.close();
  }
});

test('keeps the popover of the star open while an input method composes its name', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html', 'Fixture home');
    await browser.shell.getByRole('button', { name: 'Bookmark this page' }).click();
    const overlay = await overlayPage(browser);
    const added = overlay.getByRole('dialog', { name: 'Bookmark added' });
    const name = added.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await name.fill('');
    // An input method composes a word; Escape cancels its conversion, not the popover.
    const session = await overlay.context().newCDPSession(overlay);
    await session.send('Input.imeSetComposition', {
      text: 'にほん',
      selectionStart: 3,
      selectionEnd: 3,
    });
    await expect(name).toHaveValue('にほん');
    await name.evaluate((input) =>
      input.addEventListener(
        'keydown',
        (event) =>
          input.setAttribute('data-composing', String((event as KeyboardEvent).isComposing)),
        { once: true },
      ),
    );
    await overlay.keyboard.press('Escape');
    await expect(name).toHaveAttribute('data-composing', 'true');
    await new Promise((done) => setTimeout(done, 300));
    await expect(added).toBeVisible();
    expect(await overlayAttached(browser)).toBe(true);
    // Once the word is written, Escape closes the popover again.
    await session.send('Input.insertText', { text: '日本' });
    await expect(name).toHaveValue('日本');
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
  } finally {
    await browser.close();
  }
});
