import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  FixtureServer,
  launch,
  pressNative,
  shellState,
  tabViews,
  waitForPage,
  type Browser,
} from './harness.ts';
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

/**
 * Whether the view of a tab's page shows, rather than the shell's page for a problem;
 * `undefined` while the window has no view of the page.
 * @param url - The address of the page, by which the view is found.
 */
async function pageShown(browser: Browser, url: string): Promise<boolean | undefined> {
  return (await tabViews(browser)).find((view) => view.url === url)?.visible;
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
    // Windows tries a refused connection to a local port again for about two seconds before it
    // gives up, and the first web page also waits for the code of web pages.
    await expect(problem).toBeVisible({ timeout: 15_000 });
    await expect(problem).toContainText(`127.0.0.1:${port} refused to connect.`);
    await expect(problem).toContainText('Error: ERR_CONNECTION_REFUSED');
    expect(await pageShown(browser, url)).toBe(false);
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
    await expect.poll(() => pageShown(browser, url)).toBe(true);
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
    await expect.poll(() => pageShown(browser, url)).toBe(true);
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
    expect(await pageShown(browser, url)).toBe(false);
    await problem.getByRole('button', { name: 'Reload' }).click();
    await expect(problem).toBeHidden();
    await expect.poll(() => pageShown(browser, url)).toBe(true);
    // The tab shows its page again.
    expect((await shellState(browser.shell)).tabs[0]?.problem).toBe(null);
  } finally {
    await browser.close();
  }
});

/** The process of the network service, which Chromium starts as a utility process. */
function networkService(browser: Browser): Promise<number | undefined> {
  return browser.main.evaluate(
    ({ app }) =>
      app.getAppMetrics().find((metric) => metric.serviceName === 'network.mojom.NetworkService')
        ?.pid,
  );
}

/** A view of the browser, by its id and the address that it shows. */
interface ShownView {
  readonly id: number;
  readonly url: string;
}

/** A record of the log of the browser process. */
interface LogRecord {
  readonly message: string;
  readonly fields?: Readonly<Record<string, unknown>>;
}

function logRecords(browser: Browser): LogRecord[] {
  return readFileSync(join(browser.profile, 'data', 'logs', 'main.log'), 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogRecord);
}

/** The views, among those of the ids, that have shown a page and loaded, by their address. */
function loadedViews(browser: Browser, ids: readonly number[]): Promise<ShownView[]> {
  return browser.main.evaluate(
    ({ webContents }, known) =>
      webContents
        .getAllWebContents()
        .filter((contents) => known.includes(contents.id) && !contents.isLoading())
        .map((contents) => ({ id: contents.id, url: contents.getURL() }))
        .toSorted((a, b) => a.url.localeCompare(b.url)),
    ids,
  );
}

/**
 * Opens a new window while the network service, stopped by the caller, does not answer, and
 * returns its two views, the shell and the new tab page, once they wait for their first response.
 */
async function newWindowThatWaits(browser: Browser): Promise<number[]> {
  const before = await browser.main.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((contents) => contents.id),
  );
  const waiting = (): Promise<number[]> =>
    browser.main.evaluate(
      ({ webContents }, known) =>
        webContents
          .getAllWebContents()
          .filter(
            (contents) =>
              !known.includes(contents.id) &&
              contents.getURL() === '' &&
              contents.isWaitingForResponse(),
          )
          .map((contents) => contents.id),
      before,
    );
  await pressNative(browser, 'N', ['primary']);
  await expect.poll(async () => (await waiting()).length).toBe(2);
  const views = await waiting();
  // A page of the browser loads within some milliseconds; these wait for the network service.
  await new Promise((done) => setTimeout(done, 2000));
  expect(await waiting()).toEqual(views);
  return views;
}

/** Waits until the shell of the second window renders. */
async function secondShellRenders(browser: Browser): Promise<void> {
  const shells = (): Page[] =>
    browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url().startsWith('app://shell') && page !== browser.shell);
  await expect.poll(() => shells().length).toBe(1);
  await shells()[0]?.waitForSelector('app-shell');
}

/** Lets a stopped process run on, if it still exists. */
function resume(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGCONT');
  } catch {
    // The browser ended it.
  }
}

const loadsAgain = 'A page of the browser waited for the network service; it loads again';

test("loads the browser's own pages of a new window again when the network service went away while they loaded", async () => {
  // The test holds the network service while the pages wait for it; Windows cannot stop a
  // process from Node.js.
  test.skip(process.platform === 'win32', 'Windows cannot stop a process from Node.js');
  const browser = await launch();
  let stopped: number | undefined;
  try {
    const service = await networkService(browser);
    if (service === undefined) throw new Error('The network service has no process');
    // As on the macOS runners: the network service does not answer while a window loads, and
    // then goes away. Chromium asks it to read the headers of the browser's own pages too.
    process.kill(service, 'SIGSTOP');
    stopped = service;
    const views = await newWindowThatWaits(browser);
    process.kill(service, 'SIGKILL');
    stopped = undefined;
    // Chromium starts a new service, but the answers that the old one owed never come. The
    // pages load again once they waited 10 s; without that, they would wait for good.
    await expect
      .poll(async () => (await loadedViews(browser, views)).map(({ url }) => url), {
        timeout: 20_000,
      })
      .toEqual(['app://newtab/', 'app://shell/']);
    await secondShellRenders(browser);
    // The log tells why the pages loaded again, and the loads that this ended fail quietly.
    const again = logRecords(browser)
      .filter((record) => record.message === loadsAgain)
      .map(({ fields }) => ({ id: fields?.['id'], url: fields?.['url'] }))
      .toSorted((a, b) => String(a.url).localeCompare(String(b.url)));
    expect(again).toEqual(await loadedViews(browser, views));
    const unhandled = logRecords(browser).filter((record) =>
      record.message.includes('no code handled it'),
    );
    expect(unhandled).toEqual([]);
  } finally {
    resume(stopped);
    await browser.close();
  }
});

test("ends a network service that does not answer the browser's own pages, and loads them again", async () => {
  test.skip(process.platform === 'win32', 'Windows cannot stop a process from Node.js');
  // The browser waits 30 s before it ends a service that may only be slow.
  test.setTimeout(120_000);
  const browser = await launch();
  let stopped: number | undefined;
  try {
    const service = await networkService(browser);
    if (service === undefined) throw new Error('The network service has no process');
    // As in one start on the macOS runners: the network service never answers, and Chromium
    // does not replace it.
    process.kill(service, 'SIGSTOP');
    stopped = service;
    const opened = Date.now();
    const views = await newWindowThatWaits(browser);
    // A service that may only be slow goes on: 15 s after the window opened, the pages still
    // wait for the same service.
    await new Promise((done) => setTimeout(done, Math.max(0, opened + 15_000 - Date.now())));
    expect(await networkService(browser)).toBe(service);
    expect(await loadedViews(browser, views)).toEqual([]);
    // Once they waited 30 s, the browser ends the service, and Chromium starts a new one.
    await expect.poll(() => networkService(browser), { timeout: 40_000 }).not.toBe(service);
    stopped = undefined;
    expect(Date.now() - opened).toBeGreaterThan(25_000);
    await expect
      .poll(async () => (await loadedViews(browser, views)).map(({ url }) => url), {
        timeout: 10_000,
      })
      .toEqual(['app://newtab/', 'app://shell/']);
    await secondShellRenders(browser);
    // After 10 s the pages loaded again, which costs nothing when the service is only slow.
    const again = logRecords(browser).filter((record) => record.message === loadsAgain);
    expect(again).toHaveLength(2);
    const ended = logRecords(browser).filter(
      (record) =>
        record.message === 'The network service did not answer a page of the browser and is ended',
    );
    expect(ended).toMatchObject([{ fields: { service, looks: 3 } }]);
    // The pages load again as soon as Chromium tells that the service went away.
    const gone = logRecords(browser)
      .filter((record) => record.message.startsWith('The network service went away'))
      .map(({ fields }) => ({ id: fields?.['id'], reason: fields?.['reason'] }))
      .toSorted((a, b) => Number(a.id) - Number(b.id));
    expect(gone).toEqual(views.toSorted((a, b) => a - b).map((id) => ({ id, reason: 'killed' })));
  } finally {
    resume(stopped);
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
    expect(await pageShown(browser, url)).toBe(false);
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
    // The browser process lists the page of the window a moment after DevTools tells of it.
    await expect.poll(() => pageShown(browser, `${url}again.html`)).toBe(true);
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

test('lets the sign-in prompt leave the window as it showed, with what was typed into it', async () => {
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
    await expect(prompt).toBeVisible();
    // The prompt takes long to leave here, so that the test sees it while it leaves.
    await overlay.evaluate(() => {
      const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
        ?.value as Element['animate'];
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ): Animation {
        const [keyframes, options] = args;
        const slow = typeof options === 'object' ? { ...options, duration: 20_000 } : options;
        return animate.call(this, keyframes, slow);
      };
    });
    await prompt.getByRole('textbox', { name: 'User name' }).fill('tester');
    await prompt.getByLabel('Password').fill('secret');
    await prompt.getByRole('button', { name: 'Sign in' }).click();
    // What leaves is the prompt that showed, not one drawn anew with empty fields.
    const leaving = overlay.locator('.leaving');
    await expect(leaving).toHaveCount(1);
    await expect(leaving.locator('input[name="username"]')).toHaveValue('tester');
    await expect(leaving.locator('input[name="password"]')).toHaveValue('secret');
    await expect(overlay.locator('.current')).toHaveCount(0);
    const page = await waitForPage(browser, (current) => current === url);
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
    // The page asks; the icon that the browser looks for is asked for without a sign-in.
    if (request.url === '/members.html') asked += 1;
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
