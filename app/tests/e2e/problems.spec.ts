import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FixtureServer, launch, shellState, waitForPage, type Browser } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** A port on which nothing listens, so connections to it are refused. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** Whether the view of the active tab is shown, rather than the shell's page for a problem. */
function pageShown(browser: Browser): Promise<boolean> {
  return browser.main.evaluate(({ BaseWindow }) => {
    const views = BaseWindow.getAllWindows()[0]?.contentView.children ?? [];
    return views.at(-1)?.getVisible() ?? false;
  });
}

async function open(browser: Browser, url: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
}

test('tells why a page could not be loaded and loads it once it is there', async () => {
  const browser = await launch();
  const port = await freePort();
  let late: Server | undefined;
  try {
    const url = `http://127.0.0.1:${port}/late.html`;
    await open(browser, url);
    const problem = browser.shell.getByRole('region', { name: "This page can't be reached" });
    await expect(problem).toBeVisible();
    await expect(problem).toContainText(`127.0.0.1:${port} refused to connect.`);
    await expect(problem).toContainText('Error: ERR_CONNECTION_REFUSED');
    expect(await pageShown(browser)).toBe(false);
    // The address bar keeps the address, so it can be corrected or tried again.
    await expect(
      browser.shell.getByRole('textbox', { name: 'Address and search bar' }),
    ).toHaveValue(url);
    late = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Late</title><p>Here now</p>');
    });
    await new Promise<void>((done) => late?.listen(port, '127.0.0.1', done));
    await problem.getByRole('button', { name: 'Try again' }).click();
    await expect(problem).toBeHidden();
    await expect.poll(() => pageShown(browser)).toBe(true);
    const page = await waitForPage(browser, (current) => current === url);
    await expect(page.getByText('Here now')).toBeVisible();
  } finally {
    await browser.close();
    await new Promise<void>((done) => (late === undefined ? done() : late.close(() => done())));
  }
});

test('shows a page whose renderer crashed and loads it again', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/second.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (current) => current === url);
    await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
    await expect.poll(() => pageShown(browser)).toBe(true);
    // Electron's own way ends the renderer on Windows and macOS, but makes it crash on Linux,
    // where the crash handler of the system can keep the process alive while it saves a dump.
    // So the test ends the process of the page at once, the same way on every system.
    await browser.main.evaluate(({ webContents }, address) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL() === address);
      if (contents === undefined) throw new Error(`No page shows ${address}`);
      contents.once('render-process-gone', (_event, details) => {
        Object.assign(globalThis, { pageGone: details.reason });
      });
      process.kill(contents.getOSProcessId(), 'SIGKILL');
    }, url);
    await expect
      .poll(() => browser.main.evaluate(() => Reflect.get(globalThis, 'pageGone')))
      .toBeDefined();
    const problem = browser.shell.getByRole('region', { name: 'This page crashed' });
    await expect(problem).toBeVisible();
    expect(await pageShown(browser)).toBe(false);
    await problem.getByRole('button', { name: 'Reload' }).click();
    await expect(problem).toBeHidden();
    await expect.poll(() => pageShown(browser)).toBe(true);
    // The tab shows its page again.
    expect((await shellState(browser.shell)).tabs[0]?.problem).toBe(null);
  } finally {
    await browser.close();
  }
});

test('asks whether to wait for a page that does not respond, or to close it', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/second.html`);
    await waitForPage(browser, (current) => current.endsWith('/second.html'));
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await open(browser, `${server.origin}/blocker.html`);
    const url = `${server.origin}/blocker.html`;
    await waitForPage(browser, (current) => current === url);
    await browser.main.evaluate(({ dialog, webContents }, address) => {
      const asked: string[] = [];
      Object.assign(globalThis, { askedMessages: asked });
      dialog.showMessageBox = ((_window: unknown, options: Electron.MessageBoxOptions) => {
        asked.push(options.message);
        return Promise.resolve({ response: 1, checkboxChecked: false });
      }) as typeof dialog.showMessageBox;
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === address)
        ?.emit('unresponsive');
    }, url);
    await expect.poll(async () => (await shellState(browser.shell)).tabs.length).toBe(1);
    expect(
      await browser.main.evaluate(() => Reflect.get(globalThis as object, 'askedMessages')),
    ).toEqual([`${new URL(server.origin).host} isn't responding`]);
  } finally {
    await browser.close();
  }
});
