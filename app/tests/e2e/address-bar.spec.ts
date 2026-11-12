import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  FixtureServer,
  launch,
  pressNative,
  shellState,
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

/** Leads names of the test to servers on this computer, on every port. */
const mapTo = (names: Readonly<Record<string, number | string>>): string[] => [
  `--host-resolver-rules=${Object.entries(names)
    .map(([name, port]) => `MAP ${name} 127.0.0.1:${String(port)}`)
    .join(',')}`,
  '--no-proxy-server',
];

async function open(browser: Browser, url: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
}

/**
 * Holds back each message that tells the shell its state, so that the shell learns of a
 * change only some time after the browser made it, as on a busy computer.
 * @param browser - The running browser.
 * @param delay - How long each message waits, in milliseconds.
 */
async function delayShellState(browser: Browser, delay: number): Promise<void> {
  await browser.main.evaluate(({ webContents }, wait) => {
    const shell = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('app://shell'));
    if (shell === undefined) throw new Error('The shell was not found');
    const send = shell.send.bind(shell);
    shell.send = (channel: string, ...args: unknown[]): void => {
      if (channel === 'shell.stateChanged') setTimeout(() => send(channel, ...args), wait);
      else send(channel, ...args);
    };
  }, delay);
}

/**
 * Holds back the browser's answer to the shell's request for a new tab.
 * @param browser - The running browser.
 * @param delay - How long the answer waits, in milliseconds.
 */
async function delayNewTabAnswer(browser: Browser, delay: number): Promise<void> {
  await browser.shell.evaluate((wait) => {
    const shell = document.querySelector('app-shell') as unknown as {
      bridge: { invoke(channel: string, request: unknown): Promise<unknown> };
    };
    const bridge = shell.bridge;
    const invoke = bridge.invoke.bind(bridge);
    bridge.invoke = (channel, request) => {
      const answer = invoke(channel, request);
      return channel === 'tabs.open'
        ? answer.then((value) => new Promise((done) => setTimeout(() => done(value), wait)))
        : answer;
    };
  }, delay);
}

/** Opens a page in the first tab and returns its address. */
async function openFirstPage(browser: Browser): Promise<string> {
  const first = `${server.origin}/index.html`;
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await open(browser, first);
  await waitForPage(browser, (url) => url.endsWith('/index.html'));
  await expect(address).toHaveValue(first);
  return first;
}

/** The addresses of the tabs, in their order. */
async function tabUrls(browser: Browser): Promise<string[]> {
  return (await shellState(browser.shell)).tabs.map((tab) => tab.url);
}

test('keeps what was typed in the address bar of each tab until it is entered', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    await open(browser, `${server.origin}/index.html`);
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await shell.getByRole('button', { name: 'New tab' }).click();
    await open(browser, `${server.origin}/second.html`);
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    // Typed in the second tab, and not entered: the first tab still shows its own address.
    await address.click();
    await address.fill('typed in the second tab');
    await pressNative(browser, 'Tab', ['control']);
    await expect(shell.locator('[role="tab"][aria-selected="true"]')).toHaveAttribute(
      'title',
      'Fixture home',
    );
    await expect(address).toHaveValue(`${server.origin}/index.html`);
    await pressNative(browser, 'Tab', ['control']);
    await expect(address).toHaveValue('typed in the second tab');
    // Escape brings back the address of the page.
    await address.focus();
    await address.press('Escape');
    await expect(address).toHaveValue(`${server.origin}/second.html`);
  } finally {
    await browser.close();
  }
});

test('keeps what is typed right after a click on New tab for the new tab, however late the shell learns of it', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    const tabs = shell.getByRole('tab');
    const first = await openFirstPage(browser);
    const second = `${server.origin}/second.html`;
    // The browser answers at once, but its state with the new tab reaches the shell only
    // after the address bar was typed into.
    await delayShellState(browser, 600);
    await shell.getByRole('button', { name: 'New tab' }).click();
    await address.fill(second);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveValue(second);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    await expect.poll(() => tabUrls(browser)).toEqual([first, second]);
    // The tab that was active before kept its page and its address.
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveValue(first);
  } finally {
    await browser.close();
  }
});

test('loads what is entered right after a click on New tab in the new tab, also before the browser answered', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    const tabs = shell.getByRole('tab');
    const first = await openFirstPage(browser);
    const second = `${server.origin}/second.html`;
    // The state with the new tab reaches the shell before the answer to its request, and
    // both come after the address was typed and entered.
    await delayShellState(browser, 600);
    await delayNewTabAnswer(browser, 1200);
    await shell.getByRole('button', { name: 'New tab' }).click();
    await address.fill(second);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    await expect.poll(() => tabUrls(browser)).toEqual([first, second]);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveValue(second);
    // The tab that was active before kept its page and its address.
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveValue(first);
  } finally {
    await browser.close();
  }
});

for (const { clicks, stateFirst } of [
  { clicks: 1, stateFirst: true },
  { clicks: 1, stateFirst: false },
  { clicks: 2, stateFirst: true },
  { clicks: 2, stateFirst: false },
]) {
  const opens =
    clicks === 1
      ? 'a new tab opens and after it shows for that tab'
      : 'two new tabs open and after they show for the second one';
  const order = stateFirst
    ? 'the shell learns of a new tab before the browser answers'
    : 'the browser answers before the shell learns of a new tab';
  test(`keeps what is typed while ${opens}, when ${order}`, async () => {
    const browser = await launch();
    try {
      const shell = browser.shell;
      const address = shell.getByRole('textbox', { name: 'Address and search bar' });
      const tabs = shell.getByRole('tab');
      const first = await openFirstPage(browser);
      const second = `${server.origin}/second.html`;
      const typedBefore = second.slice(0, 10);
      await delayShellState(browser, 600);
      if (stateFirst) await delayNewTabAnswer(browser, 1200);
      for (let click = 0; click < clicks; click += 1) {
        await shell.getByRole('button', { name: 'New tab' }).click();
      }
      // Part of the address is typed before the shell knows of any new tab, the rest once
      // the tab of the last click shows.
      await address.fill(typedBefore);
      await expect(tabs.nth(clicks)).toHaveAttribute('aria-selected', 'true');
      await expect(address).toHaveValue(typedBefore);
      await shell.keyboard.type(second.slice(typedBefore.length));
      await expect(address).toHaveValue(second);
      await shell.keyboard.press('Enter');
      await waitForPage(browser, (url) => url.endsWith('/second.html'));
      const opened = Array.from({ length: clicks - 1 }, () => 'app://newtab/');
      await expect.poll(() => tabUrls(browser)).toEqual([first, ...opened, second]);
      // The tab of an earlier click shows the new tab page and nothing that was typed.
      if (clicks === 2) {
        await tabs.nth(1).click();
        await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
        await expect(address).toHaveValue('');
      }
      // The tab that was active before kept its page and its address.
      await tabs.nth(0).click();
      await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
      await expect(address).toHaveValue(first);
    } finally {
      await browser.close();
    }
  });
}

test('takes what is typed right after a click on New tab into the address bar of the new tab', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    const tabs = shell.getByRole('tab');
    const first = await openFirstPage(browser);
    const second = `${server.origin}/second.html`;
    // The keys are typed at once, without a click into the address bar, and before the
    // shell knows of the new tab.
    await delayShellState(browser, 600);
    await shell.getByRole('button', { name: 'New tab' }).click();
    await shell.keyboard.type(second);
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveValue(second);
    await shell.keyboard.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    await expect.poll(() => tabUrls(browser)).toEqual([first, second]);
    // The tab that was active before kept its page and its address.
    await tabs.nth(0).click();
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(address).toHaveValue(first);
  } finally {
    await browser.close();
  }
});

test('shows the host first and how secure the connection of the page is', async () => {
  const secure = createSecureServer(selfSignedCertificate(), (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Secure</title><p>Loaded securely</p>');
  });
  await new Promise<void>((done) => secure.listen(0, '127.0.0.1', done));
  const { port } = secure.address() as AddressInfo;
  const names = {
    'secure.astela-e2e.net': port,
    'plain.astela-e2e.net': new URL(server.origin).port,
  };
  const browser = await launch(mapTo(names), {
    settings: { 'privacy.httpsFirst': false },
  });
  try {
    await browser.main.evaluate(({ session }) => {
      session
        .fromPartition('persist:default')
        .setCertificateVerifyProc((request, callback) =>
          callback(request.hostname === 'secure.astela-e2e.net' ? 0 : -3),
        );
    });
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    await open(browser, 'https://secure.astela-e2e.net/page?q=1');
    await waitForPage(browser, (url) => url.startsWith('https://secure.astela-e2e.net/'));
    await expect(shell.getByRole('img', { name: 'Connection is secure' })).toBeVisible();
    // The field keeps the whole address; the view of it starts with the host, without https.
    await expect(address).toHaveValue('https://secure.astela-e2e.net/page?q=1');
    await expect(shell.locator('.url .host')).toHaveText('secure.astela-e2e.net');
    await expect(shell.locator('.url .rest')).toHaveText('/page?q=1');
    // Editing shows the address as it is.
    await address.focus();
    await expect(shell.locator('.url')).toHaveCount(0);
    await address.blur();
    // A site without encryption says so.
    await open(browser, 'http://plain.astela-e2e.net/index.html');
    await expect(shell.getByRole('img', { name: 'Not secure' })).toContainText('Not secure');
    // The browser's own pages say whose they are.
    await open(browser, 'app://settings');
    await expect(shell.getByRole('img', { name: 'Page of Astela' })).toBeVisible();
  } finally {
    await browser.close();
    await new Promise<void>((done) => secure.close(() => done()));
  }
});

test('shows that the active tab loads along the bottom of the toolbar', async () => {
  // A page that answers only when the test lets it.
  let answer: (() => void) | undefined;
  const slow: Server = createServer((_request, response) => {
    answer = () => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Slow</title><p>Here at last</p>');
    };
  });
  await new Promise<void>((done) => slow.listen(0, '127.0.0.1', done));
  const { port } = slow.address() as AddressInfo;
  const browser = await launch();
  try {
    const progress = browser.shell.locator('nav .progress');
    await open(browser, `http://127.0.0.1:${String(port)}/slow`);
    await expect(progress).toBeAttached();
    await expect.poll(() => answer !== undefined).toBe(true);
    answer?.();
    await waitForPage(browser, (url) => url.endsWith('/slow'));
    await expect(progress).toHaveCount(0);
  } finally {
    await browser.close();
    await new Promise<void>((done) => slow.close(() => done()));
  }
});
