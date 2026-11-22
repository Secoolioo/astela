import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtInThemes } from '../../src/shared/themes.ts';
import {
  chooseMenuItem,
  FixtureServer,
  focusPage,
  launch,
  menuEntries,
  openBrowserMenu,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  startAgain,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';
/** The key of the reader view, and its modifiers. */
const readerKey = mac ? 'R' : 'F9';
const readerModifiers: Parameters<typeof pressNative>[2] = mac ? ['primary', 'alt'] : [];
/** The start of the address of a reader view. */
const readerAddress = 'data:text/html';

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/**
 * Opens an address in the active tab, and returns its page once it has the focus.
 * @param address - The name of the address bar, in the language of the browser.
 */
async function open(
  browser: Browser,
  url: string,
  address = 'Address and search bar',
): Promise<Page> {
  const field = browser.shell.getByRole('textbox', { name: address });
  await field.fill(url);
  await field.press('Enter');
  const page = await waitForPage(browser, (current) => current === url);
  // Keys reach only the view that has the focus, which the page gets once it shows.
  await expect
    .poll(() =>
      browser.main.evaluate(
        ({ webContents }, shown) =>
          webContents
            .getAllWebContents()
            .some((contents) => contents.getURL() === shown && contents.isFocused()),
        url,
      ),
    )
    .toBe(true);
  return page;
}

/** The button of the reader view next to the address bar. */
function readerButton(browser: Browser, name = 'Reader view'): Locator {
  return browser.shell.getByRole('button', { name, exact: true });
}

/**
 * The page of the reader view, once it has painted its article: Chromium drops the keys for a
 * new page until then.
 */
async function readerPage(browser: Browser): Promise<Page> {
  const page = await waitForPage(browser, (url) => url.startsWith(readerAddress));
  await page.waitForFunction(
    () => performance.getEntriesByName('first-contentful-paint').length > 0,
  );
  return page;
}

/** How many reader views the browser process has. */
function readerViews(browser: Browser): Promise<number> {
  return browser.main.evaluate(
    ({ webContents }, start) =>
      webContents
        .getAllWebContents()
        .filter((contents) => !contents.isDestroyed() && contents.getURL().startsWith(start))
        .length,
    readerAddress,
  );
}

/** What the reader view of each tab is: none, available or open. */
async function readerStates(browser: Browser): Promise<string[]> {
  return (await shellState(browser.shell)).tabs.map((tab) => tab.reader);
}

/** The font size of the first paragraph of the article in the reader view. */
function paragraphSize(reader: Page): Promise<string> {
  return reader
    .locator('p', { hasText: 'The first paragraph' })
    .evaluate((element) => getComputedStyle(element).fontSize);
}

/** The width of the first picture of a figure once it has loaded, or -1 while it loads. */
function pictureWidth(page: Page): Promise<number> {
  return page
    .locator('figure img')
    .evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : -1));
}

/**
 * Clicks the back button of a mouse over a reader view through the DevTools protocol, as
 * `clickHistoryButton` does over a page. The reader view may end before it answers the release.
 */
async function clickBackOver(reader: Page): Promise<void> {
  const session = await reader.context().newCDPSession(reader);
  const event = { x: 200, y: 200, button: 'back', clickCount: 1 } as const;
  await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...event });
  await session
    .send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...event })
    .catch((error: unknown) => {
      if (!String(error).includes('has been closed')) throw error;
    });
}

/** Whether a view whose address starts so has the focus. */
function viewFocused(browser: Browser, start: string): Promise<boolean> {
  return browser.main.evaluate(
    ({ webContents }, prefix) =>
      webContents
        .getAllWebContents()
        .some((contents) => contents.getURL().startsWith(prefix) && contents.isFocused()),
    start,
  );
}

/** The window that has the focus, by its id. */
function focusedWindow(browser: Browser): Promise<number | null> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()?.id ?? null);
}

/** Ends the renderer of a page at once, as a crash does, the same way on every system. */
async function crash(browser: Browser, url: string): Promise<void> {
  await browser.main.evaluate(({ webContents }, address) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL() === address);
    if (contents === undefined) throw new Error(`No page shows ${address}`);
    process.kill(contents.getOSProcessId(), 'SIGKILL');
  }, url);
}

/** Notes in a page the keys that reach it, by their place on the keyboard, without modifiers. */
async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(window, 'keys', seen);
    addEventListener(
      'keydown',
      (event) => {
        if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) seen.push(event.code);
      },
      true,
    );
  });
}

/** The keys that reached a page since {@link recordKeys}. */
function keysOf(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, 'keys'));
}

/**
 * The scripts of the reader view's code that the browser process has loaded, as its inspector
 * finds them among the scripts that it parsed.
 */
function readerCode(browser: Browser): Promise<string[]> {
  return browser.main.evaluate(async () => {
    const { Session } = process.getBuiltinModule('node:inspector');
    const inspector = new Session();
    const scripts: string[] = [];
    inspector.on('Debugger.scriptParsed', ({ params }) => {
      if (/\/out\/main\/reader-[^/]*\.js$/.test(params.url)) scripts.push(params.url);
    });
    inspector.connect();
    const post = (method: string): Promise<void> =>
      new Promise((done, fail) => {
        inspector.post(method, (error) => {
          if (error === null) done();
          else fail(error);
        });
      });
    try {
      await post('Debugger.enable');
      return scripts;
    } finally {
      await post('Debugger.disable');
      inspector.disconnect();
    }
  });
}

test('shows the article of a page in a reader view and the page as it was afterwards', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/index.html`);
    // The page has loaded and was checked; it has no article, so it gets no button.
    await new Promise((done) => setTimeout(done, 1000));
    await expect(readerButton(browser)).toHaveCount(0);
    expect(await readerStates(browser)).toEqual(['none']);
    const url = `${server.origin}/article.html`;
    const page = await open(browser, url);
    const button = readerButton(browser);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(400);
    const loaded = await page.evaluate(() => performance.timeOrigin);
    await button.click();
    const reader = await readerPage(browser);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Fixture article title');
    const body = reader.locator('body');
    await expect(body).toContainText('Ada Example');
    await expect(body).toContainText('1 min read');
    await expect(reader.locator('p strong')).toHaveText('bold words');
    await expect(reader.locator('p em')).toHaveText('italic words');
    await expect(reader.getByRole('link', { name: 'a link' })).toHaveAttribute(
      'href',
      `${server.origin}/second.html`,
    );
    await expect(reader.locator('p code')).toHaveText('inline code');
    await expect(reader.locator('figure img')).toHaveAttribute('src', `${server.origin}/image.png`);
    await expect(reader.locator('figure figcaption')).toHaveText('Fixture caption');
    await expect(reader.locator('ul > li')).toHaveText([
      'Fixture first item of the list',
      'Fixture second item of the list',
    ]);
    await expect(reader.locator('blockquote')).toContainText('Fixture quote of a sailor');
    await expect(reader.locator('pre')).toHaveText("const fixture = 'block of code';");
    const text = await reader.evaluate(() => document.documentElement.textContent);
    for (const left of [
      'Fixture navigation link',
      'Fixture cookie notice',
      'Fixture related',
      'Fixture comment',
      'Fixture footer',
      'Fixture hidden text',
      'Fixture invisible text',
    ]) {
      expect(text).not.toContain(left);
    }
    await expect(reader.locator('script')).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await readerStates(browser)).toEqual(['open']);
    // The tab still shows the address of the page.
    await expect(
      browser.shell.getByRole('textbox', { name: 'Address and search bar' }),
    ).toHaveValue(url);
    await button.click();
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(await readerStates(browser)).toEqual(['available']);
    // The page did not load again, and is where it was.
    expect(await page.evaluate(() => [scrollY, performance.timeOrigin])).toEqual([400, loaded]);
  } finally {
    await browser.close();
  }
});

test('reads the article in an isolated world that the scripts of the page cannot see', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/article.html`;
    await open(browser, url);
    // The page notes calls of the functions that read its DOM, and changes of its DOM.
    const observed = (): Promise<unknown> =>
      browser.main.evaluate(
        ({ webContents }, address) =>
          webContents
            .getAllWebContents()
            .find((contents) => contents.getURL() === address)
            ?.executeJavaScript('window.__observed'),
        url,
      );
    const button = readerButton(browser);
    await expect(button).toBeVisible();
    expect(await observed()).toEqual([]);
    await button.click();
    const reader = await readerPage(browser);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Fixture article title');
    expect(await observed()).toEqual([]);
    await button.click();
    await expect.poll(() => readerViews(browser)).toBe(0);
    // A page that lets no script write markup has its article read, too.
    await open(browser, `${server.origin}/article-tt.html`);
    await button.click();
    const strict = await readerPage(browser);
    await expect(strict.getByRole('heading', { level: 1 })).toHaveText('Fixture trusted types');
    await expect(strict.locator('body')).toContainText('The second paragraph is long enough');
  } finally {
    await browser.close();
  }
});

test('opens and closes with its shortcut, Back and its links', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/article.html`;
    const second = `${server.origin}/second.html`;
    const page = await open(browser, url);
    const button = readerButton(browser);
    await expect(button).toBeVisible();
    const loaded = await page.evaluate(() => performance.timeOrigin);
    // The key works in the page and in the reader view.
    await pressNative(browser, readerKey, readerModifiers, server.origin);
    let reader = await readerPage(browser);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Fixture article title');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await pressNative(browser, readerKey, readerModifiers, readerAddress);
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    // Back ends the reader view, and the page stays as it was.
    await pressNative(browser, readerKey, readerModifiers, server.origin);
    await readerPage(browser);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await pressNative(browser, mac ? '[' : 'Left', [mac ? 'primary' : 'alt'], readerAddress);
    await expect.poll(() => readerViews(browser)).toBe(0);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await expect(address).toHaveValue(url);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loaded);
    // A link of the reader view opens in its tab, which ends the reader view.
    await button.click();
    reader = await readerPage(browser);
    // The click ends the reader view, whose page can close before the click reports back.
    await reader
      .getByRole('link', { name: 'a link' })
      .click()
      .catch((error: unknown) => {
        if (!String(error).includes('has been closed')) throw error;
      });
    await expect(address).toHaveValue(second);
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect(button).toHaveCount(0);
    await browser.shell.getByRole('button', { name: 'Back' }).click();
    await expect(address).toHaveValue(url);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    // A middle click opens the link in a new tab behind it, as on the page.
    await button.click();
    reader = await readerPage(browser);
    await reader.getByRole('link', { name: 'a link' }).click({ button: 'middle' });
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([url, second]);
    expect(await readerStates(browser)).toEqual(['open', 'none']);
    await expect(address).toHaveValue(url);
    expect(await readerViews(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('shows the article without a network', async () => {
  const own = new FixtureServer();
  await own.start();
  const browser = await launch();
  try {
    await open(browser, `${own.origin}/article.html`);
    const button = readerButton(browser);
    await expect(button).toBeVisible();
    await own.stop();
    await button.click();
    const reader = await readerPage(browser);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Fixture article title');
    await expect(reader.locator('p', { hasText: 'The first paragraph' })).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('speaks German', async () => {
  const browser = await launch(['--lang=de']);
  try {
    await open(browser, `${server.origin}/article.html`, 'Adress- und Suchleiste');
    const button = readerButton(browser, 'Leseansicht');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    const reader = await readerPage(browser);
    await expect(reader.locator('body')).toContainText('1 Min. Lesezeit');
    // The date and the reading time are the browser's texts in an English article, and say so.
    await expect(reader.locator('header span[lang^="de"]')).toHaveText([
      '5. März 2024',
      '1 Min. Lesezeit',
    ]);
    await expect(reader.locator('html')).toHaveAttribute('lang', 'en');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await browser.close();
  }
});

test('follows the theme, fonts, text size and zoom of the browser', async () => {
  const browser = await launch([], {
    settings: {
      'appearance.colorMode': 'dark',
      'appearance.theme': 'forest',
      'fonts.size': 20,
      'reader.font': 'serif',
    },
  });
  try {
    const url = `${server.origin}/article.html`;
    const page = await open(browser, url);
    await readerButton(browser).click();
    const reader = await readerPage(browser);
    // Playwright emulates a light color scheme in the pages it attaches to; without it, the
    // reader view has the color mode of the browser.
    await reader.emulateMedia({ colorScheme: null });
    const surface = (): Promise<string> =>
      reader.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim(),
      );
    await expect.poll(surface).toBe(builtInThemes.forest.dark['surface-1']);
    // Lines between parts, such as the bar of a quote, are as calm as the lines of the browser in
    // dark mode: the border color at 60 %.
    const calm = await reader.evaluate((border) => {
      const probe = document.createElement('div');
      probe.style.color = `color-mix(in oklch, ${border} 60%, transparent)`;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, builtInThemes.forest.dark['border-1']);
    await expect
      .poll(() =>
        reader
          .locator('blockquote')
          .evaluate((element) => getComputedStyle(element).borderInlineStartColor),
      )
      .toBe(calm);
    await expect.poll(() => paragraphSize(reader)).toBe('22.5px');
    expect(
      await reader
        .locator('p', { hasText: 'The first paragraph' })
        .evaluate((element) => getComputedStyle(element).fontFamily),
    ).toBe('serif');
    // The zoom keys zoom the text of the reader view, not the page under it.
    await pressNative(browser, '=', ['primary'], readerAddress);
    await expect.poll(() => paragraphSize(reader)).toBe('24.75px');
    const zoom = browser.shell.getByRole('button', { name: /^Zoom 110\s?%/ });
    await expect(zoom).toBeVisible();
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
    await zoom.click();
    await expect.poll(() => paragraphSize(reader)).toBe('22.5px');
    await expect(browser.shell.getByRole('button', { name: /^Zoom/ })).toBeHidden();
    // A new theme reaches the open reader view at once.
    await pressNative(browser, 'T', ['primary'], readerAddress);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await expect(address).toBeFocused();
    await address.fill('app://settings/#appearance.theme');
    await address.press('Enter');
    const settings = await waitForPage(browser, (current) => current.startsWith('app://settings'));
    await settings.evaluate(() =>
      window.bridge.invoke('settings.set', { key: 'appearance.theme', value: 'ocean' }),
    );
    await expect.poll(surface).toBe(builtInThemes.ocean.dark['surface-1']);
    // The settings that the browser saved have the new theme, and no site with a zoom of its own.
    const saved = (): Record<string, unknown> => {
      try {
        const file = readFileSync(join(browser.profile, 'data', 'settings.json'), 'utf8');
        const parsed: unknown = JSON.parse(file);
        return typeof parsed === 'object' && parsed !== null && 'user' in parsed
          ? (parsed.user as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    };
    await expect.poll(() => saved()['appearance.theme']).toBe('ocean');
    expect(saved()['zoom.sites']).toBeUndefined();
    await browser.shell.getByRole('tab').first().click();
    await expect(readerButton(browser)).toHaveAttribute('aria-pressed', 'true');
    expect(await readerViews(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('finds and prints in the reader view', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/article.html`;
    await open(browser, url);
    await readerButton(browser).click();
    const reader = await readerPage(browser);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Fixture article title');
    await pressNative(browser, 'F', ['primary'], readerAddress);
    const find = browser.shell.getByRole('search', { name: 'Find in page' });
    const field = find.getByRole('searchbox', { name: 'Find in page' });
    await expect(field).toBeFocused();
    await field.fill('Fixture caption');
    await expect(find).toContainText('1 of 1');
    // Only the page has its navigation.
    await field.fill('Fixture navigation link');
    await expect(find).toContainText('No matches');
    await field.press('Escape');
    await expect(find).toBeHidden();
    // Printing prints the reader view; the test only notes which page asked for it.
    await browser.main.evaluate(
      ({ webContents }, { page, start }) => {
        const printed: string[] = [];
        Reflect.set(globalThis, 'printed', printed);
        for (const contents of webContents.getAllWebContents()) {
          const address = contents.getURL();
          if (address === page) contents.print = () => void printed.push('page');
          else if (address.startsWith(start)) contents.print = () => void printed.push('reader');
        }
      },
      { page: url, start: readerAddress },
    );
    await pressNative(browser, 'P', ['primary'], readerAddress);
    await expect
      .poll(() => browser.main.evaluate(() => Reflect.get(globalThis, 'printed') as unknown))
      .toEqual(['reader']);
  } finally {
    await browser.close();
  }
});

test('offers the reader view in the browser menu unless its setting turns it off', async () => {
  const url = `${server.origin}/article.html`;
  const name = mac ? 'Reader View' : 'Reader view';
  const browser = await launch();
  try {
    await open(browser, url);
    await expect(readerButton(browser)).toBeVisible();
    let menu = await openBrowserMenu(browser);
    expect(await menuEntries(menu)).toContain(mac ? 'Reader View ⌥⌘R' : 'Reader view F9');
    let item = menu.getByRole('menuitemcheckbox', { name, exact: true });
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await item.click();
    await readerPage(browser);
    await expect(readerButton(browser)).toHaveAttribute('aria-pressed', 'true');
    menu = await openBrowserMenu(browser);
    item = menu.getByRole('menuitemcheckbox', { name, exact: true });
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await item.click();
    await expect.poll(() => readerViews(browser)).toBe(0);
  } finally {
    await browser.close();
  }
  const off = await launch([], { settings: { 'reader.enabled': false } });
  try {
    const page = await open(off, url);
    await new Promise((done) => setTimeout(done, 1000));
    await expect(readerButton(off)).toHaveCount(0);
    expect(await readerStates(off)).toEqual(['none']);
    // The key of the reader view reaches the page.
    await recordKeys(page);
    await pressNative(off, readerKey, readerModifiers, server.origin);
    await expect.poll(() => keysOf(page)).toEqual([mac ? 'KeyR' : 'F9']);
    await new Promise((done) => setTimeout(done, 1000));
    expect(await readerViews(off)).toBe(0);
    const menu = await openBrowserMenu(off);
    const entries = await menuEntries(menu);
    expect(entries).toContain(mac ? 'Find… ⌘F' : 'Find… Ctrl+F');
    expect(entries.filter((entry) => entry.startsWith(name))).toEqual([]);
  } finally {
    await off.close();
  }
});

test("shows no reader view on the browser's own pages and on problems, which end it", async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/article.html`;
    await open(browser, url);
    const button = readerButton(browser);
    await expect(button).toBeVisible();
    const activeTitle = async (): Promise<string | undefined> => {
      const state = await shellState(browser.shell);
      return state.tabs.find((tab) => tab.id === state.activeTabId)?.title;
    };
    // Back shows the new tab page again, one of the browser's own pages.
    await browser.shell.getByRole('button', { name: 'Back' }).click();
    await expect.poll(activeTitle).toBe('New tab');
    await expect(button).toHaveCount(0);
    expect(await readerStates(browser)).toEqual(['none']);
    const menu = await openBrowserMenu(browser);
    await expect(
      menu.getByRole('menuitemcheckbox', { name: mac ? 'Reader View' : 'Reader view' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await menu.press('Escape');
    await expect(menu).toBeHidden();
    // A page whose renderer is gone shows its problem, without the button.
    await browser.shell.getByRole('button', { name: 'Forward' }).click();
    await expect(button).toBeVisible();
    await crash(browser, url);
    const problem = browser.shell.getByRole('region', { name: 'This page crashed' });
    await expect(problem).toBeVisible();
    await expect(button).toHaveCount(0);
    expect(await readerStates(browser)).toEqual(['none']);
    // A problem of the page ends its reader view, too.
    await problem.getByRole('button', { name: 'Reload' }).click();
    await button.click();
    await readerPage(browser);
    await crash(browser, url);
    await expect(problem).toBeVisible();
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect(button).toHaveCount(0);
    expect(await readerStates(browser)).toEqual(['none']);
  } finally {
    await browser.close();
  }
});

test('has no reader view for a tab that sleeps, and checks its page again once it wakes', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/article.html`);
    await expect(readerButton(browser)).toBeVisible();
    // Another tab shows, and the tab of the article goes to sleep from its menu.
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    await recordMenus(browser);
    const tab = browser.shell.getByRole('tab', { name: /Fixture article title/ });
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [mac ? 'Put Tab to Sleep' : 'Put tab to sleep']);
    await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.sleeping).toBe(true);
    expect(await readerStates(browser)).toEqual(['none', 'none']);
    // It wakes as it shows, and its page has its article again once it has loaded.
    await tab.click();
    await expect(readerButton(browser)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await browser.close();
  }
});

test('shows the reader view again once a tab that went to sleep while it showed has woken', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/article.html`);
    await readerButton(browser).click();
    await readerPage(browser);
    await expect(readerButton(browser)).toHaveAttribute('aria-pressed', 'true');
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    // The tab of the article goes to sleep from its menu, with its page and its reader view.
    await recordMenus(browser);
    const tab = browser.shell.getByRole('tab', { name: /Fixture article title/ });
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [mac ? 'Put Tab to Sleep' : 'Put tab to sleep']);
    await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.sleeping).toBe(true);
    await expect.poll(() => readerViews(browser)).toBe(0);
    expect(await readerStates(browser)).toEqual(['none', 'none']);
    // It wakes as it shows, and shows the reader view again once its page has loaded.
    await tab.click();
    await expect(readerButton(browser)).toHaveAttribute('aria-pressed', 'true');
    const reader = await readerPage(browser);
    await expect(reader.getByRole('heading', { level: 1 })).toHaveText('Fixture article title');
    expect(await readerStates(browser)).toEqual(['open', 'none']);
    expect(await readerViews(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('checks a page whose frames go on loading after it, once its tab shows', async () => {
  const own = new FixtureServer();
  await own.start();
  const release = own.hold('held-frame.html');
  const browser = await launch();
  try {
    const home = await open(browser, `${own.origin}/index.html`);
    await home.evaluate(() => {
      const link = document.createElement('a');
      link.id = 'cases';
      link.href = '/article-cases.html?frame';
      link.textContent = 'Fixture cases';
      document.body.prepend(link);
    });
    // The article opens in a tab behind this one, where a script adds a frame after the load,
    // which keeps loading.
    await home.locator('#cases').click({ button: 'middle' });
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(() => own.requests.some((request) => request.path === '/held-frame.html'))
      .toBe(true);
    await browser.shell.getByRole('tab', { name: 'Fixture cases of articles' }).click();
    await expect(readerButton(browser)).toBeVisible();
  } finally {
    await browser.close();
    release();
    await own.stop();
  }
});

test('loads its code only once a web page has loaded in the active tab', async () => {
  const own = new FixtureServer();
  await own.start();
  const browser = await launch();
  try {
    const release = own.hold('article.html');
    const url = `${own.origin}/article.html`;
    // Another start hands a link over, as at a start with it: the window shows its tab while
    // the page still loads.
    expect(await startAgain(browser, ['--', url])).toBe(0);
    await expect
      .poll(() => own.requests.some((request) => request.path === '/article.html'))
      .toBe(true);
    await expect
      .poll(async () => {
        const state = await shellState(browser.shell);
        return state.tabs.find((tab) => tab.id === state.activeTabId)?.url;
      })
      .toBe(url);
    await new Promise((done) => setTimeout(done, 1000));
    expect(await readerCode(browser)).toEqual([]);
    release();
    await expect(readerButton(browser)).toBeVisible();
    expect(await readerCode(browser)).toHaveLength(1);
  } finally {
    await browser.close();
    await own.stop();
  }
});

test('shows a long post whose lines line breaks separate', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/article-cases.html?lines`);
    await readerButton(browser).click();
    const reader = await readerPage(browser);
    await expect(reader.locator('body')).toContainText('Fixture line 1. The harbor master');
    await expect(reader.locator('body')).toContainText('Fixture last line of the post.');
    // The whole post shows, without the note of a long page.
    await expect(reader.locator('footer')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('shows the first part of a page with a very long list, and says so', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/article-cases.html?items`);
    await readerButton(browser).click();
    const reader = await readerPage(browser);
    await expect(reader.locator('footer')).toHaveText(
      'This is the first part of the page. Close the reader view to read the rest.',
    );
    await expect(reader.locator('li').first()).toHaveText('Fixture item 1 of the long list');
    const items = await reader.locator('li').count();
    expect(items).toBeGreaterThan(4900);
    expect(items).toBeLessThan(5000);
  } finally {
    await browser.close();
  }
});

test('loads the pictures of the article by the rules of its site', async () => {
  // The content blocker is off on the fixture site, so the picture that its lists name loads.
  const browser = await launch([], { settings: { 'contentBlocker.allowedSites': ['127.0.0.1'] } });
  try {
    const page = await open(browser, `${server.origin}/article-cases.html?picture`);
    await expect.poll(() => pictureWidth(page)).toBe(1);
    await readerButton(browser).click();
    const reader = await readerPage(browser);
    const picture = reader.getByRole('img', { name: 'Fixture blocked picture' });
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => pictureWidth(reader)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('opens again after a reload, and leaves the focus and the suggestions where they are', async () => {
  const own = new FixtureServer();
  await own.start();
  const browser = await launch();
  try {
    const url = `${own.origin}/article.html`;
    await open(browser, url);
    const button = readerButton(browser);
    await button.click();
    await readerPage(browser);
    // Reload ends the reader view; the page loads until the test lets it.
    const release = own.hold('article.html');
    await pressNative(browser, 'R', ['primary'], readerAddress);
    await expect.poll(() => readerViews(browser)).toBe(0);
    // Meanwhile, an address is typed, with its suggestions; the click gives the shell the
    // focus, as a click of the mouse does.
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await focusPage(browser, browser.shell);
    await address.click();
    await address.pressSequentially('fixture');
    const list = (await overlayPage(browser)).getByRole('listbox', { name: 'Suggestions' });
    await expect(list).toBeVisible();
    release();
    // Once the page has loaded, its reader view shows again, behind the typing.
    await expect.poll(() => readerViews(browser)).toBe(1);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await viewFocused(browser, 'app://shell')).toBe(true);
    expect(await viewFocused(browser, readerAddress)).toBe(false);
    await expect(list).toBeVisible();
    await address.pressSequentially(' harbor');
    await expect(address).toHaveValue('fixture harbor');
  } finally {
    await browser.close();
    await own.stop();
  }
});

test('opens again after a reload in a window in the background, which stays there', async () => {
  const own = new FixtureServer();
  await own.start();
  const browser = await launch();
  try {
    const url = `${own.origin}/article.html`;
    await open(browser, url);
    await readerButton(browser).click();
    await readerPage(browser);
    const release = own.hold('article.html');
    await pressNative(browser, 'R', ['primary'], readerAddress);
    await expect.poll(() => readerViews(browser)).toBe(0);
    // Another window takes the focus while the page loads.
    const first = await focusedWindow(browser);
    await pressNative(browser, 'N', ['primary']);
    await expect
      .poll(() => browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length))
      .toBe(2);
    await expect.poll(() => focusedWindow(browser)).not.toBe(first);
    const second = await focusedWindow(browser);
    release();
    await expect.poll(() => readerViews(browser)).toBe(1);
    await new Promise((done) => setTimeout(done, 500));
    expect(await focusedWindow(browser)).toBe(second);
  } finally {
    await browser.close();
    await own.stop();
  }
});

test('gives the page the focus when its button or Back end the reader view', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/article.html`;
    await open(browser, url);
    const button = readerButton(browser);
    await button.click();
    await readerPage(browser);
    // A click on the button gives the shell the focus, as a click of the mouse does; the keys
    // that people press next go to the page again, not to the button.
    await focusPage(browser, browser.shell);
    await button.click();
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect.poll(() => viewFocused(browser, url)).toBe(true);
    await button.click();
    await readerPage(browser);
    await focusPage(browser, browser.shell);
    await browser.shell.getByRole('button', { name: 'Back' }).click();
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect.poll(() => viewFocused(browser, url)).toBe(true);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await browser.close();
  }
});

test('ends with the back button of a mouse over the article', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/article.html`;
    const page = await open(browser, url);
    const loaded = await page.evaluate(() => performance.timeOrigin);
    await readerButton(browser).click();
    const reader = await readerPage(browser);
    await clickBackOver(reader);
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect(readerButton(browser)).toHaveAttribute('aria-pressed', 'false');
    // The page is the one that was there, and the tab stays on it.
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(loaded);
    expect((await shellState(browser.shell)).tabs.map((tab) => tab.url)).toEqual([url]);
  } finally {
    await browser.close();
  }
});

test('ends every reader view when its setting turns off', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/article.html`);
    await readerButton(browser).click();
    await readerPage(browser);
    await pressNative(browser, 'T', ['primary'], readerAddress);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await expect(address).toBeFocused();
    await address.fill('app://settings/#reader.enabled');
    await address.press('Enter');
    const settings = await waitForPage(browser, (current) => current.startsWith('app://settings'));
    await settings.getByRole('switch', { name: /Offer the reader view/ }).uncheck();
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect.poll(() => readerStates(browser)).toEqual(['none', 'none']);
    await browser.shell.getByRole('tab').first().click();
    await expect(readerButton(browser)).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('ends when the page shows another path with the History API, not for an anchor', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/article.html`);
    const button = readerButton(browser);
    await button.click();
    await readerPage(browser);
    await page.evaluate(() => history.pushState({}, '', '/article-moved.html'));
    await expect.poll(() => readerViews(browser)).toBe(0);
    await expect(
      browser.shell.getByRole('textbox', { name: 'Address and search bar' }),
    ).toHaveValue(`${server.origin}/article-moved.html`);
    // After a quiet second, the page is checked again, and still has its article.
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await readerPage(browser);
    await page.evaluate(() => {
      location.hash = 'comments';
    });
    await new Promise((done) => setTimeout(done, 1500));
    expect(await readerViews(browser)).toBe(1);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await browser.close();
  }
});
