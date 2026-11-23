import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import {
  FixtureServer,
  launch,
  pressNative,
  removeAfterExit,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';

/** The address, and whether Back and Forward go anywhere, of each tab of the first window. */
async function moves(browser: Browser): Promise<[string, boolean, boolean][]> {
  return (await shellState(browser.shell)).tabs.map((tab) => [
    tab.url,
    tab.canGoBack,
    tab.canGoForward,
  ]);
}

/** The addresses of the web pages that have a view, which only tabs that loaded have. */
function loadedPages(browser: Browser): Promise<string[]> {
  return browser.main.evaluate(
    ({ webContents }, origin) =>
      webContents
        .getAllWebContents()
        .map((contents) => contents.getURL())
        .filter((url) => url.startsWith(origin))
        .toSorted(),
    server.origin,
  );
}

/**
 * Whether the view of an address has loaded its page: a tab that wakes, or a view that
 * restores its history, loads from the moment it has its entries.
 */
function hasLoaded(browser: Browser, url: string): Promise<boolean> {
  return browser.main.evaluate(
    ({ webContents }, address) =>
      webContents
        .getAllWebContents()
        .some((contents) => contents.getURL() === address && !contents.isLoading()),
    url,
  );
}

/** Opens an address in the active tab from the address bar. */
async function go(browser: Browser, url: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
}

/**
 * The session file of a profile as the browser last wrote it, or `undefined`.
 * @param name - The file, such as the backup `session.json.bak`.
 */
function sessionFile(profile: string, name = 'session.json'): SessionFile | undefined {
  const file = join(profile, 'data', name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SessionFile) : undefined;
}

interface SessionFile {
  readonly windows: readonly {
    readonly tabs: readonly {
      readonly url: string;
      readonly title: string;
      readonly history?: { readonly views: readonly { readonly entries: readonly unknown[] }[] };
    }[];
  }[];
}

/** How many entries each view of each tab of a session file has. */
function entryCounts(profile: string, name?: string): (number[] | undefined)[] | undefined {
  return sessionFile(profile, name)?.windows.flatMap((window) =>
    window.tabs.map((tab) => tab.history?.views.map((view) => view.entries.length)),
  );
}

/** When the session file was last written: each write puts a new file in its place. */
function writtenAt(profile: string): string {
  const { ino, mtimeMs } = statSync(join(profile, 'data', 'session.json'));
  return `${String(ino)}@${String(mtimeMs)}`;
}

/** The page state of the entry that the view of an address shows, which Chromium keeps. */
function pageStateOf(browser: Browser, url: string): Promise<string | undefined> {
  return browser.main.evaluate(({ webContents }, address) => {
    const history = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL() === address)?.navigationHistory;
    return history?.getEntryAtIndex(history.getActiveIndex())?.pageState;
  }, url);
}

/** How often the history of a profile counts a visit of an address. */
function visitsOf(profile: string, url: string): number {
  const database = new DatabaseSync(join(profile, 'data', 'profile.db'));
  try {
    const row = database.prepare('SELECT visit_count FROM places WHERE url = ?').get(url);
    return Number(row?.['visit_count'] ?? 0);
  } finally {
    database.close();
  }
}

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('restores the tabs of the last session and loads only the active one', async () => {
  const first = await launch();
  const address = first.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${server.origin}/index.html`);
  await address.press('Enter');
  await waitForPage(first, (url) => url.endsWith('/index.html'));
  await pressNative(first, 'T', ['primary']);
  await address.fill(`${server.origin}/second.html`);
  await address.press('Enter');
  await waitForPage(first, (url) => url.endsWith('/second.html'));
  await first.close({ keepProfile: true });

  const second = await launch([], { profile: first.profile });
  try {
    const state = await shellState(second.shell);
    expect(state.tabs.map((tab) => [tab.url, tab.title])).toEqual([
      [`${server.origin}/index.html`, 'Fixture home'],
      [`${server.origin}/second.html`, 'Fixture second'],
    ]);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
    const loaded = (): Promise<number> =>
      second.main.evaluate(
        ({ webContents }, origin) =>
          webContents.getAllWebContents().filter((c) => c.getURL().startsWith(origin)).length,
        server.origin,
      );
    await expect.poll(loaded).toBe(1);
    await second.shell.getByRole('tab', { name: 'Fixture home' }).click();
    await expect.poll(loaded).toBe(2);
  } finally {
    await second.close();
  }
});

test('restores a tab whose pinned flag in the session is broken, as a tab that is not pinned', async () => {
  // Each optional field of a stored tab is read on its own, so a broken one costs only itself.
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  mkdirSync(join(profile, 'data'), { recursive: true });
  writeFileSync(
    join(profile, 'data', 'session.json'),
    JSON.stringify({
      version: 1,
      windows: [
        {
          tabs: [
            { url: `${server.origin}/index.html`, title: 'Fixture home', pinned: 'yes' },
            { url: `${server.origin}/second.html`, title: 'Fixture second', pinned: true },
            { url: `${server.origin}/opened.html`, title: 'Fixture opened' },
          ],
          active: 2,
        },
      ],
    }),
  );
  const browser = await launch([], { profile });
  try {
    const state = await shellState(browser.shell);
    expect(state.tabs.map((tab) => [tab.url, tab.pinned])).toEqual([
      [`${server.origin}/second.html`, true],
      [`${server.origin}/index.html`, false],
      [`${server.origin}/opened.html`, false],
    ]);
    expect(state.activeTabId).toBe(state.tabs[2]?.id);
  } finally {
    await browser.close();
  }
});

test('opens a new tab page instead when the setting says so', async () => {
  const first = await launch();
  const address = first.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${server.origin}/index.html`);
  await address.press('Enter');
  await waitForPage(first, (url) => url.endsWith('/index.html'));
  await first.close({ keepProfile: true });
  const second = await launch([], {
    profile: first.profile,
    settings: { 'startup.page': 'newtab' },
  });
  try {
    expect((await shellState(second.shell)).tabs.map((tab) => tab.url)).toEqual(['app://newtab/']);
  } finally {
    await second.close();
  }
});

test('opens the pages of the settings at start, and loads only the first', async () => {
  const pages = [`${server.origin}/index.html`, `${server.origin}/second.html`];
  const browser = await launch([], {
    settings: { 'startup.page': 'pages', 'startup.urls': pages },
  });
  try {
    const state = await shellState(browser.shell);
    expect(state.tabs.map((tab) => tab.url)).toEqual(pages);
    expect(state.activeTabId).toBe(state.tabs[0]?.id);
    const loaded = (): Promise<number> =>
      browser.main.evaluate(
        ({ webContents }, origin) =>
          webContents.getAllWebContents().filter((c) => c.getURL().startsWith(origin)).length,
        server.origin,
      );
    await expect.poll(loaded).toBe(1);
  } finally {
    await browser.close();
  }
});

test('opens the home page from the home button and its shortcut, which are off by default', async () => {
  const plain = await launch();
  try {
    await expect(plain.shell.getByRole('button', { name: 'Home' })).toHaveCount(0);
  } finally {
    await plain.close();
  }
  const browser = await launch([], {
    settings: { 'home.button': true, 'home.page': `${server.origin}/second.html` },
  });
  try {
    await browser.shell.getByRole('button', { name: 'Home' }).click();
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    if (process.platform === 'darwin') await pressNative(browser, 'H', ['primary', 'shift']);
    else await pressNative(browser, 'Home', ['alt']);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/second.html`]);
  } finally {
    await browser.close();
  }
});

test("restores each tab with its back and forward history after a restart, also across the browser's own pages", async () => {
  const home = `${server.origin}/index.html`;
  const second = `${server.origin}/second.html`;
  const opened = `${server.origin}/opened.html`;
  const first = await launch();
  try {
    // Tab A: the new tab page, a page, the page of its link, and Back, so that A can go back
    // and forward.
    await go(first, home);
    const page = await waitForPage(first, (url) => url === home);
    await page.click('#second');
    await expect.poll(() => moves(first)).toEqual([[second, true, false]]);
    await first.shell.getByRole('button', { name: 'Back' }).click();
    await expect.poll(() => moves(first)).toEqual([[home, true, true]]);
    // Tab B: the new tab page, the history page and a web page, each in a view of its own.
    await pressNative(first, 'T', ['primary']);
    await expect(first.shell.getByRole('tab')).toHaveCount(2);
    await pressNative(first, mac ? 'Y' : 'H', ['primary']);
    await expect.poll(async () => (await moves(first))[1]).toEqual(['app://history/', true, false]);
    await go(first, opened);
    await expect
      .poll(() => moves(first))
      .toEqual([
        [home, true, true],
        [opened, true, false],
      ]);
  } finally {
    await first.close({ keepProfile: true });
  }
  // Tab A opened the page, and came back to it; tab B opened its page once.
  const visited = visitsOf(first.profile, home);
  expect(visited).toBe(2);
  expect(visitsOf(first.profile, opened)).toBe(1);

  const again = await launch([], { profile: first.profile });
  try {
    await expect
      .poll(() => moves(again))
      .toEqual([
        [home, true, true],
        [opened, true, false],
      ]);
    // Only the active tab loads.
    await expect.poll(() => loadedPages(again)).toEqual([opened]);
    // Back goes to the history page, whose handlers load with it, and to the new tab page.
    const back = again.shell.getByRole('button', { name: 'Back' });
    const forward = again.shell.getByRole('button', { name: 'Forward' });
    await back.click();
    const history = await waitForPage(again, (url) => url.startsWith('app://history'));
    await expect(history.getByRole('button', { name: /^Fixture opened/ })).toBeVisible();
    await expect.poll(async () => (await moves(again))[1]).toEqual(['app://history/', true, true]);
    await back.click();
    await expect.poll(async () => (await moves(again))[1]).toEqual(['app://newtab/', false, true]);
    await forward.click();
    await expect.poll(async () => (await moves(again))[1]).toEqual(['app://history/', true, true]);
    await forward.click();
    await expect.poll(async () => (await moves(again))[1]).toEqual([opened, true, false]);
    // Tab A loads once it shows, at the page it showed, and can go forward to the next one.
    // Its back and forward buttons show the restored history before the page is back, so the
    // test waits for the page itself, as a person does before going on.
    await again.shell.getByRole('tab', { name: 'Fixture home' }).click();
    await expect.poll(() => loadedPages(again)).toEqual([home, opened]);
    await waitForPage(again, (url) => url === home);
    await expect.poll(() => hasLoaded(again, home)).toBe(true);
    await expect.poll(async () => (await moves(again))[0]).toEqual([home, true, true]);
    await forward.click();
    await expect.poll(async () => (await moves(again))[0]).toEqual([second, true, false]);
    await waitForPage(again, (url) => url === second);
    // The page that tab A showed again when it woke is no new visit; Forward is one, and the
    // history records the visits in their order.
    await expect.poll(() => visitsOf(again.profile, second)).toBe(2);
    expect(visitsOf(again.profile, home)).toBe(visited);
    // Nor is the page of tab B that the window showed at the start, before the code for web
    // pages had loaded; Forward to it from the history page is one.
    expect(visitsOf(again.profile, opened)).toBe(2);
  } finally {
    await again.close();
  }
});

test('brings back the scroll position and the form values of a restored page, and forgets the back and forward lists when the whole history is cleared', async () => {
  const home = `${server.origin}/index.html`;
  const second = `${server.origin}/second.html`;
  const long = `${server.origin}/long.html`;
  const first = await launch();
  try {
    await go(first, home);
    await waitForPage(first, (url) => url === home);
    await go(first, second);
    await waitForPage(first, (url) => url === second);
    await pressNative(first, 'T', ['primary']);
    await expect(first.shell.getByRole('tab')).toHaveCount(2);
    await go(first, home);
    await expect.poll(async () => (await moves(first))[1]).toEqual([home, true, false]);
    await go(first, long);
    const page = await waitForPage(first, (url) => url === long);
    await expect.poll(async () => (await moves(first))[1]).toEqual([long, true, false]);
    // Chromium keeps form values and the scroll position in the state of the page about a
    // second after each change.
    const pageState = (): Promise<string | undefined> => pageStateOf(first, long);
    const loaded = await pageState();
    await page.fill('#note', 'Kept across a restart');
    await expect.poll(pageState).not.toBe(loaded);
    const typed = await pageState();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(pageState).not.toBe(typed);
  } finally {
    await first.close({ keepProfile: true });
  }

  const again = await launch([], { profile: first.profile });
  try {
    const restored = await waitForPage(again, (url) => url === long);
    await expect.poll(() => restored.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(1400);
    await expect(restored.locator('#note')).toHaveValue('Kept across a restart');
    await expect
      .poll(() => moves(again))
      .toEqual([
        [second, true, false],
        [long, true, false],
      ]);
    // Clearing the whole history clears the back and forward lists of every tab and of the
    // session, also of a tab that did not load yet.
    await pressNative(again, 'T', ['primary']);
    await expect(again.shell.getByRole('tab')).toHaveCount(3);
    await go(again, 'app://settings');
    const settings = await waitForPage(again, (url) => url.startsWith('app://settings'));
    await settings.getByRole('button', { name: 'Clear…' }).click();
    const dialog = settings.getByRole('dialog', { name: 'Clear browsing data' });
    await dialog.getByRole('combobox', { name: 'Time range' }).selectOption('all');
    await dialog.getByRole('button', { name: 'Clear data' }).click();
    await expect(dialog).toBeHidden();
    // The dialog closes as the page asks the browser; the page says once the browser cleared
    // the data and wrote the session and its backup without the lists.
    await expect(settings.getByRole('status').filter({ hasText: 'cleared' })).toHaveText(
      'The browsing data is cleared.',
    );
    await expect
      .poll(() => moves(again))
      .toEqual([
        [second, false, false],
        [long, false, false],
        ['app://settings/', false, false],
      ]);
    // A later write of the session moves the file to the backup before it writes the new one.
    await expect.poll(() => entryCounts(again.profile)).toEqual([[1], [1], [1]]);
    // The backup of the session forgets them as well, which the next start reads when the
    // session file is broken.
    await expect
      .poll(() => entryCounts(again.profile, 'session.json.bak'))
      .toEqual([[1], [1], [1]]);
    await again.shell.getByRole('tab', { name: 'Fixture second' }).click();
    await waitForPage(again, (url) => url === second);
    await expect.poll(async () => (await moves(again))[0]).toEqual([second, false, false]);
  } finally {
    await again.close();
  }
});

test('restores the session after a crash, also when the browser otherwise starts with a new tab page', async () => {
  const home = `${server.origin}/index.html`;
  const second = `${server.origin}/second.html`;
  const first = await launch([], { settings: { 'startup.page': 'newtab' } });
  const { profile } = first;
  try {
    await go(first, home);
    await waitForPage(first, (url) => url === home);
    await pressNative(first, 'T', ['primary']);
    await expect(first.shell.getByRole('tab')).toHaveCount(2);
    await go(first, second);
    await waitForPage(first, (url) => url === second);
    // The session is written within a second, and the browser marks that it runs.
    await expect
      .poll(() =>
        sessionFile(profile)?.windows.flatMap((window) => window.tabs.map((tab) => tab.url)),
      )
      .toEqual([home, second]);
    expect(existsSync(join(profile, 'data', 'session.json.running'))).toBe(true);
  } finally {
    await first.crash();
  }

  const again = await launch([], { profile });
  try {
    await expect
      .poll(async () => (await shellState(again.shell)).tabs.map((tab) => tab.url))
      .toEqual([home, second]);
    await expect.poll(() => loadedPages(again)).toEqual([second]);
  } finally {
    await again.close({ keepProfile: true });
  }
  // After a normal quit, the start follows the setting again.
  expect(existsSync(join(profile, 'data', 'session.json.running'))).toBe(false);
  const clean = await launch([], { profile });
  try {
    expect((await shellState(clean.shell)).tabs.map((tab) => tab.url)).toEqual(['app://newtab/']);
  } finally {
    await clean.close();
  }
});

test('brings back the scroll position and the form values of a page after its last window was closed with its close button', async () => {
  const long = `${server.origin}/long.html`;
  const first = await launch();
  try {
    await go(first, long);
    const page = await waitForPage(first, (url) => url === long);
    await expect.poll(() => moves(first)).toEqual([[long, true, false]]);
    // The session is written once the page has loaded.
    await expect.poll(() => sessionFile(first.profile)?.windows[0]?.tabs[0]?.url).toBe(long);
    const pageState = (): Promise<string | undefined> => pageStateOf(first, long);
    const loaded = await pageState();
    await page.fill('#note', 'Kept when the window closed');
    await expect.poll(pageState).not.toBe(loaded);
    const typed = await pageState();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(pageState).not.toBe(typed);
  } finally {
    // On Windows and Linux, the browser quits with its last window.
    await first.close({ keepProfile: true, byWindows: true });
  }

  const again = await launch([], { profile: first.profile });
  try {
    const restored = await waitForPage(again, (url) => url === long);
    await expect.poll(() => restored.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(1400);
    await expect(restored.locator('#note')).toHaveValue('Kept when the window closed');
  } finally {
    await again.close();
  }
});

test('forgets the back and forward lists of a tab whose page still loads when the whole history is cleared', async () => {
  const home = `${server.origin}/index.html`;
  const opened = `${server.origin}/opened.html`;
  const browser = await launch();
  let release: (() => void) | undefined;
  try {
    await go(browser, home);
    await waitForPage(browser, (url) => url === home);
    await go(browser, opened);
    await waitForPage(browser, (url) => url === opened);
    await expect.poll(() => moves(browser)).toEqual([[opened, true, false]]);
    // Chromium keeps the entries of a tab while a load of one of them runs, such as a reload
    // whose answer does not come.
    const asked = (): number =>
      server.requests.filter((request) => request.path === '/opened.html').length;
    const before = asked();
    const held = server.hold('opened.html');
    release = held;
    await browser.shell.getByRole('button', { name: 'Reload' }).click();
    await expect.poll(asked).toBe(before + 1);
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await go(browser, 'app://settings');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('button', { name: 'Clear…' }).click();
    const dialog = settings.getByRole('dialog', { name: 'Clear browsing data' });
    await dialog.getByRole('combobox', { name: 'Time range' }).selectOption('all');
    await dialog.getByRole('button', { name: 'Clear data' }).click();
    await expect(dialog).toBeHidden();
    // The page says once the browser cleared the data and wrote the session.
    await expect(settings.getByRole('status').filter({ hasText: 'cleared' })).toHaveText(
      'The browsing data is cleared.',
    );
    await expect
      .poll(() => moves(browser))
      .toEqual([
        [opened, false, false],
        ['app://settings/', false, false],
      ]);
    await expect.poll(() => entryCounts(browser.profile)).toEqual([[1], [1]]);
    // Once the load ends, the entries are gone in Chromium too.
    held();
    await expect
      .poll(() =>
        browser.main.evaluate(({ webContents }, url) => {
          const contents = webContents.getAllWebContents().find((one) => one.getURL() === url);
          return contents === undefined
            ? undefined
            : [contents.isLoading(), contents.navigationHistory.length()];
        }, opened),
      )
      .toEqual([false, 1]);
    expect((await moves(browser))[0]).toEqual([opened, false, false]);
    await browser.shell.getByRole('tab', { name: 'Fixture opened' }).click();
    await expect.poll(async () => (await moves(browser))[0]).toEqual([opened, false, false]);
  } finally {
    release?.();
    await browser.close();
  }
});

test('writes the session for a page whose title changes all the time only now and then, and with its last title when the browser quits', async () => {
  const home = `${server.origin}/index.html`;
  const browser = await launch();
  const { profile } = browser;
  try {
    await go(browser, home);
    const page = await waitForPage(browser, (url) => url === home);
    // The title of the page can come after the write that its address started, on a slow
    // machine; then it waits as a new title alone does.
    await expect
      .poll(() => sessionFile(profile)?.windows[0]?.tabs[0]?.title, { timeout: 35_000 })
      .toBe('Fixture home');
    // A page that counts, as a timer does.
    await page.evaluate(() => {
      let count = 0;
      setInterval(() => {
        count += 1;
        document.title = `Tick ${String(count)}`;
      }, 200);
    });
    const title = async (): Promise<string | undefined> =>
      (await shellState(browser.shell)).tabs[0]?.title;
    await expect.poll(title).toMatch(/^Tick \d+$/);
    const written = writtenAt(profile);
    const shown = await title();
    // A change of titles alone waits 30 seconds, while the page changes its title 15 times.
    await page.waitForTimeout(3000);
    expect(await title()).not.toBe(shown);
    expect(writtenAt(profile)).toBe(written);
    expect(sessionFile(profile)?.windows[0]?.tabs[0]?.title).toBe('Fixture home');
  } finally {
    await browser.close({ keepProfile: true });
  }
  try {
    expect(sessionFile(profile)?.windows[0]?.tabs[0]?.title).toMatch(/^Tick \d+$/);
  } finally {
    removeAfterExit(profile);
  }
});

test("lets only the user read the browser's own files in the profile", async () => {
  test.skip(process.platform === 'win32', 'Windows keeps the rights of files apart from modes');
  // The usual umask, which gives others the right to read new files.
  const umask = process.umask(0o022);
  let browser: Browser;
  try {
    browser = await launch();
  } finally {
    process.umask(umask);
  }
  const { profile } = browser;
  const data = join(profile, 'data');
  const modeOf = (name: string): string => (statSync(join(data, name)).mode & 0o777).toString(8);
  const page = `${server.origin}/index.html?token=secret`;
  let wal = '';
  let running = '';
  let report = '';
  try {
    try {
      // The marker of a running browser, and the report of the self-test, which is no file of
      // the profile but one that its caller names and reads, maybe as another user.
      await expect.poll(() => existsSync(join(data, 'session.json.running'))).toBe(true);
      running = modeOf('session.json.running');
      report = (statSync(join(profile, 'ready.json')).mode & 0o777).toString(8);
      await go(browser, page);
      await waitForPage(browser, (url) => url === page);
      await expect.poll(() => visitsOf(profile, page)).toBe(1);
      // The session with the page is written before the next change, which keeps it as the
      // backup.
      await expect.poll(() => sessionFile(profile)?.windows[0]?.tabs[0]?.url).toBe(page);
      // A setting that changes is written to the settings file.
      await go(browser, 'app://settings/#appearance.theme');
      const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
      await settings.evaluate(() =>
        window.bridge.invoke('settings.set', { key: 'appearance.theme', value: 'ocean' }),
      );
      await expect.poll(() => existsSync(join(data, 'settings.json'))).toBe(true);
      // The write-ahead log of the history goes once the database closes.
      wal = modeOf('profile.db-wal');
    } finally {
      await browser.close({ keepProfile: true });
    }
    expect(
      Object.fromEntries([
        ['profile.db-wal', wal],
        ['session.json.running', running],
        ['ready.json', report],
        ...[
          'session.json',
          'session.json.bak',
          'profile.db',
          'settings.json',
          'policy-cache.json',
          'logs/main.log',
          'logs',
          'newtab',
          'import-temp',
        ].map((name) => [name, modeOf(name)]),
      ]),
    ).toEqual({
      'profile.db-wal': '600',
      'session.json.running': '600',
      'ready.json': '644',
      'session.json': '600',
      'session.json.bak': '600',
      'profile.db': '600',
      'settings.json': '600',
      'policy-cache.json': '600',
      'logs/main.log': '600',
      logs: '700',
      newtab: '700',
      'import-temp': '700',
    });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('takes the rights of others from the files that an older version left in the profile', async () => {
  test.skip(process.platform === 'win32', 'Windows keeps the rights of files apart from modes');
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  const data = join(profile, 'data');
  // An older version made its files and folders with the modes that the umask 022 gives.
  const older: Record<string, string> = {
    'settings.json': JSON.stringify({ $schemaVersion: 1, user: {} }),
    'policy-cache.json': '[]',
    'profile.db.v1.bak': 'copy of the history before a migration',
    'logs/main.log': '',
    'logs/main.1.log': '{"message":"https://example.com/?token=secret"}\n',
    'logs/main.2.log': '{"message":"older"}\n',
    'newtab/background-0123456789abcdef.png': 'image',
  };
  for (const folder of ['logs', 'newtab']) {
    mkdirSync(join(data, folder), { recursive: true });
    chmodSync(join(data, folder), 0o755);
  }
  for (const [name, content] of Object.entries(older)) {
    writeFileSync(join(data, name), content);
    chmodSync(join(data, name), 0o644);
  }
  const modes = (): Record<string, string> =>
    Object.fromEntries(
      [...Object.keys(older), 'logs', 'newtab'].map((name) => [
        name,
        (statSync(join(data, name)).mode & 0o777).toString(8),
      ]),
    );
  const umask = process.umask(0o022);
  let browser: Browser;
  try {
    browser = await launch([], { profile });
  } finally {
    process.umask(umask);
  }
  try {
    // The data service, which keeps the copies of the history, starts with the first page.
    const page = `${server.origin}/index.html`;
    await go(browser, page);
    await waitForPage(browser, (url) => url === page);
    await expect.poll(() => visitsOf(profile, page)).toBe(1);
    await expect.poll(modes).toEqual({
      ...Object.fromEntries(Object.keys(older).map((name) => [name, '600'])),
      logs: '700',
      newtab: '700',
    });
  } finally {
    await browser.close();
  }
});
