import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import {
  chooseMenuItem,
  FixtureServer,
  launch,
  menuCount,
  menuEntries,
  openBrowserMenu,
  overlayPage,
  pressNative,
  recordedMenu,
  recordMenus,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';
/** The item of the context menu of a video, as the browser gives it to Electron. */
const contextItem = mac ? 'Picture in Picture' : '&Picture in picture';
const contextExit = mac ? 'Exit Picture in Picture' : 'E&xit picture in picture';
/** The item of the menu of a tab that puts it to sleep. */
const sleepItem = mac ? 'Put Tab to Sleep' : 'Put tab to sleep';

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/**
 * Opens an address in the active tab, and returns its page.
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

/** The button of picture in picture next to the address bar. */
function pipButton(browser: Browser, name = 'Picture in picture'): Locator {
  return browser.shell.getByRole('button', { name, exact: true });
}

/** The id of the video that a document shows in picture in picture, or `null`. */
function shownVideo(target: Page | Frame): Promise<string | null> {
  return target.evaluate(() => document.pictureInPictureElement?.id ?? null);
}

/** Waits until a video of a document plays, and has played a while. */
async function playing(target: Page | Frame, id: string): Promise<void> {
  await expect
    .poll(() =>
      target.evaluate((which) => {
        const video = document.querySelector<HTMLVideoElement>(`#${which}`);
        return video !== null && !video.paused && video.currentTime > 0;
      }, id),
    )
    .toBe(true);
}

/** Waits until a video of a document has its picture, so that it can show in picture in picture. */
async function ready(target: Page | Frame, id: string): Promise<void> {
  await expect
    .poll(() =>
      target.evaluate(
        (which) => (document.querySelector<HTMLVideoElement>(`#${which}`)?.videoWidth ?? 0) > 0,
        id,
      ),
    )
    .toBe(true);
}

/** What picture in picture of each tab is: none, available or open. */
async function states(browser: Browser): Promise<string[]> {
  return (await shellState(browser.shell)).tabs.map((tab) => tab.pictureInPicture);
}

/** The frame of a page at an address, once it is there. */
async function frameOf(page: Page, url: string): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url() === url)).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url() === url);
  if (frame === undefined) throw new Error(`No frame at ${url}`);
  return frame;
}

/**
 * Pauses the video of a page, and shows it in picture in picture as the page's own button would,
 * without the browser, when asked; waits until the browser process learned that the video
 * paused.
 */
async function pauseVideo(browser: Browser, page: Page, pictureInPicture = false): Promise<void> {
  await browser.main.evaluate(({ webContents }, address) => {
    const contents = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL() === address);
    if (contents === undefined) throw new Error(`No page at ${address}`);
    const paused = new Promise<void>((done) => contents.once('media-paused', () => done()));
    Object.assign(globalThis, { videoPaused: paused });
  }, page.url());
  await page.evaluate(async (into) => {
    const video = document.querySelector<HTMLVideoElement>('#clip');
    video?.pause();
    if (into) await video?.requestPictureInPicture();
  }, pictureInPicture);
  await browser.main.evaluate(
    () => (globalThis as unknown as { videoPaused: Promise<void> }).videoPaused,
  );
}

/**
 * Pauses the video of a page and shows it in picture in picture as the page's own button would,
 * without the browser, and waits until the browser process learned that the video paused.
 */
async function pauseIntoPictureInPicture(browser: Browser, page: Page): Promise<void> {
  await pauseVideo(browser, page, true);
}

/**
 * Right-clicks a video in a frame of another site until the browser builds the context menu of
 * the video: Chromium gives a click to such a frame only once the frame shows in the page, and
 * the page gets the click before.
 * @param item - An item that the menu of the video has.
 * @returns The items of the menu.
 */
async function videoMenuOf(
  browser: Browser,
  frame: Frame,
  selector: string,
  item: string,
): Promise<readonly string[]> {
  let items: readonly string[] = [];
  await expect
    .poll(async () => {
      await frame.click(selector, { button: 'right' });
      items = (await recordedMenu(browser)).items;
      return items.includes(item);
    })
    .toBe(true);
  return items;
}

/** Whether the tab at a place sleeps. */
async function sleeping(browser: Browser, index: number): Promise<boolean | undefined> {
  return (await shellState(browser.shell)).tabs[index]?.sleeping;
}

/** Whether the page at an address is still loaded in a view of the browser. */
function alive(browser: Browser, url: string): Promise<boolean> {
  return browser.main.evaluate(
    ({ webContents }, address) =>
      webContents
        .getAllWebContents()
        .some((contents) => !contents.isDestroyed() && contents.getURL() === address),
    url,
  );
}

test('shows a video that plays in picture in picture with the button next to the address bar, and ends it', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/index.html`);
    expect(await states(browser)).toEqual(['none']);
    const page = await open(browser, `${server.origin}/video.html`);
    await playing(page, 'clip');
    const button = pipButton(browser);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    // The click in the shell is none of the page's: the browser gives the page its activation.
    await button.click();
    await expect.poll(() => shownVideo(page)).toBe('clip');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(await states(browser)).toEqual(['open']);
    await button.click();
    await expect.poll(() => shownVideo(page)).toBe(null);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    // The command palette runs the same command, as its view is no page either.
    await pressNative(browser, 'K', ['primary']);
    const overlay = await overlayPage(browser);
    const dialog = overlay.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('picture in picture');
    await expect(dialog.getByRole('option', { name: /^Picture in picture/ }).first()).toBeVisible();
    await dialog.getByRole('combobox').press('Enter');
    await expect.poll(() => shownVideo(page)).toBe('clip');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await browser.close();
  }
});

test('takes the video that plays among several, also in a frame of another site', async () => {
  const browser = await launch(['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server']);
  try {
    const { port } = new URL(server.origin);
    const inner = `http://media.astela-e2e.test:${port}/video-frame.html`;
    const page = await open(
      browser,
      `${server.origin}/videos.html?frame=${encodeURIComponent(inner)}`,
    );
    const frame = await frameOf(page, inner);
    await playing(page, 'small');
    await ready(page, 'poster');
    await ready(frame, 'framed');
    // The small video plays, the large one and the one of the frame wait.
    const button = pipButton(browser);
    await button.click();
    await expect.poll(() => shownVideo(page)).toBe('small');
    await button.click();
    await expect.poll(() => shownVideo(page)).toBe(null);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    // Now the video of the frame of another site plays, and the small one waits.
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('#small')?.pause());
    await frame.evaluate(() => document.querySelector<HTMLVideoElement>('#framed')?.play());
    await playing(frame, 'framed');
    await expect.poll(() => states(browser)).toEqual(['available']);
    await button.click();
    await expect.poll(() => shownVideo(frame)).toBe('framed');
    expect(await shownVideo(page)).toBe(null);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect.poll(() => shownVideo(frame)).toBe(null);
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await browser.close();
  }
});

test('does what its button shows when the page ended picture in picture itself', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/video.html`);
    await playing(page, 'clip');
    const button = pipButton(browser);
    await button.click();
    await expect.poll(() => shownVideo(page)).toBe('clip');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    // The browser learns that the page ended it only when it looks at the page again.
    await page.evaluate(() => document.exitPictureInPicture());
    expect(await shownVideo(page)).toBe(null);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    // The pressed button ends picture in picture: there is none, so it only shows that.
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await new Promise((done) => setTimeout(done, 500));
    expect(await shownVideo(page)).toBe(null);
    // The next click shows the video again.
    await button.click();
    await expect.poll(() => shownVideo(page)).toBe('clip');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await browser.close();
  }
});

test('offers picture in picture in the context menu of a video and in the browser menu', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/videos.html`);
    await playing(page, 'small');
    await ready(page, 'poster');
    await recordMenus(browser);
    // The context menu shows the video that it was opened for, though another one plays.
    await page.click('#poster', { button: 'right' });
    expect((await recordedMenu(browser, 1)).items).toContain(contextItem);
    await chooseMenuItem(browser, [contextItem]);
    await expect.poll(() => shownVideo(page)).toBe('poster');
    await expect(pipButton(browser)).toHaveAttribute('aria-pressed', 'true');
    await page.click('#poster', { button: 'right' });
    const shown = await recordedMenu(browser, 2);
    expect(shown.items).toContain(contextExit);
    expect(shown.items).not.toContain(contextItem);
    await chooseMenuItem(browser, [contextExit]);
    await expect.poll(() => shownVideo(page)).toBe(null);
    await expect(pipButton(browser)).toHaveAttribute('aria-pressed', 'false');
    // The browser menu shows the video that plays, with a check mark while it shows.
    const name = mac ? 'Picture in Picture' : 'Picture in picture';
    let menu = await openBrowserMenu(browser);
    let item = menu.getByRole('menuitemcheckbox', { name, exact: true });
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAttribute('aria-checked', 'false');
    await item.click();
    await expect.poll(() => shownVideo(page)).toBe('small');
    menu = await openBrowserMenu(browser);
    item = menu.getByRole('menuitemcheckbox', { name, exact: true });
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await item.click();
    await expect.poll(() => shownVideo(page)).toBe(null);
  } finally {
    await browser.close();
  }
});

test('speaks German in its button and in the context menu of a video', async () => {
  const browser = await launch(['--lang=de']);
  try {
    const page = await open(browser, `${server.origin}/video.html`, 'Adress- und Suchleiste');
    await playing(page, 'clip');
    await expect(pipButton(browser, 'Bild im Bild')).toHaveAttribute('aria-pressed', 'false');
    await recordMenus(browser);
    await page.click('#clip', { button: 'right' });
    // German has no title case, so its item is the same on every system.
    expect((await recordedMenu(browser, 1)).items).toContain('&Bild im Bild');
  } finally {
    await browser.close();
  }
});

test('offers no picture in picture while its setting is off, and leaves the keys that people gave it to the page', async () => {
  const browser = await launch([], {
    settings: {
      'pictureInPicture.enabled': false,
      'keys.shortcuts': { 'media.pictureInPicture': ['F7'] },
    },
  });
  try {
    const page = await open(browser, `${server.origin}/video.html`);
    await playing(page, 'clip');
    await new Promise((done) => setTimeout(done, 1000));
    await expect(pipButton(browser)).toHaveCount(0);
    expect(await states(browser)).toEqual(['none']);
    await recordMenus(browser);
    await page.click('#clip', { button: 'right' });
    const items = (await recordedMenu(browser, 1)).items;
    expect(items.filter((label) => /picture/i.test(label))).toEqual([]);
    const menu = await openBrowserMenu(browser);
    expect((await menuEntries(menu)).filter((entry) => /picture/i.test(entry))).toEqual([]);
    await menu.press('Escape');
    // The key of the command reaches the page, and shows nothing in picture in picture.
    await page.evaluate(() => {
      const keys: string[] = [];
      Reflect.set(window, 'keys', keys);
      addEventListener('keydown', (event) => keys.push(event.code), true);
    });
    await pressNative(browser, 'F7', [], server.origin);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'keys'))).toEqual(['F7']);
    await new Promise((done) => setTimeout(done, 500));
    expect(await shownVideo(page)).toBe(null);
  } finally {
    await browser.close();
  }
});

test('keeps a tab awake whose page showed a video in picture in picture itself, when its menu puts it to sleep', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/video.html`;
    const page = await open(browser, url);
    await playing(page, 'clip');
    // The browser has looked at the page since its video began to play, and looks no more once
    // the look that the start of the video planned is done: within a second of the first change
    // of its media and at most every 250 ms, so the page enters picture in picture after it.
    await expect.poll(() => states(browser)).toEqual(['available']);
    await new Promise((done) => setTimeout(done, 1500));
    await newTab(browser);
    // In the background, the page shows its video in picture in picture without the browser,
    // as with a button of its own, and pauses it.
    await pauseIntoPictureInPicture(browser, page);
    expect(await shownVideo(page)).toBe('clip');
    expect((await states(browser))[0]).not.toBe('open');
    await recordMenus(browser);
    const tab = browser.shell.getByRole('tab', { name: /Fixture video/ });
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [sleepItem]);
    // The browser asks the page first, which keeps its tab and its video.
    await expect.poll(() => states(browser)).toEqual(['open', 'none']);
    await new Promise((done) => setTimeout(done, 1000));
    expect((await shellState(browser.shell)).tabs[0]?.sleeping).toBe(false);
    expect(await alive(browser, url)).toBe(true);
    expect(await shownVideo(page)).toBe('clip');
    // Its menu no longer offers sleep while the video shows in picture in picture.
    const count = await menuCount(browser);
    await tab.click({ button: 'right' });
    const menu = await recordedMenu(browser, count + 1);
    const label = menu.items.find((item) => item.replaceAll('&', '') === sleepItem);
    expect(label).toBeDefined();
    expect(menu.disabled).toContain(label);
  } finally {
    await browser.close();
  }
});

test('keeps a tab awake whose video shows in picture in picture while tabs go to sleep by themselves', async () => {
  test.setTimeout(120_000);
  // 30 seconds is a time that only a policy or the settings file sets.
  const browser = await launch([], { settings: { 'tabs.sleepAfter': 30 } });
  try {
    const video = `${server.origin}/video.html`;
    const other = `${server.origin}/index.html`;
    const page = await open(browser, video);
    await playing(page, 'clip');
    // The browser has looked at the page since its video began to play, and looks no more.
    await expect.poll(() => states(browser)).toEqual(['available']);
    await newTab(browser);
    await open(browser, other);
    await newTab(browser);
    // The paused video of the first tab shows in picture in picture, which its page started.
    await pauseIntoPictureInPicture(browser, page);
    expect((await states(browser))[0]).not.toBe('open');
    // Once the first tab is due, the browser asks its page, which keeps the tab awake.
    await expect.poll(async () => (await states(browser))[0], { timeout: 60_000 }).toBe('open');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.sleeping), {
        timeout: 60_000,
      })
      .toEqual([false, true, false]);
    // The other page went to sleep after its time, and the video stays.
    expect(await alive(browser, video)).toBe(true);
    expect(await alive(browser, other)).toBe(false);
    expect(await shownVideo(page)).toBe('clip');
  } finally {
    await browser.close();
  }
});

test('keeps a tab awake whose page showed a video in picture in picture itself, also while picture in picture is off', async () => {
  const browser = await launch([], { settings: { 'pictureInPicture.enabled': false } });
  try {
    const url = `${server.origin}/video.html`;
    const page = await open(browser, url);
    await playing(page, 'clip');
    await newTab(browser);
    await pauseIntoPictureInPicture(browser, page);
    await recordMenus(browser);
    const tab = browser.shell.getByRole('tab', { name: /Fixture video/ });
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [sleepItem]);
    await new Promise((done) => setTimeout(done, 1500));
    // The browser asked the page, which keeps its tab and its video, and shows nothing of it.
    expect(await sleeping(browser, 0)).toBe(false);
    expect(await alive(browser, url)).toBe(true);
    expect(await shownVideo(page)).toBe('clip');
    expect(await states(browser)).toEqual(['none', 'none']);
    // Its menu no longer offers sleep while the video shows in picture in picture.
    const count = await menuCount(browser);
    await tab.click({ button: 'right' });
    const menu = await recordedMenu(browser, count + 1);
    const label = menu.items.find((item) => item.replaceAll('&', '') === sleepItem);
    expect(label).toBeDefined();
    expect(menu.disabled).toContain(label);
  } finally {
    await browser.close();
  }
});

test('counts a tab as used until its video left picture in picture, so that its time to sleep begins then', async () => {
  test.setTimeout(150_000);
  // 30 seconds is a time that only a policy or the settings file sets.
  const browser = await launch([], { settings: { 'tabs.sleepAfter': 30 } });
  try {
    const url = `${server.origin}/video.html`;
    const page = await open(browser, url);
    await playing(page, 'clip');
    await pipButton(browser).click();
    await expect.poll(() => shownVideo(page)).toBe('clip');
    await newTab(browser);
    // The video pauses in picture in picture, and shows there for longer than the time to sleep.
    await pauseVideo(browser, page);
    await new Promise((done) => setTimeout(done, 35_000));
    expect(await sleeping(browser, 0)).toBe(false);
    // Its window closes, which the browser learns once its window gets the focus.
    await page.evaluate(() => document.exitPictureInPicture());
    await browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.emit('focus'));
    await expect.poll(async () => (await states(browser))[0]).toBe('none');
    // The tab was busy until then: it goes to sleep once its time has passed again.
    await new Promise((done) => setTimeout(done, 5000));
    expect(await sleeping(browser, 0)).toBe(false);
    expect(await alive(browser, url)).toBe(true);
    await expect.poll(() => sleeping(browser, 0), { timeout: 45_000 }).toBe(true);
  } finally {
    await browser.close();
  }
});

test('offers picture in picture for a video that began to play while its page loaded, once the page has loaded', async () => {
  // A frame of the page that keeps it loading, as frames of ads do.
  const release = server.hold('video-frame.html');
  const browser = await launch();
  try {
    const frame = encodeURIComponent('/video-frame.html');
    const page = await open(browser, `${server.origin}/videos.html?frame=${frame}`);
    await playing(page, 'small');
    // Electron would run the media script only once every frame has loaded: the browser does
    // not ask a page that loads.
    await new Promise((done) => setTimeout(done, 4000));
    expect(await states(browser)).toEqual(['none']);
    await expect(pipButton(browser)).toHaveCount(0);
    release();
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
    // It looks once the page has loaded, while the video plays on.
    await expect.poll(() => states(browser)).toEqual(['available']);
    await expect(pipButton(browser)).toHaveAttribute('aria-pressed', 'false');
  } finally {
    release();
    await browser.close();
  }
});

test('shows the video of a context menu once its page has loaded soon after, and only in the page that it was opened on', async () => {
  // A picture of the page that keeps it loading.
  let release = server.hold('image.png');
  const browser = await launch();
  try {
    const picture = encodeURIComponent('/image.png');
    const url = `${server.origin}/videos.html?picture=${picture}`;
    const page = await open(browser, url);
    await playing(page, 'small');
    await ready(page, 'poster');
    await recordMenus(browser);
    // Picture in picture for a video of the page that still loads, then another page with a
    // video in the tab, which loads at once.
    await page.click('#poster', { button: 'right' });
    expect((await recordedMenu(browser, 1)).items).toContain(contextItem);
    await chooseMenuItem(browser, [contextItem]);
    const other = await open(browser, `${server.origin}/video.html`);
    await playing(other, 'clip');
    await new Promise((done) => setTimeout(done, 3000));
    // The script of the browser, with its activation, ran in no page: the video of the other
    // page, which no click asked for, does not show in picture in picture.
    expect(await shownVideo(other)).toBe(null);
    // A page that has loaded within 3 s of the click shows the video once it has.
    release();
    release = server.hold('image.png');
    const again = await open(browser, url);
    await ready(again, 'poster');
    await again.click('#poster', { button: 'right' });
    expect((await recordedMenu(browser, 2)).items).toContain(contextItem);
    await chooseMenuItem(browser, [contextItem]);
    await new Promise((done) => setTimeout(done, 1000));
    expect(await shownVideo(again)).toBe(null);
    release();
    await expect.poll(() => shownVideo(again)).toBe('poster');
    await expect(pipButton(browser)).toHaveAttribute('aria-pressed', 'true');
  } finally {
    release();
    await browser.close();
  }
});

test('ends picture in picture from the context menu of a video in a frame beyond those that the browser asks, and shows it pressed meanwhile', async () => {
  const browser = await launch(['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server']);
  try {
    const { port } = new URL(server.origin);
    const player = `http://media.astela-e2e.test:${port}/video-frame.html`;
    const page = await open(
      browser,
      `${server.origin}/many-frames.html?player=${encodeURIComponent(player)}`,
    );
    const frame = await frameOf(page, player);
    await ready(frame, 'framed');
    await recordMenus(browser);
    expect(await videoMenuOf(browser, frame, '#framed', contextItem)).toContain(contextItem);
    await chooseMenuItem(browser, [contextItem]);
    await expect.poll(() => shownVideo(frame)).toBe('framed');
    // The browser asks the frame that it showed a video of first, also after sixteen others.
    await expect(pipButton(browser)).toHaveAttribute('aria-pressed', 'true');
    expect(await states(browser)).toEqual(['open']);
    const shown = await videoMenuOf(browser, frame, '#framed', contextExit);
    expect(shown).not.toContain(contextItem);
    await chooseMenuItem(browser, [contextExit]);
    await expect.poll(() => shownVideo(frame)).toBe(null);
    await expect.poll(() => states(browser)).toEqual(['none']);
  } finally {
    await browser.close();
  }
});

test('refuses a window of Document Picture-in-Picture, which shows in no tab', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/document-pip.html`);
    await page.click('#open');
    await expect(page.locator('#result')).toHaveText(/^refused: /);
    await new Promise((done) => setTimeout(done, 500));
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  } finally {
    await browser.close();
  }
});
