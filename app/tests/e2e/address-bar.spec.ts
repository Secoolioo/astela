import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { FixtureServer, launch, pressNative, waitForPage, type Browser } from './harness.ts';
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
