import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseMenuItem,
  FixtureServer,
  launch,
  menuCount,
  pressNative,
  recordedMenu,
  recordMenus,
  shellState,
  tabViews,
  waitForPage,
  type Browser,
} from './harness.ts';

const mac = process.platform === 'darwin';
/** The item of the tab menu, as it shows without the mark of its access key. */
const sleepItem = mac ? 'Put Tab to Sleep' : 'Put tab to sleep';
/**
 * macOS 15 and later (Darwin 24) let people choose what to share in a picker of their own,
 * which a test cannot answer.
 */
const systemPicker = mac && Number.parseInt(release(), 10) >= 24;

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** The addresses of every web page that the browser has loaded now. */
function webPages(browser: Browser): Promise<string[]> {
  return browser.main.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .map((contents) => contents.getURL())
      .filter((url) => /^https?:/.test(url)),
  );
}

/** Loads an address in the active tab and gives its page. */
async function visit(browser: Browser, url: string): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
  return waitForPage(browser, (current) => current === url);
}

/** Opens a new tab, which becomes the active one, once the shell shows it. */
async function newTab(browser: Browser): Promise<void> {
  const tabs = browser.shell.getByRole('tab');
  const count = await tabs.count();
  await browser.shell.getByRole('button', { name: 'New tab' }).click();
  await expect(tabs).toHaveCount(count + 1);
  await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
    'title',
    'New tab',
  );
}

/** Whether the menu of a tab offers to put it to sleep, from a menu that the test opens. */
async function offersSleep(browser: Browser, tab: Locator): Promise<boolean> {
  const count = await menuCount(browser);
  await tab.click({ button: 'right' });
  const menu = await recordedMenu(browser, count + 1);
  const label = menu.items.find((item) => item.replaceAll('&', '') === sleepItem);
  expect(label).toBeDefined();
  return !menu.disabled.includes(label ?? '');
}

/**
 * Types text into the focused field of a page as native key presses, as a person does: the
 * browser sees them before the page, which Playwright's keyboard skips.
 */
async function typeNative(browser: Browser, url: string, text: string): Promise<void> {
  await browser.main.evaluate(
    ({ webContents }, { address, keys }) => {
      const contents = webContents.getAllWebContents().find((view) => view.getURL() === address);
      if (contents === undefined) throw new Error(`No page at ${address}`);
      for (const key of keys) {
        contents.sendInputEvent({ type: 'keyDown', keyCode: key });
        contents.sendInputEvent({ type: 'char', keyCode: key });
        contents.sendInputEvent({ type: 'keyUp', keyCode: key });
      }
    },
    { address: url, keys: text.split('') },
  );
}

/** A slow download, a part every half second without an end, and the folder it goes to. */
async function slowDownload(): Promise<{ url: string; folder: string; stop: () => Promise<void> }> {
  const slow: Server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="slow.bin"',
    });
    const timer = setInterval(() => response.write(Buffer.alloc(64 * 1024, 7)), 500);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((done) => slow.listen(0, '127.0.0.1', done));
  const folder = mkdtempSync(join(tmpdir(), 'sleeping-downloads-'));
  return {
    url: `http://127.0.0.1:${(slow.address() as AddressInfo).port}/slow.bin`,
    folder,
    stop: async () => {
      slow.closeAllConnections();
      await new Promise((done) => slow.close(done));
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** Starts a download from a page with a link, as a click of a person does. */
async function startDownload(page: Page, url: string): Promise<void> {
  await page.evaluate((address) => {
    const link = document.createElement('a');
    link.href = address;
    link.textContent = 'Slow download';
    document.body.append(link);
    link.click();
  }, url);
}

/** Whether the window is in full screen; on macOS, it covers the screen without a space. */
function windowFullScreen(browser: Browser): Promise<boolean | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0];
    return process.platform === 'darwin' ? window?.isSimpleFullScreen() : window?.isFullScreen();
  });
}

/** Waits until a video of a page plays. */
async function playing(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const video = document.querySelector('video');
        return video !== null && !video.paused && video.currentTime > 0;
      }),
    )
    .toBe(true);
}

/** Lets a page use the camera, which the settings allow for its site. */
async function useCamera(page: Page): Promise<void> {
  expect(
    await page.evaluate(() =>
      navigator.mediaDevices.getUserMedia({ video: true }).then(
        (stream) => `tracks: ${stream.getVideoTracks().length}`,
        (error: unknown) => (error instanceof Error ? error.name : String(error)),
      ),
    ),
  ).toBe('tracks: 1');
}

test('puts a tab to sleep from its menu, frees its page and wakes it with its title, icon and history', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    await visit(browser, `${server.origin}/index.html`);
    await expect(shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
    await visit(browser, `${server.origin}/icon.html`);
    const tab = shell.getByRole('tab', { name: 'Page with an icon' });
    await expect(tab.locator('.favicon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const before = (await shellState(shell)).tabs[0];
    expect(before?.favicon).toMatch(/^[0-9a-f]{16}$/);
    await newTab(browser);
    await recordMenus(browser);
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [sleepItem]);
    // The page is gone; the tab keeps its title, its icon and its history.
    await expect.poll(() => webPages(browser)).toEqual([]);
    expect((await shellState(shell)).tabs[0]).toMatchObject({
      sleeping: true,
      loading: false,
      title: 'Page with an icon',
      favicon: before?.favicon,
      canGoBack: true,
    });
    await expect(tab).toHaveAttribute('data-sleeping', '');
    await expect(tab).toHaveAttribute('aria-description', 'Sleeping, loads again when you open it');
    await expect(tab).toHaveAttribute('title', 'Page with an icon');
    await expect(tab.locator('.favicon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    // The window still gives the icon when it is asked anew, as tab search does, although no
    // web page of it is left.
    expect(
      await shell.evaluate(
        (key) => window.bridge.invoke('tabs.favicon', { key }),
        before?.favicon ?? '',
      ),
    ).toMatch(/^data:image\/png;base64,/);
    await expect
      .poll(() => tab.locator('.favicon').evaluate((icon) => getComputedStyle(icon).opacity))
      .toBe('0.7');
    // The tab wakes when it is shown, with its page and its history.
    await tab.click();
    await expect.poll(() => webPages(browser)).toEqual([`${server.origin}/icon.html`]);
    await expect
      .poll(async () => (await shellState(shell)).tabs[0])
      .toMatchObject({
        sleeping: false,
        loading: false,
        canGoBack: true,
        favicon: before?.favicon,
      });
    await expect(tab).not.toHaveAttribute('data-sleeping');
    await expect(tab).not.toHaveAttribute('aria-description');
    await expect(tab.locator('.favicon')).toHaveCSS('opacity', '1');
    await shell.getByRole('button', { name: 'Back' }).click();
    await expect(shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
    await expect.poll(() => webPages(browser)).toEqual([`${server.origin}/index.html`]);
  } finally {
    await browser.close();
  }
});

test('offers no sleep for the active tab, a sleeping tab, or a tab that plays sound or a video or uses the camera', async () => {
  const browser = await launch(['--use-fake-device-for-media-stream'], {
    settings: { 'permissions.sites': { [server.origin]: { camera: 'allow' } } },
  });
  try {
    const shell = browser.shell;
    await visit(browser, `${server.origin}/sound.html`);
    const sound = shell.getByRole('tab', { name: 'Sound' });
    await expect(sound.getByRole('button', { name: 'Mute tab' })).toBeVisible();
    await newTab(browser);
    await useCamera(await visit(browser, `${server.origin}/permissions.html`));
    await newTab(browser);
    await playing(await visit(browser, `${server.origin}/playing.html`));
    await newTab(browser);
    await visit(browser, `${server.origin}/index.html`);
    await newTab(browser);
    await recordMenus(browser);
    const tabs = shell.getByRole('tab');
    // The active tab shows; the other pages are busy, but the plain page.
    expect(await offersSleep(browser, tabs.nth(4))).toBe(false);
    expect(await offersSleep(browser, sound)).toBe(false);
    expect(
      await offersSleep(browser, shell.getByRole('tab', { name: 'Fixture permissions' })),
    ).toBe(false);
    expect(await offersSleep(browser, shell.getByRole('tab', { name: 'Video' }))).toBe(false);
    const plain = shell.getByRole('tab', { name: 'Fixture home' });
    expect(await offersSleep(browser, plain)).toBe(true);
    await chooseMenuItem(browser, [sleepItem]);
    await expect(plain).toHaveAttribute('data-sleeping', '');
    // A tab that sleeps already cannot go to sleep again.
    expect(await offersSleep(browser, plain)).toBe(false);
    expect((await shellState(shell)).tabs.map((tab) => tab.sleeping)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(await webPages(browser)).not.toContain(`${server.origin}/index.html`);
  } finally {
    await browser.close();
  }
});

test('offers no sleep for a tab with its developer tools open, a page linked to the page that it opened, or a tab that shares the screen', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const at = (name: string): string => `${server.origin}/${name}`;
    // A page that opened another, as a sign-in window is, keeps the link while both are open.
    const opener = await visit(browser, at('opener.html'));
    await opener.getByRole('button', { name: 'Open a tab' }).click();
    await expect(shell.getByRole('tab', { name: 'Fixture opened' })).toBeVisible();
    await newTab(browser);
    await visit(browser, at('second.html'));
    const devTools = (open: boolean | undefined): Promise<boolean | undefined> =>
      browser.main.evaluate(
        ({ webContents }, { url, change }) => {
          const page = webContents.getAllWebContents().find((view) => view.getURL() === url);
          if (change === true) page?.openDevTools({ mode: 'detach' });
          if (change === false) page?.closeDevTools();
          return page?.isDevToolsOpened();
        },
        { url: at('second.html'), change: open },
      );
    await devTools(true);
    await expect.poll(() => devTools(undefined)).toBe(true);
    if (!systemPicker) {
      await newTab(browser);
      const sharing = await visit(browser, at('permissions.html'));
      await sharing.getByRole('button', { name: 'Share the screen' }).click();
      const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
      const picker = overlay.getByRole('dialog', {
        name: `Choose what ${new URL(server.origin).host} may see`,
      });
      await picker.getByRole('button', { pressed: false }).first().click();
      await picker.getByRole('button', { name: 'Share', exact: true }).click();
      await expect(sharing.locator('#result')).toHaveText('video tracks: 1');
    }
    await newTab(browser);
    await visit(browser, at('index.html'));
    await newTab(browser);
    await recordMenus(browser);
    const tab = (name: string): Locator => shell.getByRole('tab', { name });
    expect(await offersSleep(browser, tab('Fixture opener'))).toBe(false);
    expect(await offersSleep(browser, tab('Fixture opened'))).toBe(false);
    expect(await offersSleep(browser, tab('Fixture second'))).toBe(false);
    if (!systemPicker) {
      expect(await offersSleep(browser, tab('Fixture permissions'))).toBe(false);
    }
    expect(await offersSleep(browser, tab('Fixture home'))).toBe(true);
    // Each reason ends: the developer tools close, and so does the page that the other opened.
    await devTools(false);
    await expect.poll(() => devTools(undefined)).toBe(false);
    expect(await offersSleep(browser, tab('Fixture second'))).toBe(true);
    await browser.main.evaluate(({ webContents }, url) => {
      webContents
        .getAllWebContents()
        .find((view) => view.getURL() === url)
        ?.close();
    }, at('opened.html'));
    await expect(tab('Fixture opened')).toHaveCount(0);
    expect(await offersSleep(browser, tab('Fixture opener'))).toBe(true);
  } finally {
    await browser.close();
  }
});

test('lets a tab sleep whose download is paused, and keeps it awake while the download runs', async () => {
  const download = await slowDownload();
  const browser = await launch([], { settings: { 'downloads.folder': download.folder } });
  try {
    const shell = browser.shell;
    await startDownload(await visit(browser, `${server.origin}/index.html`), download.url);
    await expect.poll(async () => (await shellState(shell)).downloads?.active).toBe(1);
    await newTab(browser);
    await recordMenus(browser);
    const tab = shell.getByRole('tab', { name: 'Fixture home' });
    expect(await offersSleep(browser, tab)).toBe(false);
    // The list of downloads pauses the download and lets it go on.
    const list = async (): Promise<Locator> => {
      await pressNative(browser, mac ? 'L' : 'J', mac ? ['primary', 'alt'] : ['primary']);
      const overlay = await waitForPage(browser, (url) => url.startsWith('app://overlay'));
      const dialog = overlay.getByRole('dialog', { name: 'Downloads' });
      await expect(dialog).toBeVisible();
      return dialog;
    };
    let downloads = await list();
    const item = downloads.getByRole('listitem').first();
    await item.getByRole('button', { name: 'Pause: slow.bin' }).click();
    await expect(item).toContainText('Paused');
    await downloads.press('Escape');
    await expect(downloads).toBeHidden();
    expect(await offersSleep(browser, tab)).toBe(true);
    downloads = await list();
    await downloads.getByRole('button', { name: 'Resume: slow.bin' }).click();
    await expect(downloads.getByRole('listitem').first()).not.toContainText('Paused');
    await downloads.press('Escape');
    await expect(downloads).toBeHidden();
    expect(await offersSleep(browser, tab)).toBe(false);
  } finally {
    await browser.close();
    await download.stop();
  }
});

test('ends the full screen of a page whose tab goes to sleep in the background, and wakes it below the shell', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const second = `${server.origin}/second.html`;
    const find = `${server.origin}/find.html`;
    await visit(browser, second);
    await newTab(browser);
    const page = await visit(browser, find);
    // The top of the view of a tab's page, found by its address, while the window shows it.
    const topOf = async (url: string): Promise<number | undefined> =>
      (await tabViews(browser)).find((view) => view.url === url)?.bounds.y;
    const top = await topOf(find);
    expect(top).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => topOf(find)).toBe(0);
    await expect.poll(() => windowFullScreen(browser)).toBe(true);
    // The other tab shows below the shell; the window stays in full screen for the page.
    await pressNative(browser, 'Tab', ['control']);
    await expect.poll(() => topOf(second)).toBe(top);
    expect(await windowFullScreen(browser)).toBe(true);
    await recordMenus(browser);
    const tab = shell.getByRole('tab', { name: 'Fixture find' });
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [sleepItem]);
    await expect(tab).toHaveAttribute('data-sleeping', '');
    // The page that showed something in full screen is gone, and so is the full screen.
    await expect.poll(() => windowFullScreen(browser)).toBe(false);
    await tab.click();
    await expect.poll(() => topOf(find)).toBe(top);
    await expect(shell.getByRole('textbox', { name: 'Address and search bar' })).toBeVisible();
    expect(await windowFullScreen(browser)).toBe(false);
  } finally {
    await browser.close();
  }
});

test('puts tabs to sleep after the time of the settings while they let it, except those that are pinned, busy or typed into, and never asks a page', async () => {
  test.setTimeout(180_000);
  const download = await slowDownload();
  // 30 seconds is a time that only a policy or the settings file sets. Tabs do not sleep by
  // themselves at first.
  const browser = await launch(['--use-fake-device-for-media-stream'], {
    settings: {
      'tabs.sleep': false,
      'tabs.sleepAfter': 30,
      'permissions.sites': { [server.origin]: { camera: 'allow' } },
      'downloads.folder': download.folder,
    },
  });
  try {
    const shell = browser.shell;
    const at = (name: string): string => `${server.origin}/${name}`;
    // Each page gets a tab of its own, one after the other.
    await visit(browser, at('index.html?first'));
    await newTab(browser);
    // The pinned page hears what the page that asks to stay tells when it is asked.
    const pinned = await visit(browser, at('second.html?pinned'));
    await pinned.evaluate(() => {
      const heard: unknown[] = [];
      const channel = new BroadcastChannel('asked');
      channel.addEventListener('message', (event) => heard.push(event.data));
      Object.assign(window, { heard, channel });
    });
    await recordMenus(browser);
    await shell.getByRole('tab', { name: 'Fixture second' }).click({ button: 'right' });
    await chooseMenuItem(browser, ['Pin']);
    await newTab(browser);
    await visit(browser, at('sound.html'));
    await expect(
      shell.getByRole('tab', { name: 'Sound' }).getByRole('button', { name: 'Mute tab' }),
    ).toBeVisible();
    await newTab(browser);
    await playing(await visit(browser, at('playing.html')));
    await newTab(browser);
    await useCamera(await visit(browser, at('permissions.html')));
    await newTab(browser);
    await startDownload(await visit(browser, at('index.html?download')), download.url);
    await expect.poll(async () => (await shellState(shell)).downloads?.active).toBe(1);
    await newTab(browser);
    // Someone types into a field of this page, which asks to stay from then on.
    const stay = await visit(browser, at('stay.html'));
    const note = stay.getByRole('textbox', { name: 'Note' });
    await note.click();
    await typeNative(browser, at('stay.html'), 'draft');
    await expect(note).toHaveValue('draft');
    await newTab(browser);
    // Nobody types into this page; it asks to stay all the same.
    await visit(browser, at('asks.html'));
    await newTab(browser);
    const sleeping = async (): Promise<Record<string, boolean>> =>
      Object.fromEntries(
        (await shellState(shell)).tabs.map((tab) => [
          tab.url.replace(server.origin, ''),
          tab.sleeping,
        ]),
      );
    // While the setting is off, no tab sleeps, however long it was not used.
    await new Promise((done) => setTimeout(done, 35_000));
    expect(Object.values(await sleeping())).not.toContain(true);
    // The page left last is due 30 seconds after the setting is turned on.
    await visit(browser, at('index.html?last'));
    await newTab(browser);
    await visit(browser, 'app://settings/#tabs.sleep');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const on = settings.getByRole('switch', { name: /Put inactive tabs to sleep/ });
    await expect(on).not.toBeChecked();
    await on.check();
    // The tabs that were not used for longer sleep at once.
    await expect
      .poll(async () => (await sleeping())['/index.html?first'], { timeout: 10_000 })
      .toBe(true);
    expect((await sleeping())['/index.html?last']).toBe(false);
    await expect
      .poll(async () => (await sleeping())['/index.html?last'], {
        timeout: 60_000,
        intervals: [1000],
      })
      .toBe(true);
    expect(await sleeping()).toEqual({
      '/second.html?pinned': false,
      '/index.html?first': true,
      '/sound.html': false,
      '/playing.html': false,
      '/permissions.html': false,
      '/index.html?download': false,
      '/stay.html': false,
      '/asks.html': true,
      '/index.html?last': true,
      'app://settings/#tabs.sleep': false,
    });
    // The pages of the tabs that stay awake are still there.
    const pages = await webPages(browser);
    for (const name of [
      'second.html?pinned',
      'sound.html',
      'playing.html',
      'permissions.html',
      'index.html?download',
      'stay.html',
    ]) {
      expect(pages).toContain(at(name));
    }
    for (const name of ['index.html?first', 'asks.html', 'index.html?last']) {
      expect(pages).not.toContain(at(name));
    }
    // The browser never asked the page that asks to stay, so it got no gesture of a person.
    expect(await pinned.evaluate(() => Reflect.get(window, 'heard') as unknown)).toEqual([]);
    // A page that was typed into may still be put to sleep from its menu.
    const typed = shell.getByRole('tab', { name: 'Unsaved note' });
    expect(await offersSleep(browser, typed)).toBe(true);
    await chooseMenuItem(browser, [sleepItem]);
    await expect(typed).toHaveAttribute('data-sleeping', '');
  } finally {
    await browser.close();
    await download.stop();
  }
});
