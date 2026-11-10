import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pressNative, waitForPage, type Browser } from './harness.ts';

const mac = process.platform === 'darwin';
/** The large download comes in parts with a pause between them, so a test can catch it. */
const part = Buffer.alloc(64 * 1024, 7);
const parts = 40;

let server: Server;
let origin = '';

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname;
    if (path === '/report.txt') {
      response.writeHead(200, {
        'content-type': 'text/plain',
        'content-disposition': 'attachment; filename="report.txt"',
      });
      response.end('Fixture report\n');
    } else if (path === '/large.bin' || path === '/Large.bin') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${path.slice(1)}"`,
        'content-length': String(part.length * parts),
      });
      let sent = 0;
      const timer = setInterval(() => {
        response.write(part);
        sent += 1;
        if (sent === parts) {
          clearInterval(timer);
          response.end();
        }
      }, 150);
      response.on('close', () => clearInterval(timer));
    } else if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<!doctype html><title>Fixture downloads</title>' +
          '<a href="/report.txt">Report</a> <a href="/large.bin">Large</a> ' +
          '<a href="/Large.bin">Second copy</a>',
      );
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

/** Points the browser's downloads folder at a folder of the test. */
async function useFolder(browser: Browser, folder: string): Promise<void> {
  await browser.main.evaluate(({ app }, path) => app.setPath('downloads', path), folder);
}

async function openPage(browser: Browser): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${origin}/`);
  await address.press('Enter');
  return waitForPage(browser, (url) => url === `${origin}/`);
}

/** The list of downloads in the overlay. */
async function list(browser: Browser): Promise<Locator> {
  const overlay = await waitForPage(browser, (url) => url.startsWith('app://overlay'));
  return overlay.getByRole('dialog', { name: 'Downloads' });
}

/** Opens the list with its shortcut. */
async function openList(browser: Browser): Promise<Locator> {
  await pressNative(browser, mac ? 'L' : 'J', mac ? ['primary', 'alt'] : ['primary'], origin);
  return list(browser);
}

/** Makes the browser record what it opens instead of opening it. */
async function recordOpening(browser: Browser): Promise<void> {
  await browser.main.evaluate(({ shell }) => {
    const log: string[][] = [];
    Reflect.set(globalThis, 'opened', log);
    shell.showItemInFolder = (path) => void log.push(['folder', path]);
    shell.openPath = (path) => {
      log.push(['open', path]);
      return Promise.resolve('');
    };
  });
}

function opened(browser: Browser): Promise<unknown> {
  return browser.main.evaluate(() => Reflect.get(globalThis, 'opened'));
}

test('saves downloads in the downloads folder under a free name and lists them', async () => {
  const browser = await launch();
  const folder = mkdtempSync(join(tmpdir(), 'downloads-'));
  try {
    await useFolder(browser, folder);
    await recordOpening(browser);
    const page = await openPage(browser);
    const button = browser.shell.getByRole('button', { name: /^Downloads/ });
    await expect(button).toBeHidden();
    await page.getByRole('link', { name: 'Report' }).click();
    await expect.poll(() => existsSync(join(folder, 'report.txt'))).toBe(true);
    await expect(button).toBeVisible();
    // A second download of the same file gets a name of its own.
    await page.getByRole('link', { name: 'Report' }).click();
    await expect.poll(() => existsSync(join(folder, 'report (1).txt'))).toBe(true);
    await expect
      .poll(() => readFileSync(join(folder, 'report (1).txt'), 'utf8'))
      .toBe('Fixture report\n');

    await button.click();
    const downloads = await list(browser);
    const items = downloads.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('report (1).txt');
    await expect(items.last()).toContainText('report.txt');
    await downloads.getByRole('button', { name: 'Show in folder: report.txt' }).click();
    await downloads.getByRole('button', { name: 'Open: report (1).txt' }).click();
    await expect
      .poll(() => opened(browser))
      .toEqual([
        ['folder', join(folder, 'report.txt')],
        ['open', join(folder, 'report (1).txt')],
      ]);
    // Removing a download from the list keeps its file.
    await downloads.getByRole('button', { name: 'Remove from list: report.txt' }).click();
    await expect(items).toHaveCount(1);
    expect(existsSync(join(folder, 'report.txt'))).toBe(true);
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('gives downloads whose names differ only in case names of their own', async () => {
  const browser = await launch();
  const folder = mkdtempSync(join(tmpdir(), 'downloads-'));
  try {
    await useFolder(browser, folder);
    const page = await openPage(browser);
    // Both run at the same time, so the file of neither is there when the other one starts.
    await page.getByRole('link', { name: 'Large' }).click();
    await page.getByRole('link', { name: 'Second copy' }).click();
    await expect(
      browser.shell.getByRole('button', { name: 'Downloads (2 running)' }),
    ).toBeVisible();
    await expect(browser.shell.getByRole('button', { name: 'Downloads', exact: true })).toBeVisible(
      { timeout: 20_000 },
    );
    // Windows and macOS do not tell apart names that differ only in case, so there one file
    // would replace the other.
    const names = readdirSync(folder);
    expect(names).toHaveLength(2);
    for (const name of names) expect(statSync(join(folder, name)).size).toBe(part.length * parts);
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('pauses, resumes and cancels a download, and downloads it again', async () => {
  const browser = await launch();
  const folder = mkdtempSync(join(tmpdir(), 'downloads-'));
  try {
    await useFolder(browser, folder);
    const page = await openPage(browser);
    await page.getByRole('link', { name: 'Large' }).click();
    await expect(
      browser.shell.getByRole('button', { name: 'Downloads (1 running)' }),
    ).toBeVisible();
    const downloads = await openList(browser);
    const item = downloads.getByRole('listitem').first();
    await item.getByRole('button', { name: 'Pause: large.bin' }).click();
    await expect(item).toContainText('Paused');
    await item.getByRole('button', { name: 'Resume: large.bin' }).click();
    await expect(item).not.toContainText('Paused');
    await item.getByRole('button', { name: 'Cancel: large.bin' }).click();
    await expect(item).toContainText('Canceled');
    await expect(browser.shell.getByRole('button', { name: 'Downloads' })).toBeVisible();
    // Trying again downloads the file once more, in place of the canceled download.
    await item.getByRole('button', { name: 'Try again: large.bin' }).click();
    await expect(downloads.getByRole('listitem')).toHaveCount(1);
    await expect(item.getByRole('button', { name: 'Show in folder: large.bin' })).toBeVisible({
      timeout: 20_000,
    });
    expect(statSync(join(folder, 'large.bin')).size).toBe(part.length * parts);
  } finally {
    await browser.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('opens the list with its shortcut and keeps it for the next start', async () => {
  const browser = await launch();
  const folder = mkdtempSync(join(tmpdir(), 'downloads-'));
  const { profile } = browser;
  try {
    try {
      await useFolder(browser, folder);
      const page = await openPage(browser);
      const empty = await openList(browser);
      await expect(empty).toContainText('Nothing downloaded yet.');
      await empty.page().keyboard.press('Escape');
      await page.getByRole('link', { name: 'Report' }).click();
      await expect.poll(() => existsSync(join(folder, 'report.txt'))).toBe(true);
    } finally {
      await browser.close({ keepProfile: true });
    }
    const again = await launch([], { profile });
    try {
      await openPage(again);
      const downloads = await openList(again);
      await expect(downloads.getByRole('listitem')).toHaveCount(1);
      await expect(downloads).toContainText('report.txt');
      await expect(
        downloads.getByRole('button', { name: 'Show in folder: report.txt' }),
      ).toBeVisible();
    } finally {
      await again.close();
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  }
});
