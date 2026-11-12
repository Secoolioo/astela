import { expect, test } from '@playwright/test';
import { createServer as createSecureServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { launch, waitForPage, type Browser } from './harness.ts';
import { selfSignedCertificate } from './tls.ts';

/** The requests that reached the server, with the cookies they carried. */
const seen: string[] = [];

const server = createSecureServer(selfSignedCertificate(), (request, response) => {
  const host = (request.headers.host ?? '').split(':')[0] ?? '';
  seen.push(`${host}${request.url ?? ''} ${request.headers.cookie ?? '-'}`);
  const port = (server.address() as AddressInfo).port;
  const other = `https://pixel.astela-third.test:${String(port)}`;
  response.setHeader('Content-Type', 'text/html');
  // Every load asks the server again, so the requests show the cookies of each load.
  response.setHeader('Cache-Control', 'no-store');
  if (request.url === '/pixel') {
    response.setHeader('Set-Cookie', 'fresh=1; SameSite=None; Secure; Path=/');
    response.end('');
  } else if (request.url === '/frame') {
    // The frame also reads and writes cookies through a frame of its own without an address,
    // and reads its cookies with the method of that frame's document.
    response.end(`<!doctype html><title>Frame</title><body><script>
const child = document.body.appendChild(document.createElement('iframe'));
child.contentDocument.cookie = 'child=1; SameSite=None; Secure; Path=/';
const read = Object.getOwnPropertyDescriptor(child.contentWindow.Document.prototype, 'cookie').get;
document.title = \`cookies:\${document.cookie}|child:\${child.contentDocument.cookie}|method:\${read.call(document)}\`;
</script></body>`);
  } else if (request.url === '/worker') {
    response.end(`<!doctype html><title>Worker</title><script>
navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((registration) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => { document.title = \`worker:\${event.data}\`; };
  registration.active.postMessage('fetch', [channel.port2]);
}, (error) => { document.title = \`worker failed:\${error}\`; });
</script>`);
  } else if (request.url === '/sw.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(
      "self.onmessage = async (event) => { const answer = await fetch('/echo', { credentials: 'include' }); event.ports[0].postMessage(await answer.text()); };",
    );
  } else if (request.url === '/echo') {
    response.setHeader('Set-Cookie', 'worker=1; SameSite=None; Secure; Path=/');
    response.end(request.headers.cookie ?? '-');
  } else {
    response.end(
      `<!doctype html><title>First</title><img src="${other}/pixel"><iframe src="${other}/frame"></iframe><iframe src="${other}/worker"></iframe>`,
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

/** The title of an embedded frame, which names the cookies its script finds. */
function frameTitle(browser: Browser, path = '/frame'): Promise<string | undefined> {
  return browser.main.evaluate(({ webContents }, end) => {
    const page = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().endsWith('/page'));
    const frame = page?.mainFrame.frames.find((child) => child.url.endsWith(end));
    return frame?.executeJavaScript('document.title') as Promise<string> | undefined;
  }, path);
}

const cookiesOf = (browser: Browser): Promise<string[]> =>
  browser.main.evaluate(async ({ session }) =>
    (await session.fromPartition('persist:default').cookies.get({}))
      .map((cookie) => cookie.name)
      .toSorted(),
  );

test('keeps cookies away from requests, responses, frames and workers of other sites', async () => {
  seen.length = 0;
  const browser = await start();
  try {
    await openFirst(browser);
    await expect.poll(() => frameTitle(browser)).toBe('cookies:|child:|method:');
    expect(seen).toContain('pixel.astela-third.test/pixel -');
    expect(seen).toContain('pixel.astela-third.test/frame -');
    // A service worker of the other site sends no cookies and stores none either.
    await expect.poll(() => frameTitle(browser, '/worker'), { timeout: 15_000 }).toBe('worker:-');
    expect(await cookiesOf(browser)).toEqual(['tracker']);
  } finally {
    await browser.close();
  }
});

test('lets other sites use cookies when the setting allows them, and blocks them again at once', async () => {
  seen.length = 0;
  const browser = await start({ 'privacy.blockThirdPartyCookies': false });
  try {
    await openFirst(browser);
    await expect.poll(() => frameTitle(browser)).toMatch(/^cookies:.*tracker=1/);
    expect(seen).toContain('pixel.astela-third.test/pixel tracker=1');
    await expect
      .poll(() => cookiesOf(browser), { timeout: 15_000 })
      .toEqual(['child', 'fresh', 'tracker', 'worker']);
    // Turned on, blocking applies to the next requests and frames at once; Chromium's own
    // blocking, which also covers frames without an address, follows with a restart.
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings/#privacy.blockThirdPartyCookies');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('switch', { name: 'Block third-party cookies' }).check();
    await expect(settings.getByText('Takes effect after a restart')).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Restart now' })).toBeVisible();
    seen.length = 0;
    await openFirst(browser);
    await expect.poll(() => frameTitle(browser)).toMatch(/^cookies:\|/);
    expect(seen).toContain('pixel.astela-third.test/pixel -');
    expect(seen).toContain('pixel.astela-third.test/frame -');
  } finally {
    await browser.close();
  }
});
