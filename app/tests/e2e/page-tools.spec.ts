import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const page = await waitForPage(browser, (current) => current === url);
  // The page gets the focus once it shows; keys reach only the view that has the focus.
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

/** Presses a key in the page, where the browser sees it before the page does. */
async function pressInPage(
  browser: Browser,
  key: string,
  modifiers: Parameters<typeof pressNative>[2] = [],
): Promise<void> {
  await pressNative(browser, key, modifiers, server.origin);
}

/** What the tests do with the web contents of a page in the browser process. */
type ContentsTask =
  | 'zoomIn'
  | 'mockPrint'
  | 'pageText'
  | 'devToolsOpened'
  | 'pdfViewer'
  | 'loading'
  | 'failSave'
  | 'recordFind';

/**
 * Works with the web contents of the page at a URL in the browser process.
 * @returns What the task finds out; nothing while no page has the URL.
 */
function withContents(browser: Browser, url: string, task: ContentsTask): Promise<unknown> {
  return browser.main.evaluate(
    ({ webContents }, { address, wanted }) => {
      const contents = webContents.getAllWebContents().find((c) => c.getURL() === address);
      if (contents === undefined) return undefined;
      if (wanted === 'zoomIn') {
        // As Ctrl and the mouse wheel do.
        contents.emit('zoom-changed', {}, 'in');
      } else if (wanted === 'mockPrint') {
        // Printing opens the system's dialog; the test only sees that the page asked for it.
        Reflect.set(globalThis, 'printed', 0);
        contents.print = () => {
          Reflect.set(globalThis, 'printed', Number(Reflect.get(globalThis, 'printed')) + 1);
        };
      } else if (wanted === 'pageText') {
        return contents.executeJavaScript('document.body.innerText');
      } else if (wanted === 'devToolsOpened') {
        return contents.isDevToolsOpened();
      } else if (wanted === 'loading') {
        return contents.isLoading();
      } else if (wanted === 'failSave') {
        // As when the page changes while it is saved, such as when it loads again.
        contents.savePage = () => Promise.reject(new Error('Failed to save the page.'));
      } else if (wanted === 'recordFind') {
        // What the browser asks of Chromium's search in the page.
        const finds: unknown[] = [];
        Reflect.set(globalThis, 'finds', finds);
        const find = contents.findInPage.bind(contents);
        contents.findInPage = (text, options) => {
          finds.push({ text, ...options });
          return find(text, options);
        };
      } else {
        // Chromium's PDF viewer is an extension frame inside the tab's page.
        return contents.mainFrame.framesInSubtree.some((frame) =>
          frame.url.startsWith('chrome-extension://'),
        );
      }
      return undefined;
    },
    { address: url, wanted: task },
  );
}

test('finds text in the page and steps through the matches', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/find.html`;
    await open(browser, url);
    await pressInPage(browser, 'F', ['primary']);
    const find = browser.shell.getByRole('search', { name: 'Find in page' });
    const field = find.getByRole('searchbox', { name: 'Find in page' });
    await expect(field).toBeFocused();
    // Enter right after the typing goes to the next match of what was typed.
    await field.fill('apple');
    await field.press('Enter');
    await expect(find).toContainText('2 of 3');
    await field.press('Shift+Enter');
    await expect(find).toContainText('1 of 3');
    await find.getByRole('button', { name: 'Next match' }).click();
    await expect(find).toContainText('2 of 3');
    // The keys for the next match work while the page has the focus, too.
    await pressInPage(browser, mac ? 'G' : 'F3', mac ? ['primary'] : []);
    await expect(find).toContainText('3 of 3');
    await field.fill('kiwi');
    await expect(find).toContainText('No matches');
    await field.fill('pie');
    await expect(find).toContainText('1 of 1');
    await field.press('Escape');
    await expect(find).toBeHidden();
    expect((await shellState(browser.shell)).find).toBe(null);
    // The bar opens again with the text of the last search and looks for it again.
    await pressInPage(browser, 'F', ['primary']);
    await expect(field).toHaveValue('pie');
    await expect(find).toContainText('1 of 1');
  } finally {
    await browser.close();
  }
});

test('starts a new search for new text and goes on with it for the next match', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/find.html`;
    await open(browser, url);
    await withContents(browser, url, 'recordFind');
    await pressInPage(browser, 'F', ['primary']);
    const find = browser.shell.getByRole('search', { name: 'Find in page' });
    const field = find.getByRole('searchbox', { name: 'Find in page' });
    await expect(field).toBeFocused();
    await field.fill('apple');
    await expect(find).toContainText('1 of 3');
    await field.press('Enter');
    await expect(find).toContainText('2 of 3');
    // Electron's findNext begins a new search; a step that began one would start from the top
    // again when the search of the text was not done yet.
    expect(await browser.main.evaluate(() => Reflect.get(globalThis, 'finds'))).toEqual([
      { text: 'apple', forward: true, findNext: true },
      { text: 'apple', forward: true, findNext: false },
    ]);
  } finally {
    await browser.close();
  }
});

test('shows the zoom of a site in every tab of the site', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/find.html`);
    await pressNative(browser, 'T', ['primary']);
    await open(browser, `${server.origin}/second.html`);
    // The first tab zooms its site, which the second tab shows too.
    await withContents(browser, `${server.origin}/find.html`, 'zoomIn');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.zoom))
      .toEqual([1.1, 1.1]);
    await expect(browser.shell.getByRole('button', { name: /^Zoom 110\s?%/ })).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('zooms a site in and out, shows its zoom and keeps it for the next start', async () => {
  const browser = await launch();
  const { profile } = browser;
  const url = `${server.origin}/find.html`;
  try {
    try {
      const page = await open(browser, url);
      await pressInPage(browser, '=', ['primary']);
      const zoom = browser.shell.getByRole('button', { name: /^Zoom 110\s?%/ });
      await expect(zoom).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(1.1, 2);
      await pressInPage(browser, '-', ['primary']);
      await pressInPage(browser, '-', ['primary']);
      await expect(browser.shell.getByRole('button', { name: /^Zoom 90\s?%/ })).toBeVisible();
      // Ctrl and the mouse wheel zoom in steps, too.
      await withContents(browser, url, 'zoomIn');
      await expect(browser.shell.getByRole('button', { name: /^Zoom/ })).toBeHidden();
      await withContents(browser, url, 'zoomIn');
      await expect(zoom).toBeVisible();
    } finally {
      await browser.close({ keepProfile: true });
    }
    const again = await launch([], { profile });
    try {
      const reopened = await open(again, url);
      // The restored tab may still load the page when the address opens it once more.
      const ratio = (): Promise<number> =>
        reopened.evaluate(() => window.devicePixelRatio).catch(() => Number.NaN);
      const zoom = again.shell.getByRole('button', { name: /^Zoom 110\s?%/ });
      await expect(zoom).toBeVisible();
      await expect.poll(ratio).toBeCloseTo(1.1, 2);
      await zoom.click();
      await expect(again.shell.getByRole('button', { name: /^Zoom/ })).toBeHidden();
      await expect.poll(ratio).toBe(1);
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('gives the shell back when another tab shows or the tab in full screen closes', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/second.html`);
    await pressNative(browser, 'T', ['primary']);
    const page = await open(browser, `${server.origin}/find.html`);
    const visibleTop = (): Promise<number | undefined> =>
      browser.main.evaluate(
        ({ BaseWindow }) =>
          BaseWindow.getAllWindows()[0]?.contentView.children.at(-1)?.getBounds().y,
      );
    const top = await visibleTop();
    expect(top).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(visibleTop).toBe(0);
    // The other tab is not in full screen, so the shell shows above it.
    await pressNative(browser, 'Tab', ['control']);
    await expect.poll(visibleTop).toBe(top);
    await pressNative(browser, 'Tab', ['control']);
    await expect.poll(visibleTop).toBe(0);
    // Closing the tab in full screen ends it.
    await pressNative(browser, 'W', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    await expect.poll(visibleTop).toBe(top);
    expect(
      await browser.main.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.isFullScreen(),
      ),
    ).toBe(false);
  } finally {
    await browser.close();
  }
});

test('lets a page show an element in full screen, over the whole window', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/find.html`;
    const page = await open(browser, url);
    const pageBounds = (): Promise<{ y: number; height: number } | undefined> =>
      browser.main.evaluate(({ BaseWindow }) => {
        const view = BaseWindow.getAllWindows()[0]?.contentView.children.at(-1);
        return view === undefined ? undefined : view.getBounds();
      });
    const before = await pageBounds();
    expect(before?.y).toBeGreaterThan(0);
    // On macOS, the window covers the screen without a space of its own.
    const windowFullScreen = (): Promise<boolean | undefined> =>
      browser.main.evaluate(({ BaseWindow }) => {
        const window = BaseWindow.getAllWindows()[0];
        return process.platform === 'darwin'
          ? window?.isSimpleFullScreen()
          : window?.isFullScreen();
      });
    // The window learns of the change before the page does, and the other way round; the
    // window takes the whole screen while the page shows an element in full screen.
    const enter = async (): Promise<void> => {
      await page.getByRole('button', { name: 'Full screen' }).click();
      await expect.poll(async () => (await pageBounds())?.y).toBe(0);
      await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('player');
      await expect.poll(windowFullScreen).toBe(true);
    };
    const left = async (): Promise<void> => {
      await expect.poll(async () => (await pageBounds())?.y).toBe(before?.y);
      await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
      await expect.poll(windowFullScreen).toBe(false);
    };
    await enter();
    // Escape ends it, as the page's own controls do.
    await pressInPage(browser, 'Escape');
    await left();
    await enter();
    await page.evaluate(() => document.exitFullscreen());
    await left();
  } finally {
    await browser.close();
  }
});

test('reloads without the cache, prints, saves and shows the source of a page', async () => {
  const browser = await launch();
  const folder = mkdtempSync(join(tmpdir(), 'saved-page-'));
  try {
    const url = `${server.origin}/find.html`;
    await open(browser, url);
    const reloads = (): number =>
      server.requests.filter(
        (request) =>
          request.path === '/find.html' && request.headers['cache-control'] === 'no-cache',
      ).length;
    await pressInPage(browser, 'R', ['primary', 'shift']);
    await expect.poll(reloads).toBe(1);
    // A page that loads again while it is saved is not saved, so the test lets the reload finish
    // first, as it does while a person chooses where to save the page.
    await expect.poll(() => withContents(browser, url, 'loading')).toBe(false);
    await withContents(browser, url, 'mockPrint');
    await pressInPage(browser, 'P', ['primary']);
    await expect
      .poll(() => browser.main.evaluate(() => Reflect.get(globalThis, 'printed')))
      .toBe(1);
    const target = join(folder, 'page.html');
    await browser.main.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    }, target);
    await pressInPage(browser, 'S', ['primary']);
    await expect.poll(() => existsSync(target)).toBe(true);
    await expect.poll(() => readFileSync(target, 'utf8')).toContain('Banana and apple.');
    await pressInPage(browser, 'U', mac ? ['primary', 'alt'] : ['primary']);
    // The source opens in a tab of its own; the page tools of the browser see its address.
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([url, `view-source:${url}`]);
    await expect
      .poll(() => withContents(browser, `view-source:${url}`, 'pageText'))
      .toContain('<title>Fixture find</title>');
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('writes to the log that a page was not saved, instead of failing unnoticed', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/find.html`;
    await open(browser, url);
    await browser.main.evaluate(
      ({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
        // Promises that fail without a handler, which the browser would only print.
        const unhandled: string[] = [];
        Reflect.set(globalThis, 'unhandled', unhandled);
        process.on('unhandledRejection', (reason) => unhandled.push(String(reason)));
      },
      join(tmpdir(), 'not-saved.html'),
    );
    await withContents(browser, url, 'failSave');
    await pressInPage(browser, 'S', ['primary']);
    const log = join(browser.profile, 'data', 'logs', 'main.log');
    await expect
      .poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : ''))
      .toContain('The page was not saved');
    expect(await browser.main.evaluate(() => Reflect.get(globalThis, 'unhandled'))).toEqual([]);
  } finally {
    await browser.close();
  }
});

test('opens and closes the developer tools of a page', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/find.html`;
    await open(browser, url);
    const opened = (): Promise<unknown> => withContents(browser, url, 'devToolsOpened');
    // F12 elsewhere, Command+Option+I on macOS.
    const toggle = (): Promise<void> =>
      mac ? pressInPage(browser, 'I', ['primary', 'alt']) : pressInPage(browser, 'F12');
    await toggle();
    await expect.poll(opened).toBe(true);
    await toggle();
    await expect.poll(opened).toBe(false);
  } finally {
    await browser.close();
  }
});

test('shows PDF documents in the tab', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/fixture.pdf`;
    await open(browser, url);
    await expect.poll(() => withContents(browser, url, 'pdfViewer')).toBe(true);
  } finally {
    await browser.close();
  }
});

test('gives later pages of an open tab the default zoom that the settings have now', async () => {
  const port = new URL(server.origin).port;
  // Names under .test reach the test's server; zoomed.test was zoomed in an earlier session.
  const browser = await launch(
    ['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server'],
    {
      settings: { 'zoom.sites': { 'zoomed.test': 1.5 } },
    },
  );
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const go = async (url: string): Promise<void> => {
      await address.fill(url);
      await address.press('Enter');
      await waitForPage(browser, (shown) => shown === url);
    };
    const factor = (url: string): Promise<unknown> =>
      browser.main.evaluate(
        ({ webContents }, wanted) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL() === wanted)
            ?.getZoomFactor(),
        url,
      );
    await go(`${server.origin}/find.html`);
    await expect.poll(() => factor(`${server.origin}/find.html`)).toBeCloseTo(1);
    // The default zoom changes in another tab while this one stays open.
    await browser.shell.getByRole('button', { name: 'New tab', exact: true }).click();
    await go('app://settings/#zoom.default');
    const settings = await waitForPage(browser, (shown) => shown.startsWith('app://settings'));
    await settings.getByRole('combobox', { name: 'Page zoom' }).selectOption('1.25');
    await browser.shell.getByRole('tab').first().click();
    const fresh = `http://fresh.test:${port}/find.html`;
    await go(fresh);
    await expect.poll(() => factor(fresh)).toBeCloseTo(1.25);
    const zoomed = `http://zoomed.test:${port}/find.html`;
    await go(zoomed);
    await expect.poll(() => factor(zoomed)).toBeCloseTo(1.5);
  } finally {
    await browser.close();
  }
});

test('gives sites without a zoom of their own the default zoom of the settings', async () => {
  const browser = await launch([], { settings: { 'zoom.default': 1.25 } });
  try {
    const url = `${server.origin}/find.html`;
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(url);
    await address.press('Enter');
    await waitForPage(browser, (shown) => shown === url);
    const factor = (): Promise<unknown> =>
      browser.main.evaluate(
        ({ webContents }, wanted) =>
          webContents
            .getAllWebContents()
            .find((c) => c.getURL() === wanted)
            ?.getZoomFactor(),
        url,
      );
    await expect.poll(factor).toBeCloseTo(1.25);
    const badge = browser.shell.getByRole('button', { name: /^Zoom / });
    await expect(badge).toHaveCount(0);
    await withContents(browser, url, 'zoomIn');
    await expect(
      browser.shell.getByRole('button', { name: /^Zoom 150\s?%, choose for 125\s?%/ }),
    ).toBeVisible();
    await badge.click();
    await expect.poll(factor).toBeCloseTo(1.25);
    await expect(badge).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
