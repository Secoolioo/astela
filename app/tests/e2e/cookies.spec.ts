import { expect, test } from '@playwright/test';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { launch, type Browser } from './harness.ts';
import { selfSignedCertificate } from './tls.ts';

/** The requests that reached the server, with the cookies they carried. */
const seen: string[] = [];

const server = createSecureServer(selfSignedCertificate(), (request, response) => {
  const host = (request.headers.host ?? '').split(':')[0] ?? '';
  seen.push(`${host}${request.url ?? ''} ${request.headers.cookie ?? '-'}`);
  const port = (server.address() as AddressInfo).port;
  const other = `https://pixel.astela-third.test:${String(port)}`;
  response.setHeader('Content-Type', 'text/html');
  if (request.url === '/pixel') {
    response.setHeader('Set-Cookie', 'fresh=1; SameSite=None; Secure; Path=/');
    response.end('');
  } else if (request.url === '/frame') {
    response.end(
      '<!doctype html><title>Frame</title><script>document.title = `cookies:${document.cookie}`;</script>',
    );
  } else {
    response.end(
      `<!doctype html><title>First</title><img src="${other}/pixel"><iframe src="${other}/frame"></iframe>`,
    );
  }
});

test.beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
});
test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

/**
 * Starts the browser with the names of two sites at the server, a cookie of the other site,
 * and trust in the test's certificate. Names under `.test` exist only here.
 */
async function start(settings: Record<string, unknown> = {}): Promise<Browser> {
  const port = (server.address() as AddressInfo).port;
  const browser = await launch(
    [`--host-resolver-rules=MAP *.test 127.0.0.1:${String(port)}`, '--no-proxy-server'],
    { settings },
  );
  await browser.main.evaluate(async ({ session }, p) => {
    const web = session.fromPartition('persist:default');
    // The test's certificate is not trusted; the session accepts it for the test's names.
    web.setCertificateVerifyProc((request, callback) =>
      callback(request.hostname.endsWith('.test') ? 0 : -3),
    );
    await web.cookies.set({
      url: `https://pixel.astela-third.test:${String(p)}/`,
      name: 'tracker',
      value: '1',
      secure: true,
      sameSite: 'no_restriction',
    });
  }, port);
  return browser;
}

async function openFirst(browser: Browser): Promise<void> {
  const port = (server.address() as AddressInfo).port;
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`https://page.astela-first.test:${String(port)}/page`);
  await address.press('Enter');
}

/** The title of the embedded frame, which names the cookies its script finds. */
function frameTitle(browser: Browser): Promise<string | undefined> {
  return browser.main.evaluate(({ webContents }) => {
    const page = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().endsWith('/page'));
    const frame = page?.mainFrame.frames.find((child) => child.url.endsWith('/frame'));
    return frame?.executeJavaScript('document.title') as Promise<string> | undefined;
  });
}

const cookiesOf = (browser: Browser): Promise<string[]> =>
  browser.main.evaluate(async ({ session }) =>
    (await session.fromPartition('persist:default').cookies.get({}))
      .map((cookie) => cookie.name)
      .toSorted(),
  );

test('keeps cookies away from requests, responses and frames of other sites', async () => {
  seen.length = 0;
  const browser = await start();
  try {
    await openFirst(browser);
    await expect.poll(() => frameTitle(browser)).toBe('cookies:');
    expect(seen).toContain('pixel.astela-third.test/pixel -');
    expect(seen).toContain('pixel.astela-third.test/frame -');
    expect(await cookiesOf(browser)).toEqual(['tracker']);
  } finally {
    await browser.close();
  }
});

test('lets other sites use cookies when the setting allows them', async () => {
  seen.length = 0;
  const browser = await start({ 'privacy.blockThirdPartyCookies': false });
  try {
    await openFirst(browser);
    await expect.poll(() => frameTitle(browser)).toMatch(/tracker=1/);
    expect(seen).toContain('pixel.astela-third.test/pixel tracker=1');
    await expect.poll(() => cookiesOf(browser)).toEqual(['fresh', 'tracker']);
  } finally {
    await browser.close();
  }
});

test('lets other sites use cookies on the pages of a site in the list', async () => {
  seen.length = 0;
  const browser = await start({ 'privacy.thirdPartyCookieSites': ['astela-first.test'] });
  try {
    await openFirst(browser);
    await expect.poll(() => frameTitle(browser)).toMatch(/tracker=1/);
  } finally {
    await browser.close();
  }
});
