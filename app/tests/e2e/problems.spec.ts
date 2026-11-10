import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { FixtureServer, launch, shellState, waitForPage, type Browser } from './harness.ts';
import { selfSignedCertificate } from './tls.ts';

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

test('warns about a certificate that is not trusted and continues only when asked', async () => {
  const secure = createSecureServer(selfSignedCertificate(), (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Secure</title><p>Behind the warning</p>');
  });
  await new Promise<void>((done) => secure.listen(0, '127.0.0.1', done));
  const { port } = secure.address() as AddressInfo;
  const browser = await launch();
  try {
    const url = `https://127.0.0.1:${port}/`;
    await open(browser, url);
    const problem = browser.shell.getByRole('region', { name: "Your connection isn't private" });
    // Windows checks an unknown certificate with the system, which can look for its issuer on
    // the network first; the warning shows once the check has failed.
    await expect(problem).toBeVisible({ timeout: 30_000 });
    await expect(problem).toContainText('Error: ERR_CERT_AUTHORITY_INVALID');
    expect(await pageShown(browser)).toBe(false);
    const proceed = problem.getByRole('button', { name: `Continue to 127.0.0.1:${port}` });
    await expect(proceed).toBeHidden();
    await problem.getByText('Details').click();
    await proceed.click();
    await expect(problem).toBeHidden();
    const page = await waitForPage(browser, (current) => current === url);
    await expect(page.getByText('Behind the warning')).toBeVisible();
    // The exception holds for the rest of the session.
    await open(browser, `${server.origin}/second.html`);
    await waitForPage(browser, (current) => current.endsWith('/second.html'));
    await open(browser, `${url}again.html`);
    await waitForPage(browser, (current) => current === `${url}again.html`);
    expect(await pageShown(browser)).toBe(true);
    await expect(problem).toBeHidden();
  } finally {
    await browser.close();
    await new Promise<void>((done) => secure.close(() => done()));
  }
});

test('asks for the user name and password that a site wants, and signs in', async () => {
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
    const url = `http://127.0.0.1:${port}/members.html`;
    await open(browser, url);
    const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
    const prompt = overlay.getByRole('dialog', { name: 'Sign in' });
    await expect(prompt).toContainText(`127.0.0.1:${port} asks for a user name and password.`);
    await expect(prompt).toContainText('Area: Fixture members');
    await expect(prompt).toContainText('The connection is not encrypted');
    // Canceling leaves the page as the site sends it without signing in.
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    const page = await waitForPage(browser, (current) => current === url);
    await expect(page.getByText('Not signed in')).toBeVisible();
    // The reload waits for the sign-in, so the shell's button starts it.
    await browser.shell.getByRole('button', { name: 'Reload' }).click();
    await prompt.getByRole('textbox', { name: 'User name' }).fill('tester');
    await prompt.getByLabel('Password').fill('secret');
    await prompt.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Signed in as tester')).toBeVisible();
  } finally {
    await browser.close();
    await new Promise<void>((done) => guarded.close(() => done()));
  }
});

test('asks for the sign-in of a tab in the background once the tab shows', async () => {
  let asked = 0;
  const guarded = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/') {
      response.end('<!doctype html><title>Start</title><a href="/members.html">Members</a>');
      return;
    }
    const expected = `Basic ${Buffer.from('tester:secret').toString('base64')}`;
    if (request.headers.authorization === expected) {
      response.end('<!doctype html><title>Members</title><p>Signed in as tester</p>');
      return;
    }
    asked += 1;
    response.statusCode = 401;
    response.setHeader('WWW-Authenticate', 'Basic realm="Fixture members"');
    response.end('<!doctype html><title>Members</title><p>Not signed in</p>');
  });
  await new Promise<void>((done) => guarded.listen(0, '127.0.0.1', done));
  const { port } = guarded.address() as AddressInfo;
  const browser = await launch();
  try {
    const start = `http://127.0.0.1:${port}/`;
    await open(browser, start);
    const page = await waitForPage(browser, (current) => current === start);
    await page.getByRole('link', { name: 'Members' }).click({ button: 'middle' });
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect.poll(() => asked).toBe(1);
    // The question would show by now; the tab in front keeps the keyboard and the window.
    await new Promise((done) => setTimeout(done, 1000));
    const overlays = browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .filter((candidate) => candidate.url().startsWith('app://overlay'));
    for (const shown of overlays) {
      await expect(shown.getByRole('dialog', { name: 'Sign in' })).toBeHidden();
    }
    await browser.shell.getByRole('tab', { name: /Members|127\.0\.0\.1/ }).click();
    const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
    const prompt = overlay.getByRole('dialog', { name: 'Sign in' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('textbox', { name: 'User name' }).fill('tester');
    await prompt.getByLabel('Password').fill('secret');
    await prompt.getByRole('button', { name: 'Sign in' }).click();
    const members = await waitForPage(browser, (current) => current.endsWith('/members.html'));
    await expect(members.getByText('Signed in as tester')).toBeVisible();
  } finally {
    await browser.close();
    await new Promise<void>((done) => guarded.close(() => done()));
  }
});

test('warns that a proxy gets the password unencrypted, also on the way to an https site', async () => {
  const refusal =
    'HTTP/1.1 407 Proxy Authentication Required\r\n' +
    'Proxy-Authenticate: Basic realm="Fixture proxy"\r\nContent-Length: 0\r\n\r\n';
  const proxy = createServer((_request, response) => {
    response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Fixture proxy"' }).end();
  });
  // A browser reaches an https site through the proxy with CONNECT, which asks the same way.
  proxy.on('connect', (_request, socket) => {
    socket.end(refusal);
  });
  await new Promise<void>((done) => proxy.listen(0, '127.0.0.1', done));
  const { port } = proxy.address() as AddressInfo;
  const browser = await launch([`--proxy-server=http://127.0.0.1:${port}`]);
  try {
    await open(browser, 'https://proxied.example/');
    const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
    const prompt = overlay.getByRole('dialog', { name: 'Sign in' });
    await expect(prompt).toContainText(`The proxy 127.0.0.1:${port} asks for a user name`);
    await expect(prompt).toContainText('The connection is not encrypted');
  } finally {
    await browser.close();
    proxy.closeAllConnections();
    await new Promise<void>((done) => proxy.close(() => done()));
  }
});
