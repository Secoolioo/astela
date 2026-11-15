import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  chooseFromMenu,
  FixtureServer,
  launch,
  openBrowserMenu,
  pressNative,
  shellState,
  startAgain,
  tabViews,
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

/**
 * Clicks an item of the menu bar of macOS, as a person does with the mouse.
 * @param browser - The browser.
 * @param menu - The label of the menu, such as `File`.
 * @param item - The label of the item.
 */
async function clickMenuBar(browser: Browser, menu: string, item: string): Promise<void> {
  await browser.main.evaluate(
    ({ Menu }, labels) => {
      const top = Menu.getApplicationMenu()?.items.find((entry) => entry.label === labels.menu);
      const entry = top?.submenu?.items.find((candidate) => candidate.label === labels.item);
      if (entry === undefined) throw new Error(`${labels.menu} > ${labels.item} is missing`);
      entry.click();
    },
    { menu, item },
  );
}

test('opens one window from the menu bar of macOS when no window is open', async () => {
  test.skip(!mac, 'Only macOS keeps running without a window');
  const browser = await launch();
  try {
    // The menu bar of the browser replaces the one of Electron after the first window.
    await expect
      .poll(() =>
        browser.main.evaluate(
          ({ Menu }) =>
            Menu.getApplicationMenu()
              ?.items.find((entry) => entry.label === 'File')
              ?.submenu?.items.some((entry) => entry.label === 'New Window') ?? false,
        ),
      )
      .toBe(true);
    await browser.main.evaluate(({ BaseWindow }) => {
      for (const window of BaseWindow.getAllWindows()) window.close();
    });
    await expect.poll(() => windowCount(browser)).toBe(0);
    await clickMenuBar(browser, 'File', 'New Window');
    await expect.poll(() => windowCount(browser)).toBe(1);
    // A new tab in no window opens a window with its one tab.
    await browser.main.evaluate(({ BaseWindow }) => {
      for (const window of BaseWindow.getAllWindows()) window.close();
    });
    await expect.poll(() => windowCount(browser)).toBe(0);
    await clickMenuBar(browser, 'File', 'New Tab');
    await expect.poll(() => windowCount(browser)).toBe(1);
    // The new tab page needs a renderer of its own, whose start can take seconds on a busy machine.
    await expect
      .poll(
        () =>
          browser.main.evaluate(
            ({ webContents }) =>
              webContents
                .getAllWebContents()
                .filter((contents) => contents.getURL() === 'app://newtab/').length,
          ),
        { timeout: 15_000 },
      )
      .toBe(1);
  } finally {
    await browser.close();
  }
});

/** The shell of the window that the test opened after the first one. */
async function otherShell(browser: Browser): Promise<Page> {
  const find = (): Page | undefined =>
    browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().startsWith('app://shell') && page !== browser.shell);
  await expect.poll(() => find() !== undefined).toBe(true);
  const shell = find();
  if (shell === undefined) throw new Error('The other window has no shell');
  return shell;
}

function focusedWindow(browser: Browser): Promise<number | null> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()?.id ?? null);
}

test('leaves the focus in the window in use when a page in another window fails', async () => {
  // A site that answers with nothing a moment later, while the test uses the other window.
  const failing = createServer((request) => void setTimeout(() => request.socket.destroy(), 1000));
  await new Promise<void>((done) => failing.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${(failing.address() as AddressInfo).port}/`;
  const browser = await launch();
  try {
    const first = await focusedWindow(browser);
    await pressNative(browser, 'N', ['primary']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    const second = await otherShell(browser);
    const address = second.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(url);
    await address.press('Enter');
    await browser.main.evaluate(({ BaseWindow }, id) => BaseWindow.fromId(id ?? 0)?.focus(), first);
    await expect.poll(() => focusedWindow(browser)).toBe(first);
    await expect(second.getByRole('region', { name: "This page can't be reached" })).toBeVisible();
    expect(await focusedWindow(browser)).toBe(first);
  } finally {
    await browser.close();
    failing.closeAllConnections();
    await new Promise((done) => failing.close(done));
  }
});

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

test('keeps the tabs that a page opened after the page closed', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('link', { name: 'A link' }).click({ button: 'middle' });
    await opener.getByRole('button', { name: 'Open a tab' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(3);
    // Closing the page that opened them leaves the other tabs open.
    await browser.shell.getByRole('tab', { name: 'Fixture opener' }).click();
    await pressNative(browser, 'W', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url).toSorted())
      .toEqual([`${server.origin}/opened.html`, `${server.origin}/second.html`]);
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

test('keeps a popup that a page asks to be larger than the screen on the screen', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.evaluate(
      () => void window.open('/opened.html', '', 'popup,width=6000,height=6000,left=40,top=0'),
    );
    await expect.poll(() => windowCount(browser)).toBe(2);
    // The popup is the newer window.
    const fits = await browser.main.evaluate(({ BaseWindow, screen }) => {
      const popup = BaseWindow.getAllWindows().reduce((a, b) => (b.id > a.id ? b : a));
      const bounds = popup.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      return (
        bounds.x >= area.x &&
        bounds.y >= area.y &&
        bounds.x + bounds.width <= area.x + area.width &&
        bounds.y + bounds.height <= area.y + area.height
      );
    });
    expect(fits).toBe(true);
  } finally {
    await browser.close();
  }
});

test('opens links from other apps in a regular window, not in a popup', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    await expect.poll(() => windowCount(browser)).toBe(2);
    expect(await startAgain(browser, ['--', `${server.origin}/second.html`])).toBe(0);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/opener.html`, `${server.origin}/second.html`]);
  } finally {
    await browser.close();
  }
});

test('forgets a window that closed, also when its focus arrives after it closed', async () => {
  const browser = await launch();
  try {
    const first = await browser.main.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((window) => window.id),
    );
    await pressNative(browser, 'N', ['primary']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    // Both windows show their shell and their new tab page.
    await expect
      .poll(() =>
        browser.main.evaluate(
          ({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter(
                (contents) =>
                  ['app://shell/', 'app://newtab/'].includes(contents.getURL()) &&
                  !contents.isLoading(),
              ).length,
        ),
      )
      .toBe(4);
    // The new window closes. The focus that it got while it opened can reach it only after it
    // closed, as on macOS when a window closes right after it opened. A link from another app
    // that comes then opens in the window that is still open.
    const link = `${server.origin}/second.html`;
    await browser.main.evaluate(
      async ({ app, BaseWindow }, { ids, url }) => {
        const window = BaseWindow.getAllWindows().find((candidate) => !ids.includes(candidate.id));
        if (window === undefined) throw new Error('The new window is missing');
        await new Promise<void>((done) => {
          window.once('closed', () => done());
          window.close();
        });
        window.emit('focus');
        app.emit('second-instance', {}, [process.execPath, '--', url], process.cwd(), {});
      },
      { ids: first, url: link },
    );
    await expect.poll(() => windowCount(browser)).toBe(1);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual(['app://newtab/', link]);
  } finally {
    await browser.close();
  }
});

test('hides a window that closes right after it opened, and closes it a moment later', async () => {
  test.skip(process.platform !== 'linux', 'Only Electron on Linux crashes on such windows');
  const browser = await launch();
  try {
    const first = await browser.main.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows().map((window) => window.id),
    );
    for (let round = 0; round < 3; round++) {
      await pressNative(browser, 'N', ['primary']);
      await expect.poll(() => windowCount(browser)).toBe(2);
      // The new window closes at once: it hides and closes after its first second.
      const closed = await browser.main.evaluate(({ BaseWindow }, ids) => {
        const window = BaseWindow.getAllWindows().find((candidate) => !ids.includes(candidate.id));
        if (window === undefined) throw new Error('The new window is missing');
        window.close();
        const destroyed = window.isDestroyed();
        return { destroyed, visible: !destroyed && window.isVisible() };
      }, first);
      expect(closed).toEqual({ destroyed: false, visible: false });
      if (round === 0) {
        // A link from another app goes to the window that stays, not to the one that hides.
        const link = `${server.origin}/second.html`;
        await browser.main.evaluate(({ app }, url) => {
          app.emit('second-instance', {}, [process.execPath, '--', url], process.cwd(), {});
        }, link);
        await expect
          .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
          .toEqual(['app://newtab/', link]);
      }
      await expect.poll(() => windowCount(browser)).toBe(1);
    }
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
      const menu = await openBrowserMenu(browser);
      const newWindow = mac ? 'New Window' : 'New window';
      for (const name of mac
        ? [newWindow, 'Downloads', 'Find…', 'Print…', 'More Tools', 'Quit Astela']
        : [newWindow, 'Downloads', 'Find…', 'Print…', 'More tools']) {
        await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
      }
      await expect(menu.getByRole('group', { name: 'Zoom' })).toBeVisible();
      await chooseFromMenu(menu, [newWindow]);
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

/** Whether the first window is in full screen. */
function fullScreen(browser: Browser): Promise<boolean | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.isFullScreen());
}

/** Where the first window is. */
function firstBounds(browser: Browser): Promise<Electron.Rectangle | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getBounds());
}

/** Puts the window in full screen with its shortcut, or takes it out. */
function toggleFullScreen(browser: Browser): Promise<void> {
  return pressNative(browser, mac ? 'F' : 'F11', mac ? ['control', 'primary'] : []);
}

/** The address that the active tab of each window shows, in the order in which they opened. */
async function shownByWindow(browser: Browser): Promise<string[]> {
  const ids = await browser.main.evaluate(({ BaseWindow }) =>
    BaseWindow.getAllWindows()
      .map((window) => window.id)
      .toSorted((a, b) => a - b),
  );
  const views = await Promise.all(ids.map((id) => tabViews(browser, id)));
  return views.map((list) => list[0]?.url ?? '');
}

test('restores a window in full screen where it was', async () => {
  const browser = await launch();
  const { profile } = browser;
  const place = { x: 40, y: 60, width: 800, height: 500 };
  try {
    try {
      await browser.main.evaluate(({ BaseWindow }, wanted) => {
        BaseWindow.getAllWindows()[0]?.setBounds(wanted);
      }, place);
      await expect.poll(() => firstBounds(browser)).toEqual(place);
      // On macOS, full screen moves the window into a space of its own, with an animation.
      await toggleFullScreen(browser);
      await expect.poll(() => fullScreen(browser), { timeout: 15_000 }).toBe(true);
    } finally {
      await browser.close({ keepProfile: true });
    }
    const again = await launch([], { profile });
    try {
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(true);
      // Out of full screen, the window is where it was before.
      await toggleFullScreen(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(false);
      await expect.poll(() => firstBounds(again)).toEqual(place);
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('restores windows in the order they were used, the window used last at the end', async () => {
  const browser = await launch();
  const { profile } = browser;
  const home = `${server.origin}/index.html`;
  const second = `${server.origin}/second.html`;
  try {
    try {
      await open(browser, home);
      const firstId = await browser.main.evaluate(
        ({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.id ?? 0,
      );
      await pressNative(browser, 'N', ['primary'], server.origin);
      await expect.poll(() => windowCount(browser)).toBe(2);
      const other = await otherShell(browser);
      await expect(other.getByRole('tab')).toHaveCount(1);
      const address = other.getByRole('textbox', { name: 'Address and search bar' });
      await address.fill(second);
      await address.press('Enter');
      await waitForPage(browser, (url) => url === second);
      // The first window is used again, after the second one.
      await expect.poll(() => focusedWindow(browser)).not.toBe(firstId);
      await browser.main.evaluate(({ BaseWindow }, id) => {
        BaseWindow.fromId(id)?.focus();
      }, firstId);
      await expect.poll(() => focusedWindow(browser)).toBe(firstId);
      await expect
        .poll(() => {
          const file = join(profile, 'data', 'session.json');
          if (!existsSync(file)) return [];
          const session = JSON.parse(readFileSync(file, 'utf8')) as {
            windows: { tabs: { url: string }[] }[];
          };
          return session.windows.map((window) => window.tabs[0]?.url);
        })
        .toEqual([second, home]);
    } finally {
      await browser.close({ keepProfile: true });
    }
    // The window used last opens last, so it ends up in front of the other, with the focus.
    const again = await launch([], { profile });
    try {
      await expect.poll(() => shownByWindow(again)).toEqual([second, home]);
      const last = await again.main.evaluate(({ BaseWindow }) =>
        Math.max(...BaseWindow.getAllWindows().map((window) => window.id)),
      );
      // The focus stays there once the shells of both windows have loaded.
      await expect
        .poll(() =>
          again.main.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .filter((contents) => contents.getURL().startsWith('app://shell'))
              .map((contents) => contents.isLoading()),
          ),
        )
        .toEqual([false, false]);
      await expect.poll(() => focusedWindow(again)).toBe(last);
      await new Promise((done) => setTimeout(done, 1000));
      expect(await focusedWindow(again)).toBe(last);
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

/** When the session file was last written: each write puts a new file in its place. */
function writtenAt(profile: string): string {
  const { ino, mtimeMs } = statSync(join(profile, 'data', 'session.json'));
  return `${String(ino)}@${String(mtimeMs)}`;
}

/** Waits until the session file has not been written for longer than its delay of a second. */
async function settled(profile: string): Promise<string> {
  for (;;) {
    const before = existsSync(join(profile, 'data', 'session.json')) ? writtenAt(profile) : '';
    await new Promise((done) => setTimeout(done, 1500));
    if (before !== '' && writtenAt(profile) === before) return before;
  }
}

test('writes the session again for the focus of a regular window only when it changes their order', async () => {
  const browser = await launch();
  const { profile } = browser;
  try {
    await open(browser, `${server.origin}/index.html`);
    const regular = await focusedWindow(browser);
    await pressNative(browser, 'N', ['primary', 'shift']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    await expect.poll(() => focusedWindow(browser)).not.toBe(regular);
    const privateWindow = await focusedWindow(browser);
    const written = await settled(profile);
    // The session keeps no private window, so the focus that moves between the two changes
    // nothing that it keeps.
    for (const id of [regular, privateWindow, regular, privateWindow]) {
      await browser.main.evaluate(({ BaseWindow }, window) => {
        if (window !== null) BaseWindow.fromId(window)?.focus();
      }, id);
      await expect.poll(() => focusedWindow(browser)).toBe(id);
    }
    await new Promise((done) => setTimeout(done, 1500));
    expect(writtenAt(profile)).toBe(written);
  } finally {
    await browser.close();
  }
});
