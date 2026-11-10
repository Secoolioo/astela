import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pressNative, shellState, waitForPage, type Browser } from './harness.ts';

let server: Server;
let origin = '';

const pages: Readonly<Record<string, string>> = {
  '/regular': '<title>Fixture regular</title>',
  '/private': '<title>Fixture private</title><a href="/report.txt">Report</a>',
  '/opener':
    '<title>Fixture private opener</title>' +
    `<button onclick="window.open('/private', 'popup', 'width=520,height=420')">Open a popup</button>`,
};

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    const page = pages[path];
    if (page !== undefined) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html>${page}`);
    } else if (path === '/report.txt') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="private-report.txt"',
      });
      response.end('Fixture report\n');
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

function windowCount(browser: Browser): Promise<number> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
}

/** The pages whose address starts with a text, without those that closed. */
function pagesAt(browser: Browser, start: string): Page[] {
  return browser.cdp
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed() && page.url().startsWith(start));
}

/** The shells of the private windows, or of the regular ones. */
async function shells(browser: Browser, privateWindow: boolean): Promise<Page[]> {
  const found: Page[] = [];
  for (const page of pagesAt(browser, 'app://shell')) {
    try {
      if ((await shellState(page)).private === privateWindow) found.push(page);
    } catch {
      // A shell that loads or closes tells nothing yet.
    }
  }
  return found;
}

/** Opens a private window with its shortcut while no other is open, and returns its shell. */
async function openPrivate(browser: Browser): Promise<Page> {
  await expect.poll(async () => (await shells(browser, true)).length).toBe(0);
  await pressNative(browser, 'N', ['primary', 'shift']);
  await expect.poll(async () => (await shells(browser, true)).length).toBe(1);
  const [shell] = await shells(browser, true);
  if (shell === undefined) throw new Error('No private window');
  return shell;
}

/** Opens a page of the server in the window of a shell. */
async function openIn(browser: Browser, shell: Page, path: string): Promise<Page> {
  const address = shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${origin}${path}`);
  await address.press('Enter');
  return waitForPage(browser, (url) => url === `${origin}${path}`);
}

/** Closes every window but the first, as their close buttons do, and waits until they went. */
async function closeOthers(browser: Browser): Promise<void> {
  await browser.main.evaluate(({ BaseWindow }) => {
    for (const window of BaseWindow.getAllWindows()) if (window.id !== 1) window.close();
  });
  await expect.poll(() => windowCount(browser)).toBe(1);
  await expect.poll(() => pagesAt(browser, origin).length).toBe(0);
  await expect.poll(() => pagesAt(browser, 'app://overlay').length).toBe(0);
}

test('keeps no history, session, cookies or answers of a private window', async () => {
  const browser = await launch();
  const { profile } = browser;
  try {
    try {
      await openIn(browser, browser.shell, '/regular');
      const shell = await openPrivate(browser);
      // The window says that it is private, and its own views look dark.
      await expect(shell.getByText('Private', { exact: true })).toBeVisible();
      expect(
        await shell.evaluate(() => document.documentElement.hasAttribute('data-private')),
      ).toBe(true);
      expect((await shellState(browser.shell)).private).toBe(false);
      const page = await openIn(browser, shell, '/private');
      await page.evaluate(() => {
        document.cookie = 'mode=private; max-age=3600';
      });
      // Its data stays in memory, apart from the data of regular windows.
      expect(
        await browser.main.evaluate(async ({ session, webContents }, url) => {
          const contents = webContents.getAllWebContents().find((w) => w.getURL() === url);
          const regular = await session.fromPartition('persist:default').cookies.get({});
          return {
            inMemory: contents?.session.storagePath === null,
            regular: regular.some((cookie) => cookie.name === 'mode'),
          };
        }, `${origin}/private`),
      ).toEqual({ inMemory: true, regular: false });
      // A site asks in a private window as well, and the answer holds while it is open.
      const asked = page.evaluate(() => Notification.requestPermission());
      const overlay = await waitForPage(browser, (url) => url.startsWith('app://overlay'));
      await overlay.getByRole('dialog').getByRole('button', { name: 'Allow' }).click();
      expect(await asked).toBe('granted');
      expect(await page.evaluate(() => Notification.requestPermission())).toBe('granted');

      // The history has the page of the regular window only.
      const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
      await field.fill('app://history');
      await field.press('Enter');
      const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
      await expect(history.getByRole('button', { name: /^Fixture regular/ })).toBeVisible();
      await expect(history.getByRole('button', { name: /^Fixture private/ })).toHaveCount(0);

      // After the last private window closed, the next one starts without its data.
      await closeOthers(browser);
      const again = await openPrivate(browser);
      const fresh = await openIn(browser, again, '/private');
      expect(await fresh.evaluate(() => document.cookie)).toBe('');
      const askedAgain = fresh.evaluate(() => Notification.requestPermission());
      const question = (
        await waitForPage(browser, (url) => url.startsWith('app://overlay'))
      ).getByRole('dialog');
      await question.getByRole('button', { name: 'Block' }).click();
      expect(await askedAgain).toBe('denied');
    } finally {
      await browser.close({ keepProfile: true });
    }
    // Neither the settings nor the session keep anything of private windows.
    const settings = join(profile, 'data', 'settings.json');
    expect(existsSync(settings) ? readFileSync(settings, 'utf8') : '').not.toContain('127.0.0.1');
    const next = await launch([], { profile });
    try {
      await expect.poll(() => windowCount(next)).toBe(1);
      expect((await shellState(next.shell)).private).toBe(false);
      await expect
        .poll(async () => (await shellState(next.shell)).tabs.map((tab) => tab.url))
        .toEqual(['app://history/']);
    } finally {
      await next.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('lists the downloads of a private window only there and keeps their files', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'e2e-private-downloads-'));
  const browser = await launch();
  try {
    await browser.main.evaluate(({ app }, path) => app.setPath('downloads', path), folder);
    const shell = await openPrivate(browser);
    const page = await openIn(browser, shell, '/private');
    await page.getByRole('link', { name: 'Report' }).click();
    const file = join(folder, 'private-report.txt');
    await expect.poll(() => existsSync(file)).toBe(true);
    await expect.poll(async () => (await shellState(shell)).downloads).not.toBeNull();
    expect((await shellState(browser.shell)).downloads).toBeNull();
    // The file stays after the window closed, and the next private window lists nothing.
    await closeOthers(browser);
    expect(readFileSync(file, 'utf8')).toBe('Fixture report\n');
    const again = await openPrivate(browser);
    expect((await shellState(again)).downloads).toBeNull();
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('opens what a page of a private window opens in private windows', async () => {
  const browser = await launch();
  try {
    const shell = await openPrivate(browser);
    const opener = await openIn(browser, shell, '/opener');
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    await expect.poll(() => windowCount(browser)).toBe(3);
    await expect.poll(async () => (await shells(browser, true)).length).toBe(2);
    expect(
      await browser.main.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .filter((contents) => contents.getURL() === url)
            .map((contents) => contents.session.storagePath),
        `${origin}/private`,
      ),
    ).toEqual([null]);
  } finally {
    await browser.close();
  }
});
