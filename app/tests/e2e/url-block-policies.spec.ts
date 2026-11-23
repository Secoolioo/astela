import { expect, test, type Locator } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, shellState, waitForPage, type Browser } from './harness.ts';
import { MachinePolicies } from './machine-policies.ts';

/** What the site was asked, as `host path`. */
const asked: string[] = [];
let server: Server;
let port: number;

/**
 * A service worker that keeps the page of its scope and answers every page of the scope with
 * it, as the app shell of a web app does, without asking the site for the page. For the test,
 * it tells the site which page it answered.
 */
const worker = `
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('shell').then((cache) => cache.add('/app/')).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    fetch('/answered?' + new URL(event.request.url).pathname).catch(() => undefined);
    event.respondWith(caches.match('/app/').then((page) => page ?? fetch(event.request)));
  }
});`;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const host = request.headers.host ?? '';
    asked.push(`${host} ${request.url ?? ''}`);
    if (request.url === '/app/worker.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' });
      response.end(worker);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    if (request.url === '/frames') {
      response.end(
        `<title>Frames of ${host}</title>` +
          `<iframe src="${address('blocked', 'inner')}"></iframe>` +
          `<iframe src="${address('open.blocked', 'inner')}"></iframe>` +
          `<object data="${address('blocked', 'object')}" type="text/html"></object>` +
          `<embed src="${address('blocked', 'embed')}" type="text/html">`,
      );
      return;
    }
    if (request.url === '/app/') {
      // The app becomes ready once its service worker holds the page.
      response.end(
        '<title>App</title><script>' +
          "navigator.serviceWorker.register('/app/worker.js', { scope: '/app/' })" +
          '.then(() => navigator.serviceWorker.ready)' +
          ".then(() => { document.title = 'App ready'; });</script>",
      );
      return;
    }
    if (request.url === '/embeds') {
      response.end('<title>Embeds</title><iframe src="/app/framed"></iframe>');
      return;
    }
    response.end(`<title>Page of ${host}</title>`);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/** An address of a host of the test, which the host rules send to the local site. */
function address(name: string, path = ''): string {
  return `http://${name}.qa.test:${String(port)}/${path}`;
}

/**
 * An address of the site on `localhost`, which counts as secure as Chromium sees it, so its
 * pages may have a service worker.
 */
function local(path: string): string {
  return `http://localhost:${String(port)}/${path}`;
}

/** What the site was asked for a host of the test. */
function askedOf(name: string): string[] {
  return asked.filter((line) => line.startsWith(`${name}.qa.test:`));
}

/** The address bar of the window. */
function addressBar(browser: Browser): Locator {
  return browser.shell.getByRole('textbox', { name: 'Address and search bar' });
}

/** Types an address into the address bar of the window. */
async function go(browser: Browser, url: string): Promise<void> {
  await addressBar(browser).fill(url);
  await addressBar(browser).press('Enter');
}

/** Why the active tab shows no page, as its code, or `null` when it shows one. */
async function problemCode(browser: Browser): Promise<string | null> {
  const state = await shellState(browser.shell);
  return state.tabs.find((tab) => tab.id === state.activeTabId)?.problem?.code ?? null;
}

/** The address of what the active tab shows in place of its page, if anything. */
async function problemUrl(browser: Browser): Promise<string | undefined> {
  const state = await shellState(browser.shell);
  return state.tabs.find((tab) => tab.id === state.activeTabId)?.problem?.url;
}

/** Reads the policies again, as the browser does when a window gets the focus. */
async function readPolicies(browser: Browser): Promise<void> {
  await browser.main.evaluate(({ BaseWindow }) => {
    BaseWindow.getAllWindows()[0]?.emit('focus');
  });
}

/**
 * Waits until the browser applied lists of these sizes, which its log says once for each
 * change of what the policies of the network do.
 */
async function applied(browser: Browser, blocklist: number): Promise<void> {
  const record = new RegExp(`"Network policies applied".*"blocklist":${String(blocklist)},`);
  await expect
    .poll(() =>
      readFileSync(join(browser.profile, 'data', 'logs', 'main.log'), 'utf8')
        .split('\n')
        .some((line) => record.test(line)),
    )
    .toBe(true);
}

test('shows that the organization blocks a site, in pages, frames and local files, and loads its exceptions', async () => {
  // A test may change the policies of the system only on a CI runner, which is thrown away.
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  test.skip(process.platform !== 'linux', 'Writes the policies of the machine as Linux keeps them');
  const files = mkdtempSync(join(tmpdir(), 'e2e-blocked-files-'));
  const policies = new MachinePolicies('e2e-url-block');
  try {
    writeFileSync(join(files, 'page.html'), '<title>Local file</title>');
    policies.set({
      URLBlocklist: ['blocked.qa.test', 'example.com', `${pathToFileURL(files).href}/`],
      URLAllowlist: ['open.blocked.qa.test'],
    });
    const browser = await launch([
      '--host-resolver-rules=MAP *.qa.test 127.0.0.1',
      '--no-proxy-server',
    ]);
    asked.length = 0;
    try {
      // A page that may load comes first, so the blocked one offers the way back.
      await go(browser, address('open.blocked'));
      await expect(
        await waitForPage(browser, (url) => url === address('open.blocked')),
      ).toHaveTitle(`Page of open.blocked.qa.test:${String(port)}`);
      await go(browser, address('blocked'));
      await expect.poll(() => problemCode(browser)).toBe('ERR_BLOCKED_BY_ADMINISTRATOR');
      const problem = browser.shell.getByRole('region', { name: 'This site is blocked' });
      await expect(problem).toContainText(
        `Your organization blocks blocked.qa.test:${String(port)}.`,
      );
      expect(askedOf('blocked')).toEqual([]);
      // Nobody is trapped: the way back leads to the page before.
      await problem.getByRole('button', { name: 'Go back' }).click();
      await expect.poll(() => problemCode(browser)).toBe(null);
      expect((await shellState(browser.shell)).tabs[0]?.url).toBe(address('open.blocked'));
      // Its subdomains are blocked too, and the site never hears of them.
      await go(browser, address('www.blocked', 'below'));
      await expect.poll(() => problemUrl(browser)).toBe(address('www.blocked', 'below'));
      expect(await problemCode(browser)).toBe('ERR_BLOCKED_BY_ADMINISTRATOR');
      expect(askedOf('www.blocked')).toEqual([]);
      // A frame of a blocked host does not load, also of an object or an embed, and one of an
      // exception does. The page has loaded once its frames have.
      await go(browser, address('open.blocked', 'frames'));
      const frames = await waitForPage(browser, (url) => url === address('open.blocked', 'frames'));
      await frames.waitForLoadState('load');
      expect(askedOf('open.blocked')).toContain(`open.blocked.qa.test:${String(port)} /inner`);
      expect(askedOf('blocked')).toEqual([]);
      expect(await problemCode(browser)).toBe(null);
      // The browser itself does not load a local file below a blocked folder either.
      const file = pathToFileURL(join(files, 'page.html')).href;
      await browser.main.evaluate(({ webContents }, url) => {
        const tab = webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith('/frames'));
        void tab?.loadURL(url).catch(() => undefined);
      }, file);
      await expect.poll(() => problemUrl(browser)).toBe(file);
      expect(await problemCode(browser)).toBe('ERR_BLOCKED_BY_ADMINISTRATOR');
      // Once the policy is gone, the site loads at the next read of the policies, which the log
      // tells.
      policies.remove();
      await readPolicies(browser);
      await applied(browser, 0);
      await go(browser, address('blocked', 'again'));
      await expect(
        await waitForPage(browser, (url) => url === address('blocked', 'again')),
      ).toHaveTitle(`Page of blocked.qa.test:${String(port)}`);
      expect(askedOf('blocked')).toContain(`blocked.qa.test:${String(port)} /again`);
    } finally {
      await browser.close();
    }
  } finally {
    policies.remove();
    rmSync(files, { recursive: true, force: true });
  }
});

test('blocks the pages and frames that a service worker of the site answers from its cache', async () => {
  test.skip(process.env['CI'] === undefined, 'Changes the policies of the system');
  test.skip(process.platform !== 'linux', 'Writes the policies of the machine as Linux keeps them');
  const policies = new MachinePolicies('e2e-url-block-worker');
  try {
    const browser = await launch([
      '--host-resolver-rules=MAP *.qa.test 127.0.0.1',
      '--no-proxy-server',
    ]);
    try {
      // The app keeps its page while it may load, as web apps do that work offline.
      await go(browser, local('app/'));
      await expect(await waitForPage(browser, (url) => url === local('app/'))).toHaveTitle(
        'App ready',
      );
      await go(browser, address('open'));
      await expect(await waitForPage(browser, (url) => url === address('open'))).toHaveTitle(
        `Page of open.qa.test:${String(port)}`,
      );
      policies.set({ URLBlocklist: ['localhost/app/'] });
      await readPolicies(browser);
      await applied(browser, 1);
      asked.length = 0;
      // The service worker would show the app without asking the site; the tab says that the
      // site is blocked all the same.
      await go(browser, local('app/inbox'));
      await expect.poll(() => problemUrl(browser)).toBe(local('app/inbox'));
      expect(await problemCode(browser)).toBe('ERR_BLOCKED_BY_ADMINISTRATOR');
      const problem = browser.shell.getByRole('region', { name: 'This site is blocked' });
      await expect(problem).toBeVisible();
      // The page of the service worker goes, and the tab stays blocked, in the entry of the
      // history that the app had.
      await expect
        .poll(async () => {
          const tab = (await shellState(browser.shell)).tabs[0];
          return tab?.loading === false && !tab.title.startsWith('App');
        })
        .toBe(true);
      expect(await problemCode(browser)).toBe('ERR_BLOCKED_BY_ADMINISTRATOR');
      expect((await shellState(browser.shell)).tabs[0]?.url).toBe(local('app/inbox'));
      // The service worker answered the page, and the site was not asked for it.
      expect(asked).toContain(`localhost:${String(port)} /answered?/app/inbox`);
      expect(asked.filter((line) => line.endsWith(' /app/inbox'))).toEqual([]);
      await problem.getByRole('button', { name: 'Go back' }).click();
      await expect.poll(() => problemCode(browser)).toBe(null);
      expect((await shellState(browser.shell)).tabs[0]?.url).toBe(address('open'));
      // A frame of the app in an allowed page stays empty.
      await go(browser, local('embeds'));
      const embeds = await waitForPage(browser, (url) => url === local('embeds'));
      await embeds.waitForLoadState('load');
      expect(embeds.frames().map((frame) => frame.url())).not.toContain(local('app/framed'));
      expect(asked.filter((line) => line.includes('/app/framed'))).toEqual([]);
      expect(await problemCode(browser)).toBe(null);
    } finally {
      await browser.close();
    }
  } finally {
    policies.remove();
  }
});
