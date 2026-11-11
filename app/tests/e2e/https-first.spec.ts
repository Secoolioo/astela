import { expect, test } from '@playwright/test';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { FixtureServer, launch, waitForPage, type Browser } from './harness.ts';
import { selfSignedCertificate } from './tls.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/**
 * Leads a name of the test to a server on this computer, on every port. A proxy of the
 * environment would not know the name, so the browser connects directly.
 */
const mapTo = (name: string, port: number | string): string[] => [
  `--host-resolver-rules=MAP ${name} 127.0.0.1:${String(port)}`,
  '--no-proxy-server',
];

/** The port of the fixture server, which serves only insecure addresses. */
const insecurePort = (): string => new URL(server.origin).port;

async function open(browser: Browser, url: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
}

test('warns before a site without a secure connection and continues only when asked', async () => {
  // The name leads to the fixture server on every port, so its secure address does not load.
  const browser = await launch(mapTo('plain.astela-e2e.net', insecurePort()));
  try {
    await open(browser, 'http://plain.astela-e2e.net/index.html');
    const problem = browser.shell.getByRole('region', {
      name: 'This site has no secure connection',
    });
    await expect(problem).toBeVisible();
    await expect(problem).toContainText(
      'plain.astela-e2e.net does not support a secure connection',
    );
    // The address bar shows the address that was asked for, not the secure one that failed.
    await expect(
      browser.shell.getByRole('textbox', { name: 'Address and search bar' }),
    ).toHaveValue('http://plain.astela-e2e.net/index.html');
    await problem.getByRole('button', { name: 'Continue to plain.astela-e2e.net' }).click();
    await expect(problem).toBeHidden();
    const page = await waitForPage(
      browser,
      (url) => url === 'http://plain.astela-e2e.net/index.html',
    );
    await expect(page).toHaveTitle('Fixture home');
    // The site keeps its insecure address for the rest of the session.
    await open(browser, 'http://plain.astela-e2e.net/second.html');
    await waitForPage(browser, (url) => url === 'http://plain.astela-e2e.net/second.html');
    await expect(problem).toBeHidden();
  } finally {
    await browser.close();
  }
});

test('loads the secure address of a site that has one', async () => {
  const secure = createSecureServer(selfSignedCertificate(), (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Secure</title><p>Loaded securely</p>');
  });
  await new Promise<void>((done) => secure.listen(0, '127.0.0.1', done));
  const { port } = secure.address() as AddressInfo;
  // Without the upgrade, the secure server gets an insecure request and fails.
  const browser = await launch(mapTo('secure.astela-e2e.net', port));
  try {
    // The test's certificate is not trusted; the session of web pages accepts it for this name
    // only, so that the test is about the upgrade.
    await browser.main.evaluate(({ session }) => {
      session
        .fromPartition('persist:default')
        .setCertificateVerifyProc((request, callback) =>
          callback(request.hostname === 'secure.astela-e2e.net' ? 0 : -3),
        );
    });
    await open(browser, 'http://secure.astela-e2e.net/page');
    const page = await waitForPage(browser, (url) => url === 'https://secure.astela-e2e.net/page');
    await expect(page.getByText('Loaded securely')).toBeVisible();
  } finally {
    await browser.close();
    await new Promise<void>((done) => secure.close(() => done()));
  }
});

test('loads insecure addresses as they are when the setting is off', async () => {
  const browser = await launch(mapTo('plain.astela-e2e.net', insecurePort()), {
    settings: { 'privacy.httpsFirst': false },
  });
  try {
    await open(browser, 'http://plain.astela-e2e.net/index.html');
    const page = await waitForPage(
      browser,
      (url) => url === 'http://plain.astela-e2e.net/index.html',
    );
    await expect(page).toHaveTitle('Fixture home');
  } finally {
    await browser.close();
  }
});
