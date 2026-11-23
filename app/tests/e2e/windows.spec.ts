import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  chooseFromMenu,
  FixtureServer,
  launch,
  openBrowserMenu,
  overlayAttached,
  overlayPage,
  pressNative,
  removeAfterExit,
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
    const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    await expect(popup).toHaveTitle('Fixture opened by a page');
    // The page gets the size that it asked for, as in other browsers; the window is larger by
    // its toolbar.
    await expect.poll(() => popup.evaluate(() => [innerWidth, innerHeight])).toEqual([520, 420]);
    await popup.getByRole('button', { name: 'Reply' }).click();
    await expect(opener.locator('#message')).toHaveText('Hello from the opened page');
    await popup.evaluate(() => void setTimeout(() => window.close(), 50));
    await expect.poll(() => windowCount(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('gives a popup the size it asks for when the tab strip is at a side', async () => {
  const browser = await launch([], { settings: { 'tabs.position': 'left' } });
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    await expect.poll(() => popup.evaluate(() => [innerWidth, innerHeight])).toEqual([520, 420]);
  } finally {
    await browser.close();
  }
});

test('shows a popup with its page and toolbar only, and an address that cannot be edited', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    const shell = await otherShell(browser);
    await expect(shell.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
    await expect(shell.getByRole('tablist')).toHaveCount(0);
    await expect(shell.getByRole('button', { name: 'New tab' })).toHaveCount(0);
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    await expect(address).toHaveValue(/127\.0\.0\.1:\d+\/opened\.html$/);
    await expect(address).not.toBeEditable();
    // The page keeps the size that it asked for.
    await expect.poll(() => popup.evaluate(() => [innerWidth, innerHeight])).toEqual([520, 420]);
  } finally {
    await browser.close();
  }
});

test('opens the new tab of a popup in the regular window', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    await expect(popup).toHaveTitle('Fixture opened by a page');
    const shell = await otherShell(browser);
    await pressNative(browser, 'T', ['primary'], popup.url());
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/opener.html`, 'app://newtab/']);
    expect((await shellState(shell)).tabs.map((tab) => tab.url)).toEqual([
      `${server.origin}/opened.html`,
    ]);
    expect(await windowCount(browser)).toBe(2);
  } finally {
    await browser.close();
  }
});

test('duplicates the tab of a popup in the regular window', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    await expect(popup).toHaveTitle('Fixture opened by a page');
    const shell = await otherShell(browser);
    // The command palette of the popup, in its own overlay.
    const others = browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url().startsWith('app://overlay'));
    await pressNative(browser, 'K', ['primary'], popup.url());
    const overlay = await overlayPage(browser, others);
    const palette = overlay.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('duplicate');
    await expect(palette.getByRole('option').first()).toHaveAccessibleName(/^Duplicate the tab/);
    await palette.getByRole('combobox').press('Enter');
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/opener.html`, `${server.origin}/opened.html`]);
    expect((await shellState(shell)).tabs.map((tab) => tab.url)).toEqual([
      `${server.origin}/opened.html`,
    ]);
    expect(await windowCount(browser)).toBe(2);
  } finally {
    await browser.close();
  }
});

test('opens the links of a popup in the regular window, which keeps them at the next start', async () => {
  const browser = await launch();
  const { profile } = browser;
  try {
    try {
      const opener = await open(browser, `${server.origin}/opener.html`);
      await opener.getByRole('button', { name: 'Open a popup' }).click();
      const popup = await waitForPage(browser, (url) => url.endsWith('/opened.html'));
      const shell = await otherShell(browser);
      await popup.getByRole('link', { name: 'A link in a new tab' }).click();
      await expect(browser.shell.getByRole('tab')).toHaveCount(2);
      await expect
        .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
        .toEqual([`${server.origin}/opener.html`, `${server.origin}/second.html`]);
      expect((await shellState(shell)).tabs).toHaveLength(1);
      await expect
        .poll(() => {
          const file = join(profile, 'data', 'session.json');
          if (!existsSync(file)) return [];
          const session = JSON.parse(readFileSync(file, 'utf8')) as {
            windows: { tabs: { url: string }[] }[];
          };
          return session.windows.map((window) => window.tabs.map((tab) => tab.url));
        })
        .toEqual([[`${server.origin}/opener.html`, `${server.origin}/second.html`]]);
    } finally {
      await browser.close({ keepProfile: true });
    }
    const again = await launch([], { profile });
    try {
      await expect
        .poll(async () => (await shellState(again.shell)).tabs.map((tab) => tab.url))
        .toEqual([`${server.origin}/opener.html`, `${server.origin}/second.html`]);
    } finally {
      await again.close();
    }
  } finally {
    removeAfterExit(profile);
  }
});

test('keeps a popup that a page asks to be larger than the screen on the screen', async () => {
  const browser = await launch();
  try {
    const opener = await open(browser, `${server.origin}/opener.html`);
    await opener.getByRole('button', { name: 'Open a large popup' }).click();
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

/** The addresses of the tabs of the first window and how many pop-ups each one blocked. */
async function blockedByTab(browser: Browser): Promise<[string, number][]> {
  return (await shellState(browser.shell)).tabs.map((tab) => [tab.url, tab.popups]);
}

/** The chip of the pop-up blocker in the address bar, by what it says. */
function popupChip(browser: Browser, name: string): Locator {
  return browser.shell.getByRole('button', { name, exact: true });
}

test('blocks the windows that a page opens without a click, and counts them in the address bar', async () => {
  const browser = await launch();
  try {
    // An inline script, the load event, a timer, a link and a form that scripts click and
    // submit, and a timer in a frame of another site.
    await open(browser, `${server.origin}/popunder.html`);
    await expect(popupChip(browser, 'Pop-ups blocked: 6')).toBeVisible({ timeout: 10_000 });
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    expect(await windowCount(browser)).toBe(1);
    // The count belongs to the page: another page starts without one.
    await open(browser, `${server.origin}/index.html`);
    await expect(browser.shell.getByRole('button', { name: /^Pop-ups? blocked/ })).toHaveCount(0);
    expect(await blockedByTab(browser)).toEqual([[`${server.origin}/index.html`, 0]]);
  } finally {
    await browser.close();
  }
});

test('lets one click open one window, and blocks the second one of the same click', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/popunder.html?ways=`;
    const page = await open(browser, url);
    await page.getByRole('button', { name: 'Open two' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    // The page's tab, now in the background, counts the second window.
    await expect
      .poll(() => blockedByTab(browser))
      .toEqual([
        [url, 1],
        [`${server.origin}/opened.html?first`, 0],
      ]);
    expect(await windowCount(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('blocks a window that a page opens long after the click', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/popunder.html?ways=`);
    await page.getByRole('button', { name: 'Open later' }).click();
    await expect(popupChip(browser, 'Pop-up blocked')).toBeVisible({ timeout: 15_000 });
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  } finally {
    await browser.close();
  }
});

test('lets a click in a frame of another site open one window, and blocks its timer', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/popunder.html?ways=frame`);
    await expect(popupChip(browser, 'Pop-up blocked')).toBeVisible({ timeout: 10_000 });
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    await page.frameLocator('#frame').getByRole('button', { name: 'Open from the frame' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await waitForPage(browser, (url) => url === `${server.origin}/opened.html?frame-click`);
  } finally {
    await browser.close();
  }
});

test('lets the page that a click led to in the same tab open no window by itself', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, `${server.origin}/popunder.html?ways=`);
    // The click on the link belongs to the page before; the next one opens its windows as it
    // loads.
    await page.getByRole('link', { name: 'The page with its pop-ups' }).click();
    const url = `${server.origin}/popunder.html?ways=inline,onload`;
    await expect(popupChip(browser, 'Pop-ups blocked: 2')).toBeVisible({ timeout: 10_000 });
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    expect(await blockedByTab(browser)).toEqual([[url, 2]]);
  } finally {
    await browser.close();
  }
});

test('gives a page no input to open a window with for the modifier key of a shortcut', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/popunder.html?ways=timer&delay=3000`;
    await open(browser, url);
    // The address bar's shortcut as people press it: the modifier first, which no shortcut
    // takes, then L, which the window takes.
    await pressNative(browser, process.platform === 'darwin' ? 'Meta' : 'Control', [], url);
    await pressNative(browser, 'L', ['primary'], url);
    await expect(
      browser.shell.getByRole('textbox', { name: 'Address and search bar' }),
    ).toBeFocused();
    await expect(popupChip(browser, 'Pop-up blocked')).toBeVisible({ timeout: 10_000 });
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    expect(await windowCount(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('lets a click that only the page sees open one window, as a screen reader clicks', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/popunder.html?ways=`;
    const page = await open(browser, url);
    // Playwright runs the script with an activation of the page, as an action of a screen reader
    // gives one, without an input event of the browser process; the button gets a click.
    await page.evaluate(() => document.getElementById('two')?.click());
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    // The click opens its first window only.
    await expect
      .poll(() => blockedByTab(browser))
      .toEqual([
        [url, 1],
        [`${server.origin}/opened.html?first`, 0],
      ]);
    expect(await windowCount(browser)).toBe(1);
  } finally {
    await browser.close();
  }
});

test('counts a blocked pop-up whose address is too long to list, and offers to allow its site', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/popunder.html?ways=long`;
    await open(browser, url);
    await expect(popupChip(browser, 'Pop-up blocked')).toBeVisible();
    await popupChip(browser, 'Pop-up blocked').click();
    const overlay = await overlayPage(browser);
    const popover = overlay.getByRole('dialog', { name: 'Pop-ups blocked on this page' });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(
      'The page tried to open windows without a click. Their addresses are too long to list here.',
    );
    await expect(popover.getByRole('listitem')).toHaveCount(0);
    const site = new URL(server.origin).host;
    await expect(
      popover.getByRole('button', { name: `Always allow pop-ups from ${site}` }),
    ).toBeVisible();
  } finally {
    await browser.close();
  }
});

test('opens a blocked pop-up in a tab from the popover of its chip', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/popunder.html?ways=onload`;
    await open(browser, url);
    await expect(popupChip(browser, 'Pop-up blocked')).toBeVisible();
    await popupChip(browser, 'Pop-up blocked').click();
    const overlay = await overlayPage(browser);
    const popover = overlay.getByRole('dialog', { name: 'Pop-ups blocked on this page' });
    await expect(popover).toBeVisible();
    const blocked = `${server.origin}/opened.html?onload`;
    await expect(popover.getByRole('listitem')).toHaveText([`${blocked} Open`]);
    await popover.getByRole('button', { name: `Open ${blocked}` }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await waitForPage(browser, (current) => current === blocked);
    // What opened is no longer blocked.
    await expect
      .poll(() => blockedByTab(browser))
      .toEqual([
        [url, 0],
        [blocked, 0],
      ]);
  } finally {
    await browser.close();
  }
});

test('lets a site open pop-ups without a click once people always allow it', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/popunder.html?ways=onload`;
    await open(browser, url);
    await expect(popupChip(browser, 'Pop-up blocked')).toBeVisible();
    await popupChip(browser, 'Pop-up blocked').click();
    const overlay = await overlayPage(browser);
    const site = new URL(server.origin).host;
    await overlay.getByRole('button', { name: `Always allow pop-ups from ${site}` }).click();
    await expect(overlay.getByRole('status')).toHaveText(
      `Pop-ups from ${site} are allowed. They open the next time the page opens them.`,
    );
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // The settings keep the decision for the site, and the page's next load opens its window.
    const saved = (): unknown => {
      try {
        const file = readFileSync(join(browser.profile, 'data', 'settings.json'), 'utf8');
        return (JSON.parse(file) as { user?: Record<string, unknown> }).user?.['permissions.sites'];
      } catch {
        return undefined;
      }
    };
    await expect.poll(saved).toEqual({ [server.origin]: { popups: 'allow' } });
    await browser.shell.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await waitForPage(browser, (current) => current === `${server.origin}/opened.html?onload`);
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
    removeAfterExit(profile);
  }
});

/** Whether the first window is in full screen. */
function fullScreen(browser: Browser): Promise<boolean | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.isFullScreen());
}

/** Whether the first window is maximized. */
function maximized(browser: Browser): Promise<boolean | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.isMaximized());
}

/** Where the first window is. */
function firstBounds(browser: Browser): Promise<Electron.Rectangle | undefined> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getBounds());
}

/** The window other than the given one, in a browser with two windows. */
function otherWindow(browser: Browser, id: number): Promise<number> {
  return browser.main.evaluate(
    ({ BaseWindow }, first) =>
      BaseWindow.getAllWindows().find((window) => window.id !== first)?.id ?? 0,
    id,
  );
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

/*
 * On macOS, a window has the focus only while its app is in front, and the focus of a window
 * does not bring the app in front of another app: Electron asks macOS to activate the app
 * without taking it from the app in front. A click on a window, or on the icon of the app in
 * the Dock, brings the app to the front. On the macOS runner of CI, another app stays in front of
 * every browser that starts after permissions.spec.ts opened the picker of macOS for the screen,
 * which no test can answer.
 */

/**
 * Uses a window as a person does who clicks it, and waits until it has the focus.
 * @param browser - The browser.
 * @param id - The window.
 * @returns The window that has the focus then.
 */
function useWindow(browser: Browser, id: number): Promise<number | null> {
  return browser.main.evaluate(
    ({ app, BaseWindow }, wanted) =>
      new Promise<number | null>((done) => {
        const focused = (): number | null => BaseWindow.getFocusedWindow()?.id ?? null;
        const window = BaseWindow.fromId(wanted);
        if (window === null || window.isFocused()) {
          done(focused());
          return;
        }
        const timer = setTimeout(() => {
          window.off('focus', got);
          done(focused());
        }, 1000);
        function got(): void {
          clearTimeout(timer);
          done(focused());
        }
        window.once('focus', got);
        if (process.platform === 'darwin' && focused() === null) app.focus({ steal: true });
        window.focus();
      }),
    id,
  );
}

/**
 * The window that has the focus while the browser is in front: on macOS, when another app is in
 * front, the browser comes to the front as with a click on its icon in the Dock, which gives the
 * focus to the window that had it last.
 */
function focusedInFront(browser: Browser): Promise<number | null> {
  return browser.main.evaluate(
    ({ app, BaseWindow }) =>
      new Promise<number | null>((done) => {
        const focused = (): number | null => BaseWindow.getFocusedWindow()?.id ?? null;
        if (process.platform !== 'darwin' || focused() !== null) {
          done(focused());
          return;
        }
        const windows = BaseWindow.getAllWindows();
        const timer = setTimeout(() => finish(), 1000);
        function finish(): void {
          clearTimeout(timer);
          for (const window of windows) window.off('focus', finish);
          done(focused());
        }
        for (const window of windows) window.once('focus', finish);
        app.focus({ steal: true });
      }),
  );
}

/**
 * Puts the first window in full screen as the green button of macOS does: macOS itself does
 * it, without Electron's setFullScreen() and without the browser's command. Its action goes to
 * the window in use, so the browser first comes to the front, as with a click on the window,
 * when another app is in front. As with a click, the button acts in an event of its own once
 * the window has the focus, not within the report of macOS that the window got the focus:
 * Electron itself never asks AppKit for full screen from within such a report.
 * @returns Whether macOS has started to move the window into full screen, after at most 15 s.
 *   macOS marks the window as in full screen as its animation starts; Electron reports
 *   'enter-full-screen' only once the animation has ended.
 */
function fullScreenFromSystem(browser: Browser): Promise<boolean> {
  return browser.main.evaluate(({ app, BaseWindow, Menu }) => {
    const press = (): void => {
      setTimeout(() => Menu.sendActionToFirstResponder('toggleFullScreen:'), 0);
    };
    return new Promise<boolean>((done) => {
      const found = BaseWindow.getAllWindows()[0];
      if (found === undefined || found.isFullScreen()) {
        done(found !== undefined);
        return;
      }
      const window: Electron.BaseWindow = found;
      const started = Date.now();
      const check = setInterval(() => {
        const on = !window.isDestroyed() && window.isFullScreen();
        if (!on && Date.now() - started < 15_000) return;
        clearInterval(check);
        window.off('focus', press);
        done(on);
      }, 10);
      if (window.isFocused()) {
        press();
        return;
      }
      window.once('focus', press);
      if (BaseWindow.getFocusedWindow() === null) app.focus({ steal: true });
      window.focus();
    });
  });
}

/** Where the first window is, and whether it is maximized or in full screen. */
function firstPlace(browser: Browser): Promise<
  | {
      readonly bounds: Electron.Rectangle;
      readonly normal: Electron.Rectangle;
      readonly maximized: boolean;
      readonly fullScreen: boolean;
    }
  | undefined
> {
  return browser.main.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0];
    return window === undefined
      ? undefined
      : {
          bounds: window.getBounds(),
          normal: window.getNormalBounds(),
          maximized: window.isMaximized(),
          fullScreen: window.isFullScreen(),
        };
  });
}

/** What a test notes of the first window, in milliseconds since the browser started. */
interface PlaceNote {
  readonly event: string;
  readonly at: number;
  readonly bounds?: Electron.Rectangle;
  readonly normal?: Electron.Rectangle;
  readonly maximized?: boolean;
  readonly fullScreen?: boolean;
  readonly workArea?: Electron.Rectangle;
}

/**
 * Notes from now on what happens to the first window, with where it is then: each change of
 * its place, of being maximized and of full screen, and the start of the quit. The browser
 * prints the notes as it starts to quit, and the test attaches them, so that they show what
 * macOS did, also when the test fails. A test notes more with `notePlace` in the browser.
 * @returns The notes of the browser, once it started to quit.
 */
async function notePlaces(browser: Browser): Promise<() => readonly PlaceNote[]> {
  let printed = '';
  browser.process.stderr?.on('data', (chunk: Buffer) => {
    printed += chunk.toString();
  });
  await browser.main.evaluate(({ app, BaseWindow, screen }) => {
    const window = BaseWindow.getAllWindows()[0];
    if (window === undefined) return;
    const notes: unknown[] = [
      {
        event: 'work area',
        at: Math.round(performance.now()),
        workArea: screen.getDisplayMatching(window.getBounds()).workArea,
      },
    ];
    const note = (event: string): void => {
      notes.push(
        window.isDestroyed()
          ? { event, at: Math.round(performance.now()) }
          : {
              event,
              at: Math.round(performance.now()),
              bounds: window.getBounds(),
              normal: window.getNormalBounds(),
              maximized: window.isMaximized(),
              fullScreen: window.isFullScreen(),
            },
      );
    };
    Reflect.set(globalThis, 'notePlace', note);
    note('noted from now on');
    window.on('move', () => note('move'));
    window.on('resize', () => note('resize'));
    window.on('maximize', () => note('maximize'));
    window.on('unmaximize', () => note('unmaximize'));
    window.on('enter-full-screen', () => note('enter-full-screen'));
    window.on('leave-full-screen', () => note('leave-full-screen'));
    app.once('before-quit', () => {
      note('before-quit');
      process.stderr.write(`Window places: ${JSON.stringify(notes)}\n`);
    });
  });
  return () => {
    const line = /^Window places: (.*)$/m.exec(printed)?.[1];
    return line === undefined ? [] : (JSON.parse(line) as PlaceNote[]);
  };
}

/** Notes of a start of the browser that noted nothing. */
const noNotes = (): readonly PlaceNote[] => [];

/**
 * Quits the browser and attaches the notes that it printed as it quit to the test, in a file
 * in the folder of the test, which CI keeps, as for the record of the browser.
 */
async function closeNoting(
  browser: Browser,
  name: string,
  notes: () => readonly PlaceNote[],
  options?: { readonly keepProfile?: boolean },
): Promise<void> {
  try {
    await browser.close(options);
  } finally {
    const file = test.info().outputPath(`${name.replaceAll(/\W+/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(notes(), null, 1));
    await test.info().attach(name, { path: file, contentType: 'application/json' });
  }
}

/** What the session that the browser wrote last keeps of the first window. */
function keptWindow(profile: string): unknown {
  const session = JSON.parse(readFileSync(join(profile, 'data', 'session.json'), 'utf8')) as {
    windows: unknown[];
  };
  return session.windows[0];
}

test('restores a window in full screen where it was', async () => {
  const browser = await launch();
  const { profile } = browser;
  const place = { x: 40, y: 60, width: 800, height: 500 };
  let first = noNotes;
  let second = noNotes;
  try {
    try {
      first = await notePlaces(browser);
      await browser.main.evaluate(({ BaseWindow }, wanted) => {
        BaseWindow.getAllWindows()[0]?.setBounds(wanted);
      }, place);
      await expect.poll(() => firstBounds(browser)).toEqual(place);
      // On macOS, full screen moves the window into a space of its own, with an animation.
      await toggleFullScreen(browser);
      await expect.poll(() => fullScreen(browser), { timeout: 15_000 }).toBe(true);
    } finally {
      await closeNoting(browser, 'window places, first start', first, { keepProfile: true });
    }
    const again = await launch([], { profile });
    try {
      second = await notePlaces(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(true);
      // Out of full screen, the window is where it was before.
      await toggleFullScreen(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(false);
      await expect.poll(() => firstBounds(again)).toEqual(place);
    } finally {
      await closeNoting(again, 'window places, second start', second);
    }
  } finally {
    removeAfterExit(profile);
  }
});

test('restores a maximized window in full screen, and maximized once it leaves full screen', async () => {
  test.skip(
    process.platform === 'linux',
    'Under Xvfb, as on CI, no window manager runs that would maximize a window',
  );
  const browser = await launch();
  const { profile } = browser;
  let first = noNotes;
  let second = noNotes;
  try {
    try {
      first = await notePlaces(browser);
      await browser.main.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.maximize();
        // Whether Electron reported the end of the zoom before maximize() returned.
        (Reflect.get(globalThis, 'notePlace') as ((event: string) => void) | undefined)?.(
          'maximize() returned',
        );
      });
      await expect.poll(() => maximized(browser)).toBe(true);
      await toggleFullScreen(browser);
      await expect.poll(() => fullScreen(browser), { timeout: 15_000 }).toBe(true);
    } finally {
      await closeNoting(browser, 'window places, first start', first, { keepProfile: true });
    }
    expect(keptWindow(profile)).toMatchObject({ maximized: true, fullScreen: true });
    const again = await launch([], { profile });
    try {
      second = await notePlaces(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(true);
      // Out of full screen, the window is maximized again, as it was before. macOS marks the
      // window as out of full screen as its animation starts, and the window is maximized
      // again, where macOS does not do it, once the animation has ended. The place that a
      // maximized window would go back to says nothing here on macOS: Electron gives the frame
      // that it set last, which macOS fits into the screen each time it is set, so it changes
      // with the size of the screen of the machine.
      await toggleFullScreen(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(false);
      await expect
        .poll(() => firstPlace(again), { timeout: 15_000 })
        .toMatchObject({ maximized: true, fullScreen: false });
    } finally {
      await closeNoting(again, 'window places, second start', second);
    }
  } finally {
    removeAfterExit(profile);
  }
});

test('restores a window that the green button of macOS put in full screen where people moved it', async () => {
  test.skip(!mac, 'Only macOS puts a window in full screen itself, from its green button');
  const browser = await launch();
  const { profile } = browser;
  const place = { x: 40, y: 60, width: 800, height: 500 };
  let moved: Electron.Rectangle | undefined;
  let first = noNotes;
  let second = noNotes;
  try {
    try {
      first = await notePlaces(browser);
      await browser.main.evaluate(({ BaseWindow }, wanted) => {
        BaseWindow.getAllWindows()[0]?.setBounds(wanted);
      }, place);
      await expect.poll(() => firstBounds(browser)).toEqual(place);
      // Then people move the window. center() moves it as a drag does: Electron takes note of
      // the place that setBounds() gives, but not of this one.
      await browser.main.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.center();
      });
      moved = await firstBounds(browser);
      expect(moved).not.toEqual(place);
      // The browser quits right after macOS started to move the window into full screen, which
      // can be before the animation ended: the window counts as in full screen from its start.
      expect(await fullScreenFromSystem(browser)).toBe(true);
      await expect.poll(() => fullScreen(browser), { timeout: 15_000 }).toBe(true);
    } finally {
      await closeNoting(browser, 'window places, first start', first, { keepProfile: true });
    }
    // Whether this run quit during the animation, where only the window's own mark of macOS
    // tells that it is in full screen, depends on how long the animation takes on the machine.
    const reported = first().some((note) => note.event === 'enter-full-screen');
    test.info().annotations.push({
      type: 'Quit',
      description: reported
        ? 'Electron had reported the full screen when the browser started to quit'
        : 'The browser started to quit while macOS moved the window into full screen',
    });
    expect(keptWindow(profile)).toMatchObject({ bounds: moved, fullScreen: true });
    const again = await launch([], { profile });
    try {
      second = await notePlaces(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(true);
      // Out of full screen, the window is where people moved it.
      await toggleFullScreen(again);
      await expect.poll(() => fullScreen(again), { timeout: 15_000 }).toBe(false);
      await expect.poll(() => firstBounds(again)).toEqual(moved);
    } finally {
      await closeNoting(again, 'window places, second start', second);
    }
  } finally {
    removeAfterExit(profile);
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
      // People press the shortcut in the window that they use, with the browser in front, so
      // the new window has the focus as it opens. A browser that started behind another app
      // and never came to the front leaves it to macOS which window, if any, gets the focus
      // once the browser comes to the front.
      await expect.poll(() => useWindow(browser, firstId)).toBe(firstId);
      await pressNative(browser, 'N', ['primary'], server.origin);
      await expect.poll(() => windowCount(browser)).toBe(2);
      const other = await otherShell(browser);
      await expect(other.getByRole('tab')).toHaveCount(1);
      const address = other.getByRole('textbox', { name: 'Address and search bar' });
      await address.fill(second);
      await address.press('Enter');
      await waitForPage(browser, (url) => url === second);
      // The second window, which opened last, is the one in use; then the first window is used
      // again, after it.
      const secondId = await otherWindow(browser, firstId);
      await expect.poll(() => focusedInFront(browser)).toBe(secondId);
      await expect.poll(() => useWindow(browser, firstId)).toBe(firstId);
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
      await expect.poll(() => focusedInFront(again)).toBe(last);
      await new Promise((done) => setTimeout(done, 1000));
      expect(await focusedInFront(again)).toBe(last);
    } finally {
      await again.close();
    }
  } finally {
    removeAfterExit(profile);
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
    const regular = await browser.main.evaluate(
      ({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.id ?? 0,
    );
    // People press the shortcut in the window that they use, so the private window has the
    // focus as it opens, also when the browser started behind another app (see :821).
    await expect.poll(() => useWindow(browser, regular)).toBe(regular);
    await pressNative(browser, 'N', ['primary', 'shift']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    const privateWindow = await otherWindow(browser, regular);
    // The private window has the focus once it opened.
    await expect.poll(() => focusedInFront(browser)).toBe(privateWindow);
    const written = await settled(profile);
    // The session keeps no private window, so the focus that moves between the two changes
    // nothing that it keeps.
    for (const id of [regular, privateWindow, regular, privateWindow]) {
      await expect.poll(() => useWindow(browser, id)).toBe(id);
    }
    await new Promise((done) => setTimeout(done, 1500));
    expect(writtenAt(profile)).toBe(written);
  } finally {
    await browser.close();
  }
});
