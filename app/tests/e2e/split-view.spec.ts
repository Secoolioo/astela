import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { release } from 'node:os';
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
  type AttachedTabView,
  type Browser,
} from './harness.ts';

const mac = process.platform === 'darwin';
/**
 * macOS 15 and later (Darwin 24) let people choose what to share in a picker of their own,
 * and the browser shows none.
 */
const systemPicker = mac && Number.parseInt(release(), 10) >= 24;
const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** The address of a fixture page. */
const fixture = (name: string): string => `${server.origin}/${name}`;

/** The texts of the items of the tab menu, as they show without the marks of access keys. */
const items = mac
  ? {
      splitWith: 'Open in Split View',
      splitNew: 'New Tab in Split View',
      swap: 'Swap Sides',
      end: 'End Split View',
      pin: 'Pin',
    }
  : {
      splitWith: 'Open in split view',
      splitNew: 'New tab in split view',
      swap: 'Swap sides',
      end: 'End split view',
      pin: 'Pin',
    };

/** The address bar of the shell. */
function addressBar(browser: Browser): Locator {
  return browser.shell.getByRole('textbox', { name: 'Address and search bar' });
}

/** Loads an address in the active tab and gives its page once it has painted. */
async function open(browser: Browser, url: string): Promise<Page> {
  await addressBar(browser).fill(url);
  await addressBar(browser).press('Enter');
  const page = await waitForPage(browser, (current) => current === url);
  await page.waitForLoadState('load');
  // Chromium drops the key presses for a new page until it has painted its first content,
  // which on a slow machine can come after the load event.
  await page.waitForFunction(
    () => performance.getEntriesByName('first-contentful-paint').length > 0,
  );
  return page;
}

/**
 * Presses a key as a native input event in the view of the page at an address, so that the
 * browser's own shortcuts see it.
 */
async function pressIn(
  browser: Browser,
  url: string,
  keyCode: string,
  modifiers: readonly ('control' | 'meta' | 'shift' | 'alt')[] = [],
): Promise<void> {
  await browser.main.evaluate(
    ({ webContents }, { address, key, mods }) => {
      const view = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === address);
      if (view === undefined) throw new Error(`No page at ${address}`);
      view.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
      view.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
    },
    { address: url, key: keyCode, mods: [...modifiers] },
  );
}

/** Presses the shortcut of split view in a page: Ctrl+Shift+S, Control+Command+S on macOS. */
function pressSplit(browser: Browser, url: string): Promise<void> {
  return pressIn(browser, url, 'S', mac ? ['control', 'meta'] : ['control', 'shift']);
}

/** Gives the view of the page at an address the focus, as a click into it does. */
async function focusView(browser: Browser, url: string): Promise<void> {
  await browser.main.evaluate(({ webContents }, address) => {
    webContents
      .getAllWebContents()
      .find((contents) => contents.getURL() === address)
      ?.focus();
  }, url);
  await expect.poll(async () => (await viewOf(browser, url))?.focused).toBe(true);
}

/** The view of a tab that the window shows at an address. */
async function viewOf(browser: Browser, url: string): Promise<AttachedTabView | undefined> {
  return (await tabViews(browser)).find((view) => view.url === url);
}

/** The view of a new tab page that the window shows. */
async function newTabView(browser: Browser): Promise<AttachedTabView | undefined> {
  return (await tabViews(browser)).find((view) => view.url.startsWith('app://newtab'));
}

/** Waits until the active tab is a new tab page, which the shell shows. */
async function newTabShown(browser: Browser, count: number): Promise<void> {
  await expect(browser.shell.getByRole('tab')).toHaveCount(count);
  await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
    'title',
    'New tab',
  );
}

/** The titles of the tabs in the order of the strip. */
async function strip(browser: Browser): Promise<string[]> {
  return (await shellState(browser.shell)).tabs.map((tab) => tab.title);
}

/** The window's area for pages: the bounds of the one page that it shows. */
async function pageArea(browser: Browser, url: string): Promise<AttachedTabView['bounds']> {
  await expect.poll(async () => (await tabViews(browser)).length).toBe(1);
  const view = await viewOf(browser, url);
  if (view === undefined) throw new Error(`No view of ${url}`);
  return view.bounds;
}

/**
 * Opens a page in the active tab, and a second page beside it in a split view with the
 * shortcut; the second page has the focus.
 */
async function splitWith(
  browser: Browser,
  left: string,
  right: string,
  count = 2,
): Promise<{ leftPage: Page; rightPage: Page }> {
  await open(browser, left);
  return splitFrom(browser, left, right, count);
}

/**
 * Opens a page beside the page of the active tab in a split view with the shortcut; the new
 * page has the focus.
 */
async function splitFrom(
  browser: Browser,
  left: string,
  right: string,
  count = 2,
): Promise<{ leftPage: Page; rightPage: Page }> {
  const leftPage = await waitForPage(browser, (current) => current === left);
  await focusView(browser, left);
  await pressSplit(browser, left);
  await newTabShown(browser, count);
  await expect(addressBar(browser)).toBeFocused();
  const rightPage = await open(browser, right);
  await expect.poll(async () => (await viewOf(browser, right))?.focused).toBe(true);
  return { leftPage, rightPage };
}

/** Opens the menu of a tab with the secondary button, once the browser built it. */
async function tabMenu(browser: Browser, title: string): Promise<void> {
  const count = await menuCount(browser);
  await browser.shell.getByRole('tab', { name: title, exact: true }).click({ button: 'right' });
  await recordedMenu(browser, count + 1);
}

/** Whether the middle of a dialog of the overlay lies within the side of a page. */
async function overSide(
  dialog: Locator,
  side: AttachedTabView['bounds'] | undefined,
): Promise<boolean> {
  const box = await dialog.boundingBox();
  if (box === null || side === undefined) return false;
  const center = box.x + box.width / 2;
  return center >= side.x && center <= side.x + side.width;
}

/** The key presses with Ctrl or Command that reached the page of the fixture `keys.html`. */
function seen(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, 'seen') as unknown);
}

/** The web pages of the fixture server that the browser has loaded now. */
function fixturePages(browser: Browser): Promise<string[]> {
  return browser.main.evaluate(
    ({ webContents }, origin) =>
      webContents
        .getAllWebContents()
        .map((contents) => contents.getURL())
        .filter((url) => url.startsWith(origin)),
    server.origin,
  );
}

test('opens a new tab beside the page with the shortcut and ends the split with it', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await open(browser, home);
    const area = await pageArea(browser, home);
    await focusView(browser, home);
    await pressSplit(browser, home);
    await newTabShown(browser, 2);
    const state = await shellState(browser.shell);
    const [left, right] = state.tabs;
    expect(state.split).toEqual({ start: left?.id, end: right?.id, ratio: 0.5 });
    expect(state.tabs.map((tab) => tab.split)).toEqual(['start', 'end']);
    expect(state.activeTabId).toBe(right?.id);
    await expect(addressBar(browser)).toBeFocused();
    await expect(addressBar(browser)).toHaveValue('');
    // Screen readers hear which side each tab is.
    const homeTab = browser.shell.getByRole('tab', { name: 'Fixture home' });
    await expect(homeTab).toHaveAttribute('aria-description', 'Left side of the split view');
    await expect(browser.shell.getByRole('tab', { name: 'New tab' })).toHaveAttribute(
      'aria-description',
      'Right side of the split view',
    );
    // Both pages show: the left one at the start of the area, both below the line of the side
    // with the focus, with the divider between them.
    await expect.poll(async () => (await tabViews(browser)).length).toBe(2);
    const home1 = await viewOf(browser, home);
    const blank = await newTabView(browser);
    expect(home1?.visible && blank?.visible).toBe(true);
    expect(home1?.bounds).toMatchObject({ x: area.x, y: area.y + 2, height: area.height - 2 });
    expect(blank?.bounds.y).toBe(area.y + 2);
    expect((home1?.bounds.width ?? 0) + 8 + (blank?.bounds.width ?? 0)).toBe(area.width);
    expect(blank?.bounds.x).toBe(area.x + (home1?.bounds.width ?? 0) + 8);
    // The right side loads what is typed into the address bar, in its place.
    await open(browser, second);
    await expect.poll(async () => (await viewOf(browser, second))?.focused).toBe(true);
    expect((await viewOf(browser, second))?.bounds).toEqual(blank?.bounds);
    expect((await viewOf(browser, home))?.bounds).toEqual(home1?.bounds);
    // The shortcut in the right page ends the split; its tab stays active.
    await pressSplit(browser, second);
    await expect.poll(async () => (await shellState(browser.shell)).split).toBeNull();
    const after = await shellState(browser.shell);
    expect(after.tabs).toHaveLength(2);
    expect(after.activeTabId).toBe(right?.id);
    expect(after.tabs.map((tab) => tab.split)).toEqual([null, null]);
    expect(await pageArea(browser, second)).toEqual(area);
    // Neither tab is a side any more.
    await expect(homeTab).not.toHaveAttribute('aria-description');
    await expect(browser.shell.getByRole('tab', { name: 'Fixture second' })).not.toHaveAttribute(
      'aria-description',
    );
  } finally {
    await browser.close();
  }
});

test('moves the focus to the other side when its page takes the focus, and keeps it there when the other page navigates or calls window.focus()', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    const { leftPage, rightPage } = await splitWith(browser, home, second);
    const [left, right] = (await shellState(browser.shell)).tabs;
    // A click into the left page gives it the focus, as the browser process does here.
    await focusView(browser, home);
    await expect.poll(async () => (await shellState(browser.shell)).activeTabId).toBe(left?.id);
    await expect(addressBar(browser)).toHaveValue(home);
    await expect(browser.shell.getByRole('tab', { name: 'Fixture home' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(browser.shell.locator('.split .marker[data-side="start"]')).toHaveAttribute(
      'data-focused',
      '',
    );
    await expect(browser.shell.locator('.split .marker[data-side="end"]')).not.toHaveAttribute(
      'data-focused',
    );
    expect((await tabViews(browser)).map((view) => view.visible)).toEqual([true, true]);
    // The next tab is the other side.
    await pressIn(browser, home, 'Tab', ['control']);
    await expect.poll(async () => (await shellState(browser.shell)).activeTabId).toBe(right?.id);
    await expect.poll(async () => (await viewOf(browser, second))?.focused).toBe(true);
    const stays = async (): Promise<void> => {
      expect((await shellState(browser.shell)).activeTabId).toBe(right?.id);
      expect((await viewOf(browser, second))?.focused).toBe(true);
    };
    // The left page goes to another address by itself.
    const again = `${home}?again`;
    await leftPage.evaluate(() => {
      location.href = '/index.html?again';
    });
    await expect.poll(async () => (await viewOf(browser, again))?.url).toBe(again);
    const moved = await waitForPage(browser, (url) => url === again);
    await expect(moved.getByRole('heading', { name: 'Fixture home' })).toBeVisible();
    await stays();
    // The left page asks for the focus.
    await moved.evaluate(() => {
      window.focus();
      document.querySelector('a')?.focus();
    });
    await new Promise((done) => setTimeout(done, 300));
    await stays();
    // Tab past the end of the right page stays in the right page.
    for (let press = 0; press < 4; press += 1) await pressIn(browser, second, 'Tab');
    await new Promise((done) => setTimeout(done, 300));
    await stays();
    expect(await rightPage.evaluate(() => document.title)).toBe('Fixture second');
  } finally {
    await browser.close();
  }
});

test('gives the other tab the whole content area when one side closes', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await open(browser, home);
    const area = await pageArea(browser, home);
    await splitFrom(browser, home, second);
    const close = browser.shell
      .getByRole('tab', { name: 'Fixture second' })
      .getByRole('button', { name: 'Close tab' });
    await close.click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    expect(await pageArea(browser, home)).toEqual(area);
    const state = await shellState(browser.shell);
    expect(state.split).toBeNull();
    expect(state.tabs.map((tab) => tab.split)).toEqual([null]);
    expect(state.activeTabId).toBe(state.tabs[0]?.id);
    await expect.poll(async () => (await viewOf(browser, home))?.focused).toBe(true);
  } finally {
    await browser.close();
  }
});

/** A port on which nothing listens, so connections to it are refused. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

test('shows why a page did not load in its own side, and Try again reloads that side', async () => {
  const browser = await launch();
  const port = await freePort();
  let late: Server | undefined;
  try {
    const home = fixture('index.html');
    const url = `http://127.0.0.1:${port}/late.html`;
    await open(browser, home);
    await focusView(browser, home);
    await pressSplit(browser, home);
    await newTabShown(browser, 2);
    await addressBar(browser).fill(url);
    await addressBar(browser).press('Enter');
    const problem = browser.shell.getByRole('region', { name: "This page can't be reached" });
    await expect(problem).toBeVisible();
    await expect.poll(async () => (await viewOf(browser, url))?.visible).toBe(false);
    expect((await viewOf(browser, home))?.visible).toBe(true);
    const side = (await viewOf(browser, url))?.bounds;
    const inside = async (): Promise<boolean> => {
      const box = await problem.boundingBox();
      return (
        box !== null &&
        side !== undefined &&
        box.x >= side.x &&
        box.x + box.width <= side.x + side.width
      );
    };
    expect(await inside()).toBe(true);
    // The left side gets the focus; the problem stays on its side.
    await focusView(browser, home);
    await expect(addressBar(browser)).toHaveValue(home);
    await expect(problem).toBeVisible();
    expect(await inside()).toBe(true);
    late = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Late</title><p>Here now</p>');
    });
    await new Promise<void>((done) => late?.listen(port, '127.0.0.1', done));
    await problem.getByRole('button', { name: 'Try again' }).click();
    await expect(problem).toBeHidden();
    await expect.poll(async () => (await viewOf(browser, url))?.visible).toBe(true);
    expect((await viewOf(browser, url))?.bounds).toEqual(side);
    const page = await waitForPage(browser, (current) => current === url);
    await expect(page.getByText('Here now')).toBeVisible();
  } finally {
    await browser.close();
    await new Promise<void>((done) => (late === undefined ? done() : late.close(() => done())));
  }
});

/** Whether the window is in full screen; on macOS, it covers the screen without a space. */
function windowFullScreen(browser: Browser): Promise<boolean | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0];
    return process.platform === 'darwin' ? window?.isSimpleFullScreen() : window?.isFullScreen();
  });
}

test('lets the page of one side cover the window in full screen and brings both sides back', async () => {
  const browser = await launch();
  try {
    const find = fixture('find.html');
    const second = fixture('second.html');
    const { leftPage } = await splitWith(browser, find, second);
    await focusView(browser, find);
    const sides = (await tabViews(browser)).map((view) => view.bounds);
    await leftPage.getByRole('button', { name: 'Full screen' }).click();
    await expect.poll(() => windowFullScreen(browser)).toBe(true);
    const window = await browser.main.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]?.getContentBounds(),
    );
    await expect
      .poll(async () => (await viewOf(browser, find))?.bounds)
      .toEqual({ x: 0, y: 0, width: window?.width, height: window?.height });
    await expect.poll(async () => (await viewOf(browser, second))?.visible).toBe(false);
    await pressIn(browser, find, 'Escape');
    await expect.poll(() => windowFullScreen(browser)).toBe(false);
    await expect
      .poll(async () => (await tabViews(browser)).map((view) => view.bounds))
      .toEqual(sides);
    expect((await tabViews(browser)).map((view) => view.visible)).toEqual([true, true]);
  } finally {
    await browser.close();
  }
});

test('opens a tab in split view from its menu, swaps the sides and ends the split there; pinning ends it too', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await open(browser, home);
    const area = await pageArea(browser, home);
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await newTabShown(browser, 2);
    await open(browser, second);
    await recordMenus(browser);
    // The tab joins the active tab, on its right.
    await tabMenu(browser, 'Fixture home');
    await chooseMenuItem(browser, [items.splitWith]);
    await expect.poll(() => strip(browser)).toEqual(['Fixture second', 'Fixture home']);
    let state = await shellState(browser.shell);
    expect(state.split?.start).toBe(state.tabs[0]?.id);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
    await expect.poll(async () => (await viewOf(browser, home))?.focused).toBe(true);
    expect((await tabViews(browser)).map((view) => view.visible)).toEqual([true, true]);
    // The sides swap.
    await tabMenu(browser, 'Fixture second');
    await chooseMenuItem(browser, [items.swap]);
    await expect.poll(() => strip(browser)).toEqual(['Fixture home', 'Fixture second']);
    await expect.poll(async () => (await viewOf(browser, home))?.bounds.x).toBe(area.x);
    // The split ends; both tabs stay.
    await tabMenu(browser, 'Fixture home');
    await chooseMenuItem(browser, [items.end]);
    await expect.poll(async () => (await shellState(browser.shell)).split).toBeNull();
    expect(await strip(browser)).toEqual(['Fixture home', 'Fixture second']);
    // The menu of the active tab opens a new tab beside it.
    state = await shellState(browser.shell);
    const active = state.tabs.find((tab) => tab.id === state.activeTabId);
    await tabMenu(browser, active?.title ?? '');
    await chooseMenuItem(browser, [items.splitNew]);
    await newTabShown(browser, 3);
    await expect(addressBar(browser)).toBeFocused();
    state = await shellState(browser.shell);
    expect(state.split?.end).toBe(state.activeTabId);
    expect(state.split?.start).toBe(active?.id);
    // Pinning a side ends the split, and the tab goes first.
    await tabMenu(browser, active?.title ?? '');
    await chooseMenuItem(browser, [items.pin]);
    await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.pinned).toBe(true);
    state = await shellState(browser.shell);
    expect(state.split).toBeNull();
    expect(state.tabs.map((tab) => tab.split)).toEqual([null, null, null]);
    expect(state.tabs[0]?.id).toBe(active?.id);
    // A pinned tab offers no split view.
    await tabMenu(browser, active?.title ?? '');
    const menu = await recordedMenu(browser);
    const label = menu.items.find((item) => item.replaceAll('&', '') === items.splitWith);
    expect(label).toBeDefined();
    expect(menu.disabled).toContain(label);
  } finally {
    await browser.close();
  }
});

/**
 * Keeps the moves of the system's mouse from the shell while Playwright's mouse drags the
 * divider. The drag captures the system's mouse for the shell too, and on Windows that mouse,
 * which holds no button, reports a move whenever the pages under it change their size; the
 * shell takes a move without a button for the end of the drag. In a real drag, the system's
 * mouse holds the button.
 */
async function ignoreSystemMoves(browser: Browser): Promise<void> {
  await browser.shell.evaluate(() => {
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons === 0) event.stopImmediatePropagation();
      },
      { capture: true },
    );
  });
}

test('moves the divider with the pointer and the keyboard, and both pages follow', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await open(browser, home);
    const area = await pageArea(browser, home);
    await splitFrom(browser, home, second);
    const divider = browser.shell.getByRole('separator', { name: 'Divider of the split view' });
    await expect(divider).toBeVisible();
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    await expect(divider).toHaveAttribute('aria-valuetext', 'Left 50%, right 50%');
    const before = await tabViews(browser);
    const [leftBefore, rightBefore] = [before[0]?.bounds, before[1]?.bounds];
    const box = await divider.boundingBox();
    if (box === null || leftBefore === undefined || rightBefore === undefined) {
      throw new Error('No divider');
    }
    // The divider lies between the two pages, where the browser process leaves room for it.
    expect(box).toMatchObject({ x: leftBefore.x + leftBefore.width, width: 8 });
    expect(rightBefore.x).toBe(box.x + box.width);
    await ignoreSystemMoves(browser);
    const mouse = browser.shell.mouse;
    await mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mouse.down();
    await mouse.move(box.x + box.width / 2 - 160, box.y + box.height / 2, { steps: 8 });
    // The pages follow while the divider moves.
    await expect
      .poll(async () => (await viewOf(browser, home))?.bounds.width ?? 0)
      .toBeLessThan(leftBefore.width - 100);
    await mouse.up();
    await expect
      .poll(async () => (await shellState(browser.shell)).split?.ratio ?? 0)
      .toBeLessThan(0.45);
    const left = (await viewOf(browser, home))?.bounds;
    const right = (await viewOf(browser, second))?.bounds;
    expect(Math.abs((left?.width ?? 0) - (leftBefore.width - 160))).toBeLessThanOrEqual(2);
    expect(Math.abs((right?.x ?? 0) - (rightBefore.x - 160))).toBeLessThanOrEqual(2);
    const ratio = (await shellState(browser.shell)).split?.ratio ?? 0;
    expect(Math.abs(ratio - (leftBefore.width - 160) / (area.width - 8))).toBeLessThan(0.01);
    await expect(divider).toHaveAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    // The keys move the divider in steps and to its ends, and a double click halves the area.
    const width = (share: number): number => Math.round((area.width - 8) * share);
    const follows = async (share: number): Promise<void> => {
      await expect
        .poll(async () => (await shellState(browser.shell)).split?.ratio)
        .toBeCloseTo(share, 3);
      await expect.poll(async () => (await viewOf(browser, home))?.bounds.width).toBe(width(share));
      await expect
        .poll(async () => (await viewOf(browser, second))?.bounds.x)
        .toBe(area.x + width(share) + 8);
    };
    await divider.focus();
    await browser.shell.keyboard.press('ArrowRight');
    await follows(Math.round((ratio + 0.05) * 1000) / 1000);
    await browser.shell.keyboard.press('End');
    await follows(0.8);
    await expect(divider).toHaveAttribute('aria-valuetext', 'Left 80%, right 20%');
    await browser.shell.keyboard.press('Home');
    await follows(0.2);
    await divider.dblclick();
    await follows(0.5);
  } finally {
    await browser.close();
  }
});

test('keeps the width where a long drag on a display of 1000 Hz lets the divider go', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await open(browser, home);
    const area = await pageArea(browser, home);
    await splitFrom(browser, home, second);
    const divider = browser.shell.getByRole('separator', { name: 'Divider of the split view' });
    const box = await divider.boundingBox();
    const leftBefore = (await viewOf(browser, home))?.bounds;
    if (box === null || leftBefore === undefined) throw new Error('No divider');
    // The shell gets a frame every millisecond, as on a display of 1000 Hz.
    await browser.shell.evaluate(() => {
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(performance.now()), 1);
      window.cancelAnimationFrame = (frame) => window.clearTimeout(frame);
    });
    await ignoreSystemMoves(browser);
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await browser.shell.mouse.move(middle.x, middle.y);
    await browser.shell.mouse.down();
    // The pointer goes to and fro for three seconds, as often as a fast mouse reports it, and
    // lets go as soon as the browser took one of the widths that the pages follow. The moves of
    // Playwright's mouse reach the shell once per frame of the display of the test, 60 times a
    // second, so the moves are sent from the shell itself.
    const done = await browser.shell.evaluate(
      async ({ from, to }) => {
        const shell = document.querySelector('app-shell');
        const separator = shell?.shadowRoot?.querySelector('[role="separator"]');
        const bridge = Reflect.get(shell ?? {}, 'bridge') as
          { invoke(channel: string, request: { done?: boolean }): Promise<unknown> } | undefined;
        if (separator === null || separator === undefined || bridge === undefined) return false;
        const pointer = (type: string, clientX: number): boolean =>
          separator.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 1,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
              clientX,
              bubbles: true,
              composed: true,
            }),
          );
        // Gives the shell a moment for the frames between two moves, without waiting for a timer.
        const moment = new MessageChannel();
        moment.port1.start();
        const next = (): Promise<void> =>
          new Promise((resolve) => {
            moment.port1.addEventListener('message', () => resolve(), { once: true });
            moment.port2.postMessage(null);
          });
        // Learns when the browser took a width that the pages follow.
        let taken: (() => void) | undefined;
        const invoke = bridge.invoke.bind(bridge);
        bridge.invoke = (channel, request) => {
          const answer = invoke(channel, request);
          if (channel === 'tabs.resizeSplit' && request.done === false) {
            answer.then(
              () => taken?.(),
              () => undefined,
            );
          }
          return answer;
        };
        const started = performance.now();
        for (let step = 0; performance.now() - started < 3000; step += 1) {
          pointer('pointermove', from - (step % 50));
          await next();
        }
        const pointerUp = { done: false };
        const up = new Promise<boolean>((resolve) => {
          taken = () => {
            taken = undefined;
            pointerUp.done = true;
            resolve(pointer('pointerup', to));
          };
        });
        while (!pointerUp.done) {
          pointer('pointermove', to);
          await next();
        }
        return up;
      },
      { from: middle.x - 100, to: middle.x - 160 },
    );
    expect(done).toBe(true);
    await browser.shell.mouse.up();
    // The width that the pointer left counts: for the pages, the divider and the state.
    const width = leftBefore.width - 160;
    await expect
      .poll(async () => (await shellState(browser.shell)).split?.ratio ?? 0)
      .toBeCloseTo(width / (area.width - 8), 2);
    await expect
      .poll(async () => Math.abs(((await viewOf(browser, home))?.bounds.width ?? 0) - width))
      .toBeLessThanOrEqual(2);
    const left = (await viewOf(browser, home))?.bounds;
    await expect
      .poll(async () => (await divider.boundingBox())?.x)
      .toBe((left?.x ?? 0) + (left?.width ?? 0));
  } finally {
    await browser.close();
  }
});

test('keeps a width that a key gave the divider while an older state of the window arrives', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await splitWith(browser, home, second);
    const divider = browser.shell.getByRole('separator', { name: 'Divider of the split view' });
    await divider.focus();
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    // Two presses of the right arrow, with a state between them that the browser made before
    // it took the first, such as one of a page that loads.
    const between = await browser.shell.evaluate(async () => {
      const shell = document.querySelector('app-shell');
      const separator = shell?.shadowRoot?.querySelector('[role="separator"]');
      if (shell === null || separator === null || separator === undefined) return 'no divider';
      const press = (): boolean =>
        separator.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
        );
      const older: unknown = Reflect.get(shell, 'state');
      press();
      Reflect.set(shell, 'state', structuredClone(older));
      await Reflect.get(shell, 'updateComplete');
      const shown = separator.getAttribute('aria-valuenow');
      press();
      return shown;
    });
    expect(between).toBe('55');
    await expect
      .poll(async () => (await shellState(browser.shell)).split?.ratio)
      .toBeCloseTo(0.6, 3);
    await expect(divider).toHaveAttribute('aria-valuenow', '60');
  } finally {
    await browser.close();
  }
});

test('drags the two tabs of a split view as one and moves them with the keyboard', async () => {
  const browser = await launch([], {
    settings: { 'keys.shortcuts': { 'tab.moveLeft': ['Ctrl+Shift+PageUp'] } },
  });
  try {
    const find = fixture('find.html');
    const home = fixture('index.html');
    const second = fixture('second.html');
    await open(browser, find);
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await newTabShown(browser, 2);
    await splitWith(browser, home, second, 3);
    expect(await strip(browser)).toEqual(['Fixture find', 'Fixture home', 'Fixture second']);
    const homeTab = browser.shell.getByRole('tab', { name: 'Fixture home' });
    const secondTab = browser.shell.getByRole('tab', { name: 'Fixture second' });
    const homeBox = await homeTab.boundingBox();
    const secondBox = await secondTab.boundingBox();
    if (homeBox === null || secondBox === null) throw new Error('No tabs');
    const mouse = browser.shell.mouse;
    await mouse.move(homeBox.x + homeBox.width / 2, homeBox.y + homeBox.height / 2);
    await mouse.down();
    await mouse.move(homeBox.x + homeBox.width / 2 + 60, homeBox.y + homeBox.height / 2, {
      steps: 6,
    });
    // The other tab of the pair moves with the dragged one.
    await expect
      .poll(async () => ((await secondTab.boundingBox())?.x ?? 0) - secondBox.x)
      .toBeGreaterThan(50);
    await mouse.up();
    await expect
      .poll(async () => Math.abs(((await secondTab.boundingBox())?.x ?? 0) - secondBox.x))
      .toBeLessThan(2);
    expect(await strip(browser)).toEqual(['Fixture find', 'Fixture home', 'Fixture second']);
    expect((await shellState(browser.shell)).tabs.map((tab) => tab.split)).toEqual([
      null,
      'start',
      'end',
    ]);
    // The keys move the pair past the tab before it, also from its right side.
    await secondTab.click();
    await expect.poll(async () => (await viewOf(browser, second))?.focused).toBe(true);
    await pressIn(browser, second, 'PageUp', ['control', 'shift']);
    await expect
      .poll(() => strip(browser))
      .toEqual(['Fixture home', 'Fixture second', 'Fixture find']);
    expect((await shellState(browser.shell)).tabs.map((tab) => tab.split)).toEqual([
      'start',
      'end',
      null,
    ]);
  } finally {
    await browser.close();
  }
});

test('restores a split view with the width of its sides and loads both of its pages, not the other tabs', async () => {
  const first = await launch();
  const profile = first.profile;
  const home = fixture('index.html');
  const second = fixture('second.html');
  const find = fixture('find.html');
  try {
    await splitWith(first, home, second);
    await first.shell.getByRole('button', { name: 'New tab' }).click();
    await newTabShown(first, 3);
    await open(first, find);
    await first.shell.getByRole('tab', { name: 'Fixture second' }).click();
    await expect.poll(async () => (await shellState(first.shell)).split).not.toBeNull();
    const divider = first.shell.getByRole('separator', { name: 'Divider of the split view' });
    await divider.focus();
    await first.shell.keyboard.press('Home');
    for (let step = 0; step < 3; step += 1) await first.shell.keyboard.press('ArrowRight');
    await expect
      .poll(async () => (await shellState(first.shell)).split?.ratio)
      .toBeCloseTo(0.35, 3);
  } finally {
    await first.close({ keepProfile: true });
  }
  const browser = await launch([], { profile });
  try {
    await expect.poll(async () => (await shellState(browser.shell)).tabs.length).toBe(3);
    const state = await shellState(browser.shell);
    expect(state.tabs.map((tab) => tab.split)).toEqual(['start', 'end', null]);
    expect(state.split?.start).toBe(state.tabs[0]?.id);
    expect(state.split?.end).toBe(state.tabs[1]?.id);
    expect(Math.abs((state.split?.ratio ?? 0) - 0.35)).toBeLessThan(0.001);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
    await expect
      .poll(async () => (await tabViews(browser)).map((view) => view.url))
      .toEqual([home, second]);
    const [left, right] = (await tabViews(browser)).map((view) => view.bounds);
    expect((left?.x ?? 0) + (left?.width ?? 0) + 8).toBe(right?.x);
    // Both sides load, and the other tab waits until it shows.
    await expect
      .poll(async () => (await fixturePages(browser)).toSorted())
      .toEqual([home, second].toSorted());
  } finally {
    await browser.close();
  }
});

test('searches the side with the focus, with the find bar above it', async () => {
  const browser = await launch();
  try {
    const find = fixture('find.html');
    const second = fixture('second.html');
    await splitWith(browser, find, second);
    await focusView(browser, find);
    await pressIn(browser, find, 'F', [mac ? 'meta' : 'control']);
    const field = browser.shell.getByRole('searchbox', { name: 'Find in page' });
    await expect(field).toBeFocused();
    await field.fill('apple');
    await expect(browser.shell.getByRole('search')).toContainText('of 3');
    const box = await field.boundingBox();
    const left = (await viewOf(browser, find))?.bounds;
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (left?.x ?? 0) + (left?.width ?? 0),
    );
    // The other side gets the focus, which closes the find bar.
    await focusView(browser, second);
    await expect.poll(async () => (await shellState(browser.shell)).find).toBeNull();
    await expect(field).toBeHidden();
    // A left side narrower than the find bar keeps the bar in the window, at its start, and
    // the shell and the pages keep the width of the window.
    const divider = browser.shell.getByRole('separator', { name: 'Divider of the split view' });
    await divider.focus();
    await browser.shell.keyboard.press('Home');
    await expect.poll(async () => (await shellState(browser.shell)).split?.ratio).toBe(0.2);
    const views = async (): Promise<{ x: number; width: number }[]> =>
      (await tabViews(browser)).map(({ bounds }) => ({ x: bounds.x, width: bounds.width }));
    await expect.poll(async () => (await viewOf(browser, find))?.bounds.width).toBeLessThan(300);
    const sides = await views();
    await focusView(browser, find);
    await pressIn(browser, find, 'F', [mac ? 'meta' : 'control']);
    await expect(field).toBeFocused();
    const width = await browser.shell.evaluate(() => window.innerWidth);
    const narrow = await field.boundingBox();
    expect(narrow?.x).toBeGreaterThanOrEqual(0);
    expect((narrow?.x ?? width) + (narrow?.width ?? 0)).toBeLessThanOrEqual(width);
    const menu = await browser.shell
      .getByRole('button', { name: 'Menu', exact: true })
      .boundingBox();
    expect((menu?.x ?? width) + (menu?.width ?? 0)).toBeLessThanOrEqual(width);
    await expect.poll(views).toEqual(sides);
    const start = (await viewOf(browser, find))?.bounds;
    await expect
      .poll(async () => (await divider.boundingBox())?.x)
      .toBe((start?.x ?? 0) + (start?.width ?? 0));
  } finally {
    await browser.close();
  }
});

test('asks for a permission over the side with the focus and refuses one of the other side without a question', async () => {
  const browser = await launch();
  try {
    const asks = fixture('permissions.html');
    const second = fixture('second.html');
    const { leftPage } = await splitWith(browser, asks, second);
    // The side without the focus gets nothing, and no question shows.
    expect(
      await leftPage.evaluate(() =>
        Promise.race([
          Notification.requestPermission(),
          new Promise((done) => setTimeout(() => done('asked'), 3000)),
        ]),
      ),
    ).toBe('denied');
    // The side with the focus asks, over its side.
    await focusView(browser, asks);
    const asked = leftPage.evaluate(() => Notification.requestPermission());
    const overlay = await waitForPage(browser, (url) => url.startsWith('app://overlay'));
    const question = overlay.getByRole('dialog', {
      name: `${new URL(server.origin).host} wants to`,
    });
    await expect(question).toBeVisible();
    const side = (await viewOf(browser, asks))?.bounds;
    const box = await question.boundingBox();
    const center = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    expect(center).toBeGreaterThanOrEqual(side?.x ?? 0);
    expect(center).toBeLessThanOrEqual((side?.x ?? 0) + (side?.width ?? 0));
    await question.getByRole('button', { name: 'Block' }).click();
    expect(await asked).toBe('denied');
    // The screen picker of the side with the focus shows over its side too.
    if (systemPicker) return;
    await leftPage.getByRole('button', { name: 'Share the screen' }).click();
    const picker = overlay.getByRole('dialog', {
      name: `Choose what ${new URL(server.origin).host} may see`,
    });
    await expect(picker).toBeVisible();
    expect(await overSide(picker, side)).toBe(true);
    await picker.getByRole('button', { name: 'Cancel' }).click();
    await expect(leftPage.locator('#result')).toHaveText('AbortError');
  } finally {
    await browser.close();
  }
});

test('asks for a sign-in over the side with the focus, and signs in there', async () => {
  const guarded = createServer((request, response) => {
    const expected = `Basic ${Buffer.from('tester:secret').toString('base64')}`;
    response.setHeader('Content-Type', 'text/html');
    if (request.headers.authorization === expected) {
      response.end('<!doctype html><title>Members</title><p>Signed in as tester</p>');
      return;
    }
    response.statusCode = 401;
    response.setHeader('WWW-Authenticate', 'Basic realm="Fixture members"');
    response.end('<!doctype html><title>Members</title><p>Not signed in</p>');
  });
  await new Promise<void>((done) => guarded.listen(0, '127.0.0.1', done));
  const { port } = guarded.address() as AddressInfo;
  const browser = await launch();
  try {
    const home = fixture('index.html');
    const second = fixture('second.html');
    await splitWith(browser, home, second);
    // The left side gets the focus and goes to a site that asks who is there.
    await focusView(browser, home);
    await expect(addressBar(browser)).toHaveValue(home);
    const side = (await viewOf(browser, home))?.bounds;
    const url = `http://127.0.0.1:${port}/members.html`;
    await addressBar(browser).fill(url);
    await addressBar(browser).press('Enter');
    const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
    const prompt = overlay.getByRole('dialog', { name: 'Sign in' });
    await expect(prompt).toBeVisible();
    expect(await overSide(prompt, side)).toBe(true);
    await prompt.getByRole('textbox', { name: 'User name' }).fill('tester');
    await prompt.getByLabel('Password').fill('secret');
    await prompt.getByRole('button', { name: 'Sign in' }).click();
    const page = await waitForPage(browser, (current) => current === url);
    await expect(page.getByText('Signed in as tester')).toBeVisible();
    expect((await viewOf(browser, url))?.bounds).toEqual(side);
  } finally {
    await browser.close();
    await new Promise<void>((done) => guarded.close(() => done()));
  }
});

test('turns split view off and on in the settings; off ends the split views that show', async () => {
  const browser = await launch([], { settings: { 'splitView.enabled': false } });
  try {
    // The shortcut reaches the page, and the browser opens nothing.
    const home = fixture('keys.html');
    const page = await open(browser, home);
    await focusView(browser, home);
    await pressSplit(browser, home);
    const pressed = [mac ? 'Cmd+S' : 'Ctrl+S'];
    await expect.poll(() => seen(page)).toEqual(pressed);
    await new Promise((done) => setTimeout(done, 500));
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    await recordMenus(browser);
    await tabMenu(browser, 'Fixture keys');
    const offered = (await recordedMenu(browser)).items.map((item) => item.replaceAll('&', ''));
    expect(offered).not.toContain(items.splitNew);
    expect(offered).not.toContain(items.splitWith);
    // The settings turn it on.
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await newTabShown(browser, 2);
    const settings = await open(browser, 'app://settings/#splitView.enabled');
    const toggle = settings.getByRole('switch', { name: /^Split view/ });
    await expect(toggle).not.toBeChecked();
    // The commands of split view have no shortcut while it is off.
    const keysOf = (command: string): Promise<string[]> =>
      settings.locator(`[data-command="${command}"]`).locator('kbd').allTextContents();
    await expect.poll(() => keysOf('tab.new')).toEqual([mac ? '⌘T' : 'Ctrl+T']);
    const row = settings.locator('[data-command="split.toggle"]');
    await expect(row).toContainText('No shortcut');
    expect(await keysOf('split.toggle')).toEqual([]);
    await toggle.check();
    await expect.poll(() => keysOf('split.toggle')).toEqual([mac ? '⌃⌘S' : 'Ctrl+Shift+S']);
    await expect(row).not.toContainText('No shortcut');
    await browser.shell.getByRole('tab', { name: 'Fixture keys' }).click();
    await expect.poll(async () => (await viewOf(browser, home))?.focused).toBe(true);
    await pressSplit(browser, home);
    await newTabShown(browser, 3);
    expect((await shellState(browser.shell)).split).not.toBeNull();
    // The browser takes the shortcut now, and the page gets it no more.
    expect(await seen(page)).toEqual(pressed);
    // Turned off from the settings, outside the pair, every split view ends.
    await browser.shell.getByRole('tab', { name: 'Settings' }).click();
    await toggle.uncheck();
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.split))
      .toEqual([null, null, null]);
  } finally {
    await browser.close();
  }
});

test('leaves the keys to the address bar of a new tab page in a window behind another, outside a split view', async () => {
  const browser = await launch();
  try {
    const home = fixture('index.html');
    await pressNative(browser, 'T', ['primary']);
    await newTabShown(browser, 2);
    await open(browser, home);
    await focusView(browser, home);
    const active = (): Promise<string | null> =>
      browser.shell.evaluate(
        () =>
          document
            .querySelector('app-shell')
            ?.shadowRoot?.activeElement?.getAttribute('aria-label') ?? null,
      );
    // The window goes behind another one, and nothing in the shell has the focus. Under Xvfb,
    // a window behind another may still have the focus for its pages, so the shell is told
    // that it has none.
    await browser.shell.evaluate(() => {
      const focused = document.querySelector('app-shell')?.shadowRoot?.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
      Reflect.set(document, 'hasFocus', () => false);
    });
    expect(await active()).toBeNull();
    // The page closes, and the new tab page beside it shows.
    await pressIn(browser, home, 'W', [mac ? 'meta' : 'control']);
    await newTabShown(browser, 1);
    await expect.poll(active).toBe('Address and search bar');
    // The window comes to the front, and what is typed goes to the address bar.
    await browser.shell.evaluate(() => {
      Reflect.deleteProperty(document, 'hasFocus');
    });
    await expect(addressBar(browser)).toBeFocused();
    await browser.shell.keyboard.type('typed here');
    await expect(addressBar(browser)).toHaveValue('typed here');
  } finally {
    await browser.close();
  }
});
