import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createSecureServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import {
  FixtureServer,
  launch,
  overlayAttached,
  overlayPage,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';
import { certificateChain, selfSignedCertificate } from './tls.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** The port of the fixture server, which serves only insecure addresses. */
const fixturePort = (): string => new URL(server.origin).port;

/** Leads names of the test to servers on this computer. */
const mapTo = (names: Readonly<Record<string, number | string>>): string[] => [
  `--host-resolver-rules=${Object.entries(names)
    .map(([name, port]) => `MAP ${name} 127.0.0.1:${String(port)}`)
    .join(',')}`,
  '--no-proxy-server',
];

/**
 * A server with a certificate of the test, which no browser trusts, and the certificate, the
 * first one that it sends.
 */
async function secureServer(pair = selfSignedCertificate()): Promise<{
  server: Server;
  port: number;
  certificate: X509Certificate;
  close: () => Promise<void>;
}> {
  const secure = createSecureServer(pair, (request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Secure page</title><p>Loaded ${request.url ?? ''}</p>`);
  });
  await new Promise<void>((done) => secure.listen(0, '127.0.0.1', done));
  return {
    server: secure,
    port: (secure.address() as AddressInfo).port,
    certificate: new X509Certificate(pair.cert),
    close: () =>
      new Promise<void>((done) => {
        secure.closeAllConnections();
        secure.close(() => done());
      }),
  };
}

async function open(browser: Browser, url: string, shell = browser.shell): Promise<void> {
  const address = shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
}

/** Opens site information with a click on the chip of the connection, and returns it. */
async function siteInfo(
  browser: Browser,
  chip: string,
  shell = browser.shell,
  except: readonly Page[] = [],
): Promise<Locator> {
  await shell.getByRole('button', { name: chip, exact: true }).click();
  const overlay = await overlayPage(browser, except);
  const dialog = overlay.getByRole('dialog', { name: 'Site information' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The settings that the browser saved in the profile. */
function saved(browser: Browser): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(browser.profile, 'data', 'settings.json'), 'utf8'),
    );
    return typeof parsed === 'object' && parsed !== null && 'user' in parsed
      ? (parsed.user as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The decisions that the settings keep for the sites. */
function savedSites(browser: Browser): Record<string, Record<string, string>> {
  return (saved(browser)['permissions.sites'] ?? {}) as Record<string, Record<string, string>>;
}

/** A date as site information writes it in English. */
const date = (text: string): string =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(text));

test('opens site information from the chip of a secure page with its certificate', async () => {
  const secure = await secureServer();
  // Chromium checks the test's certificate as always, which site information notes, and lets
  // the page load as if it were trusted.
  const browser = await launch([
    ...mapTo({ 'secure.astela-e2e.net': secure.port }),
    '--ignore-certificate-errors',
  ]);
  try {
    await open(browser, 'https://secure.astela-e2e.net/page');
    const page = await waitForPage(browser, (url) => url === 'https://secure.astela-e2e.net/page');
    await expect(page.getByText('Loaded /page')).toBeVisible();
    const chip = browser.shell.getByRole('button', { name: 'Connection is secure' });
    await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(chip).toHaveAttribute('title', 'Site information');
    const dialog = await siteInfo(browser, 'Connection is secure');
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('heading', { name: 'secure.astela-e2e.net' })).toBeVisible();
    await expect(dialog).toContainText(
      'What you send to this site, such as passwords, travels encrypted.',
    );
    await expect(dialog).toContainText('Issued to Astela test');
    await expect(dialog).toContainText('Issued by Astela test');
    await expect(dialog).toContainText(`Valid until ${date(secure.certificate.validTo)}`);
    // Chromium did not trust the certificate itself, so nothing is said about its root.
    await expect(dialog).not.toContainText('was added to this computer');
    // The dialog has the focus, not one of its controls.
    await expect(dialog).toBeFocused();
    // The details show when and how long it is valid, and its fingerprint.
    const fingerprint = dialog.locator('.fingerprint');
    await expect(fingerprint).toBeHidden();
    await dialog.getByText('Details').click();
    await expect(dialog).toContainText(`Valid from ${date(secure.certificate.validFrom)}`);
    await expect(fingerprint).toHaveText(secure.certificate.fingerprint256);
    // Escape closes it and gives the focus back to the page.
    await dialog.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    // Opened with the keyboard, it gives the focus back to the chip.
    await chip.focus();
    await chip.press('Enter');
    const again = (await overlayPage(browser)).getByRole('dialog', { name: 'Site information' });
    await expect(again).toBeFocused();
    await again.press('Escape');
    await expect(chip).toBeFocused();
  } finally {
    await browser.close();
    await secure.close();
  }
});

test('shows the fingerprint of the certificate itself for a certificate that an authority issued', async () => {
  const chain = certificateChain();
  const secure = await secureServer(chain);
  const browser = await launch([
    ...mapTo({ 'chain.astela-e2e.net': secure.port }),
    '--ignore-certificate-errors',
  ]);
  try {
    await open(browser, 'https://chain.astela-e2e.net/page');
    const page = await waitForPage(browser, (url) => url === 'https://chain.astela-e2e.net/page');
    await expect(page.getByText('Loaded /page')).toBeVisible();
    const dialog = await siteInfo(browser, 'Connection is secure');
    await expect(dialog).toContainText('Issued to Astela test site');
    await expect(dialog).toContainText('Issued by Astela test authority');
    await dialog.getByText('Details').click();
    // The fingerprint is the SHA-256 of the certificate itself, as other browsers and openssl
    // show it, also with the certificate of an authority after it.
    await expect(dialog.locator('.fingerprint')).toHaveText(
      new X509Certificate(chain.leaf).fingerprint256,
    );
    await expect(dialog.getByRole('listitem')).toHaveText(['Astela test authority']);
  } finally {
    await browser.close();
    await secure.close();
  }
});

test('shows no certificate that Chromium refused for another port under a secure page', async () => {
  const trusted = await secureServer();
  const other = await secureServer(selfSignedCertificate('Astela other'));
  // Chromium connects the certificate of the list without a check, so the log notes none for
  // the page, and checks the other one, which it refuses.
  const spki = createHash('sha256')
    .update(trusted.certificate.publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
  const browser = await launch([
    '--host-resolver-rules=MAP nas.astela-e2e.net 127.0.0.1',
    '--no-proxy-server',
    `--ignore-certificate-errors-spki-list=${spki}`,
  ]);
  try {
    const address = `https://nas.astela-e2e.net:${String(trusted.port)}/page`;
    await open(browser, address);
    const page = await waitForPage(browser, (url) => url === address);
    await expect(page.getByText('Loaded /page')).toBeVisible();
    // A request of the page to another port of its host meets the other certificate.
    const fetched = await page.evaluate(
      (port) =>
        fetch(`https://nas.astela-e2e.net:${port}/`, { mode: 'no-cors' }).then(
          () => 'loaded',
          () => 'refused',
        ),
      String(other.port),
    );
    expect(fetched).toBe('refused');
    const dialog = await siteInfo(browser, 'Connection is secure');
    await expect(dialog).toContainText('Astela did not see the certificate of this page');
    await expect(dialog).not.toContainText('Astela other');
    await dialog.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);

    // The warning of the other port shows the certificate that it refused.
    await open(browser, `https://nas.astela-e2e.net:${String(other.port)}/`);
    const problem = browser.shell.getByRole('region', { name: "Your connection isn't private" });
    await expect(problem).toBeVisible({ timeout: 30_000 });
    const warning = await siteInfo(browser, 'Not secure');
    await expect(warning).toContainText('Issued to Astela other');
  } finally {
    await browser.close();
    await trusted.close();
    await other.close();
  }
});

test('explains a page without encryption, a page on this computer and a certificate warning', async () => {
  const secure = await secureServer();
  const browser = await launch(
    mapTo({ 'plain.astela-e2e.net': fixturePort(), 'untrusted.astela-e2e.net': secure.port }),
    { settings: { 'privacy.httpsFirst': false } },
  );
  try {
    await open(browser, 'http://plain.astela-e2e.net/index.html');
    await waitForPage(browser, (url) => url === 'http://plain.astela-e2e.net/index.html');
    const plain = await siteInfo(browser, 'Not secure');
    await expect(plain.getByRole('heading', { name: 'plain.astela-e2e.net' })).toBeVisible();
    await expect(plain).toContainText('Not secure');
    await expect(plain).toContainText('Your connection to this site is not encrypted.');
    await expect(plain.getByRole('heading', { name: 'Certificate' })).toHaveCount(0);
    await plain.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);

    // A page that this computer serves has a chip of its own now.
    await open(browser, `${server.origin}/index.html`);
    await waitForPage(browser, (url) => url === `${server.origin}/index.html`);
    const local = await siteInfo(browser, 'Page on this computer');
    await expect(local).toContainText(
      'This page comes from this computer, so its connection does not leave it.',
    );
    await expect(local.getByRole('heading', { name: 'Permissions' })).toBeVisible();
    await local.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);

    // A warning about a certificate names why it is not trusted and whom it was issued to,
    // and shows nothing of a page. Windows may look for the issuer on the network first.
    await open(browser, 'https://untrusted.astela-e2e.net/');
    const problem = browser.shell.getByRole('region', { name: "Your connection isn't private" });
    await expect(problem).toBeVisible({ timeout: 30_000 });
    const warning = await siteInfo(browser, 'Not secure');
    await expect(warning.getByRole('heading', { name: 'untrusted.astela-e2e.net' })).toBeVisible();
    await expect(warning).toContainText('The certificate of this site is not trusted');
    await expect(warning).toContainText('It was issued by an authority that is not trusted.');
    await expect(warning).toContainText('Issued to Astela test');
    await expect(warning.getByRole('heading', { name: 'Permissions' })).toHaveCount(0);
    await expect(warning.getByRole('heading', { name: 'Cookies and site data' })).toHaveCount(0);
  } finally {
    await browser.close();
    await secure.close();
  }
});

test('turns the warning back on for an accepted certificate and HTTPS-First back on for a site opened without it', async () => {
  const secure = await secureServer();
  const browser = await launch(
    mapTo({ 'plain.astela-e2e.net': fixturePort(), 'untrusted.astela-e2e.net': secure.port }),
  );
  try {
    const certificateWarning = browser.shell.getByRole('region', {
      name: "Your connection isn't private",
    });
    await open(browser, 'https://untrusted.astela-e2e.net/');
    await expect(certificateWarning).toBeVisible({ timeout: 30_000 });
    await certificateWarning.getByText('Details').click();
    await certificateWarning
      .getByRole('button', { name: 'Continue to untrusted.astela-e2e.net' })
      .click();
    const page = await waitForPage(browser, (url) => url === 'https://untrusted.astela-e2e.net/');
    await expect(page.getByText('Loaded /')).toBeVisible();
    const accepted = await siteInfo(browser, 'Not secure');
    await expect(accepted).toContainText(
      'You continued although the certificate of this site is not trusted. This holds until you quit Astela.',
    );
    await expect(accepted).toContainText('Issued to Astela test');
    await accepted.getByRole('button', { name: 'Turn the warning back on' }).click();
    // The page loads again over a new connection, and the warning is back.
    await expect(certificateWarning).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => overlayAttached(browser)).toBe(false);

    const httpsWarning = browser.shell.getByRole('region', {
      name: 'This site has no secure connection',
    });
    await open(browser, 'http://plain.astela-e2e.net/index.html');
    await expect(httpsWarning).toBeVisible();
    // The warning of HTTPS-First is not secure either.
    const insecure = await siteInfo(browser, 'Not secure');
    await expect(insecure).toContainText('Your connection to this site is not encrypted.');
    await insecure.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await httpsWarning.getByRole('button', { name: 'Continue to plain.astela-e2e.net' }).click();
    await waitForPage(browser, (url) => url === 'http://plain.astela-e2e.net/index.html');
    await expect(httpsWarning).toBeHidden();
    const allowed = await siteInfo(browser, 'Not secure');
    await expect(allowed).toContainText(
      'You opened this site without a secure connection. This holds until you quit Astela.',
    );
    await allowed.getByRole('button', { name: 'Use a secure connection again' }).click();
    await expect(httpsWarning).toBeVisible();
  } finally {
    await browser.close();
    await secure.close();
  }
});

test('changes and resets the permissions of a site from site information', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/permissions.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (current) => current === url);
    const asked = page.evaluate(() => Notification.requestPermission());
    const overlay = await overlayPage(browser);
    const question = overlay.getByRole('dialog', { name: `${new URL(url).host} wants to` });
    await question.getByRole('button', { name: 'Allow' }).click();
    expect(await asked).toBe('granted');
    await expect
      .poll(() => savedSites(browser)[server.origin])
      .toEqual({
        notifications: 'allow',
      });

    const dialog = await siteInfo(browser, 'Page on this computer');
    const notifications = dialog.getByRole('switch', { name: 'Notifications' });
    await expect(notifications).toBeChecked();
    await notifications.click();
    await expect(notifications).not.toBeChecked();
    await expect
      .poll(() => savedSites(browser)[server.origin])
      .toEqual({
        notifications: 'block',
      });
    await expect(dialog).toContainText('Reload the page to use the changed permissions.');
    await dialog.getByRole('button', { name: 'Reload' }).click();
    await expect(dialog).not.toContainText('Reload the page to use the changed permissions.');
    await expect
      .poll(() => page.evaluate(() => Notification.permission).catch(() => undefined))
      .toBe('denied');

    // Resetting forgets the site, which asks again.
    await dialog.getByRole('button', { name: 'Reset permissions' }).click();
    await expect(dialog).toContainText('This site has not asked for permissions yet.');
    await expect(notifications).toHaveCount(0);
    await expect.poll(() => savedSites(browser)[server.origin]).toBeUndefined();
    await dialog.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    const askedAgain = page.evaluate(() => Notification.requestPermission());
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Block' }).click();
    expect(await askedAgain).toBe('denied');
  } finally {
    await browser.close();
  }
});

test('changes and resets the decision about the pop-ups of a site from site information', async () => {
  const browser = await launch([], {
    settings: { 'permissions.sites': { [server.origin]: { popups: 'allow' } } },
  });
  try {
    const url = `${server.origin}/permissions.html`;
    await open(browser, url);
    await waitForPage(browser, (current) => current === url);
    const dialog = await siteInfo(browser, 'Page on this computer');
    const popups = dialog.getByRole('switch', { name: 'Pop-ups' });
    await expect(popups).toBeChecked();
    await popups.click();
    await expect(popups).not.toBeChecked();
    await expect.poll(() => savedSites(browser)[server.origin]).toEqual({ popups: 'block' });
    // The page follows a decision about its pop-ups without a reload.
    await expect(dialog).not.toContainText('Reload the page to use the changed permissions.');
    await popups.click();
    await expect.poll(() => savedSites(browser)[server.origin]).toEqual({ popups: 'allow' });

    // Resetting forgets the decision, and the site's windows need a click again.
    await dialog.getByRole('button', { name: 'Reset permissions' }).click();
    await expect(dialog).toContainText('This site has not asked for permissions yet.');
    await expect(popups).toHaveCount(0);
    await expect.poll(() => savedSites(browser)[server.origin]).toBeUndefined();
    await expect(dialog).not.toContainText('Reload the page to use the changed permissions.');
    await dialog.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await open(browser, `${server.origin}/popunder.html?ways=onload`);
    await expect(
      browser.shell.getByRole('button', { name: 'Pop-up blocked', exact: true }),
    ).toBeVisible();
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  } finally {
    await browser.close();
  }
});

test('keeps Tab and Shift+Tab inside site information', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/index.html`;
    await open(browser, url);
    await waitForPage(browser, (current) => current === url);
    const dialog = await siteInfo(browser, 'Page on this computer');
    const overlay = await overlayPage(browser);
    const first = dialog.getByRole('button', { name: 'Delete cookies and site data…' });
    const last = dialog.getByRole('button', { name: 'Site permissions in the settings' });
    await expect(dialog).toBeFocused();
    // From the dialog itself, which has the focus once it opened, Shift+Tab goes to its last
    // control, and Tab goes round from there.
    await overlay.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await overlay.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await overlay.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await overlay.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('switch', { name: 'Block ads on 127.0.0.1' })).toBeFocused();
  } finally {
    await browser.close();
  }
});

test('opens the permissions of sites in the settings from site information', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/permissions.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (current) => current === url);
    const asked = page.evaluate(() => Notification.requestPermission());
    await (
      await overlayPage(browser)
    )
      .getByRole('dialog', { name: `${new URL(url).host} wants to` })
      .getByRole('button', { name: 'Allow' })
      .click();
    expect(await asked).toBe('granted');
    const dialog = await siteInfo(browser, 'Page on this computer');
    await dialog.getByRole('button', { name: 'Site permissions in the settings' }).click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    const settings = await waitForPage(browser, (current) => current.startsWith('app://settings'));
    expect(new URL(settings.url()).hash).toBe('#permissions.sites');
    // The settings open in a tab of their own, which shows, at the site's row.
    const state = await shellState(browser.shell);
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.url).toMatch(
      /^app:\/\/settings/,
    );
    const row = settings.getByRole('combobox', { name: `Notifications for ${server.origin}` });
    await expect(row).toHaveValue('allow');
    await expect(row).toBeInViewport();
  } finally {
    await browser.close();
  }
});

/** The shells of the private windows, or of the regular ones. */
async function shells(browser: Browser, privateWindow: boolean): Promise<Page[]> {
  const found: Page[] = [];
  for (const page of browser.cdp.contexts().flatMap((context) => context.pages())) {
    if (page.isClosed() || !page.url().startsWith('app://shell')) continue;
    try {
      if ((await shellState(page)).private === privateWindow) found.push(page);
    } catch {
      // A shell that loads or closes tells nothing yet.
    }
  }
  return found;
}

/** Opens a private window with its shortcut while no other is open, and returns its shell. */
async function openPrivate(browser: Browser): Promise<Page> {
  await expect.poll(async () => (await shells(browser, true)).length).toBe(0);
  await pressNative(browser, 'N', ['primary', 'shift']);
  await expect.poll(async () => (await shells(browser, true)).length).toBe(1);
  const [shell] = await shells(browser, true);
  if (shell === undefined) throw new Error('No private window');
  return shell;
}

/** The overlays of the windows that are open now. */
function overlays(browser: Browser): Page[] {
  return browser.cdp
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed() && page.url().startsWith('app://overlay'));
}

test('keeps the permissions of a private window in the private window', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/permissions.html`;
    const before = overlays(browser);
    const shell = await openPrivate(browser);
    await open(browser, url, shell);
    const page = await waitForPage(browser, (current) => current === url);
    const asked = page.evaluate(() => Notification.requestPermission());
    const overlay = await overlayPage(browser, before);
    await overlay
      .getByRole('dialog', { name: `${new URL(url).host} wants to` })
      .getByRole('button', { name: 'Allow' })
      .click();
    expect(await asked).toBe('granted');
    const dialog = await siteInfo(browser, 'Page on this computer', shell, before);
    await expect(dialog.getByRole('switch', { name: 'Notifications' })).toBeChecked();
    await expect(dialog).toContainText(
      'Private windows forget these answers when the last private window closes.',
    );
    // Switching it off changes the private window's answer only.
    await dialog.getByRole('switch', { name: 'Notifications' }).click();
    await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('denied');
    expect(savedSites(browser)[server.origin]).toBeUndefined();
    await dialog.press('Escape');

    // The next private window has forgotten the answer.
    await browser.main.evaluate(({ BaseWindow }) => {
      for (const window of BaseWindow.getAllWindows()) if (window.id !== 1) window.close();
    });
    await expect.poll(async () => (await shells(browser, true)).length).toBe(0);
    const later = overlays(browser);
    const next = await openPrivate(browser);
    await open(browser, url, next);
    await expect
      .poll(async () => (await shellState(next)).tabs.find((tab) => tab.url === url)?.loading)
      .toBe(false);
    const forgotten = await siteInfo(browser, 'Page on this computer', next, later);
    await expect(forgotten).toContainText('This site has not asked for permissions yet.');
    await expect(forgotten.getByRole('switch', { name: 'Notifications' })).toHaveCount(0);
    expect(savedSites(browser)[server.origin]).toBeUndefined();
  } finally {
    await browser.close();
  }
});

test('counts and deletes the cookies and data of a site after a confirmation', async () => {
  const browser = await launch(['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server']);
  try {
    const url = `${server.origin}/index.html`;
    // The same site in a private window keeps its cookies, as another site does.
    const privateShell = await openPrivate(browser);
    await open(browser, url, privateShell);
    const privatePage = await waitForPage(browser, (current) => current === url);
    await privatePage.evaluate(() => {
      document.cookie = 'private=1; path=/';
    });
    await browser.main.evaluate(({ BaseWindow }) => BaseWindow.fromId(1)?.focus());
    await expect
      .poll(() => browser.main.evaluate(({ BaseWindow }) => BaseWindow.fromId(1)?.isFocused()))
      .toBe(true);
    await open(browser, url);
    await expect
      .poll(
        () =>
          browser.cdp
            .contexts()
            .flatMap((context) => context.pages())
            .filter((candidate) => candidate.url() === url && candidate !== privatePage).length,
      )
      .toBe(1);
    const page = browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === url && candidate !== privatePage);
    if (page === undefined) throw new Error('No page');
    await page.evaluate(() => {
      document.cookie = 'kept=1; path=/';
      localStorage.setItem('note', 'kept');
    });
    await browser.main.evaluate(
      ({ session }, port) =>
        session
          .fromPartition('persist:default')
          .cookies.set({ url: `http://other.test:${port}/`, name: 'other', value: '1' }),
      fixturePort(),
    );

    const dialog = await siteInfo(browser, 'Page on this computer');
    await expect(dialog).toContainText('Cookies of this site: 1');
    await dialog.getByRole('button', { name: 'Delete cookies and site data…' }).click();
    await expect(dialog).toContainText('This signs you out of 127.0.0.1.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).not.toContainText('This signs you out of');
    expect(await page.evaluate(() => document.cookie)).toBe('kept=1');
    await dialog.getByRole('button', { name: 'Delete cookies and site data…' }).click();
    const deleteNow = dialog.getByRole('button', { name: 'Delete', exact: true });
    await expect(deleteNow).toBeFocused();
    await deleteNow.click();
    await expect(dialog).toContainText('The cookies and site data of 127.0.0.1 are deleted.');
    await expect(dialog).toContainText('Cookies of this site: 0');
    await page.reload();
    expect(await page.evaluate(() => document.cookie)).toBe('');
    expect(await page.evaluate(() => localStorage.getItem('note'))).toBeNull();
    const others = await browser.main.evaluate(
      ({ session }, port) =>
        session
          .fromPartition('persist:default')
          .cookies.get({ url: `http://other.test:${port}/` })
          .then((cookies) => cookies.map((cookie) => cookie.name)),
      fixturePort(),
    );
    expect(others).toEqual(['other']);
    expect(await privatePage.evaluate(() => document.cookie)).toBe('private=1');
  } finally {
    await browser.close();
  }
});

test('keeps the question about deleting open while site information follows the page, also after a deletion', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/blocker.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (current) => current === url);
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: 2 blocked' }),
    ).toBeVisible();
    await page.evaluate(() => {
      document.cookie = 'first=1; path=/';
    });
    const dialog = await siteInfo(browser, 'Page on this computer');
    const ask = dialog.getByRole('button', { name: 'Delete cookies and site data…' });
    const deleteNow = dialog.getByRole('button', { name: 'Delete', exact: true });
    await ask.click();
    await deleteNow.click();
    await expect(dialog).toContainText('The cookies and site data of 127.0.0.1 are deleted.');
    await expect(deleteNow).toHaveCount(0);
    await page.evaluate(() => {
      document.cookie = 'second=1; path=/';
    });
    // Asked again after a deletion, the question stays while the page blocks one more request,
    // which site information shows.
    await ask.click();
    await expect(deleteNow).toBeFocused();
    await page.evaluate(() => {
      const image = new Image();
      image.src = `fixture-tracker.gif?again=${String(Date.now())}`;
      document.body.append(image);
    });
    await expect(dialog).toContainText('3 blocked on this page');
    await expect(dialog).toContainText('This signs you out of 127.0.0.1.');
    await expect(deleteNow).toBeFocused();
    await deleteNow.click();
    await expect(deleteNow).toHaveCount(0);
    await expect(dialog).toContainText('The cookies and site data of 127.0.0.1 are deleted.');
    const left = await browser.main.evaluate(
      ({ session }, address) =>
        session
          .fromPartition('persist:default')
          .cookies.get({ url: address })
          .then((cookies) => cookies.map((cookie) => cookie.name)),
      url,
    );
    expect(left).toEqual([]);
    // The focus stays in site information, on the button that asks.
    await expect(ask).toBeFocused();
  } finally {
    await browser.close();
  }
});

test('counts and deletes the cookies of the whole site, and a site under a private suffix is one of its own', async () => {
  const secure = await secureServer();
  const browser = await launch([
    ...mapTo({ 'www.you.github.io': secure.port }),
    '--ignore-certificate-errors',
  ]);
  try {
    const url = 'https://www.you.github.io/page';
    await open(browser, url);
    const page = await waitForPage(browser, (current) => current === url);
    await expect(page.getByText('Loaded /page')).toBeVisible();
    // A cookie of the host and one of its site; github.io is a public suffix of the list's
    // private part, so other.github.io is another site.
    await page.evaluate(() => {
      document.cookie = 'host=1; path=/';
      document.cookie = 'site=1; domain=you.github.io; path=/';
    });
    const cookiesOf = (address: string): Promise<string[]> =>
      browser.main.evaluate(
        ({ session }, at) =>
          session
            .fromPartition('persist:default')
            .cookies.get({ url: at })
            .then((cookies) => cookies.map((cookie) => cookie.name).toSorted()),
        address,
      );
    await browser.main.evaluate(({ session }) =>
      session
        .fromPartition('persist:default')
        .cookies.set({ url: 'https://other.github.io/', name: 'other', value: '1' }),
    );
    expect(await cookiesOf(url)).toEqual(['host', 'site']);

    const dialog = await siteInfo(browser, 'Connection is secure');
    await expect(dialog).toContainText('Cookies of this site: 2');
    await dialog.getByRole('button', { name: 'Delete cookies and site data…' }).click();
    await expect(dialog).toContainText('This signs you out of you.github.io.');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toContainText('The cookies and site data of you.github.io are deleted.');
    await expect(dialog).toContainText('Cookies of this site: 0');
    expect(await cookiesOf(url)).toEqual([]);
    expect(await cookiesOf('https://other.github.io/')).toEqual(['other']);
  } finally {
    await browser.close();
    await secure.close();
  }
});

test('switches the content blocker for the site in site information', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/blocker.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (current) => current === url);
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: 2 blocked' }),
    ).toBeVisible();
    const dialog = await siteInfo(browser, 'Page on this computer');
    const blockHere = dialog.getByRole('switch', { name: 'Block ads on 127.0.0.1' });
    await expect(blockHere).toBeChecked();
    await expect(dialog).toContainText('2 blocked on this page');
    await blockHere.click();
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    await expect(blockHere).not.toBeChecked();
    await expect.poll(() => saved(browser)['contentBlocker.allowedSites']).toEqual(['127.0.0.1']);
    // The page loaded again, with the ad that the blocker no longer blocks.
    await expect
      .poll(() =>
        page
          .evaluate(() => (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded)
          .catch(() => undefined),
      )
      .toBe(true);
  } finally {
    await browser.close();
  }
});

test('does not apply a change to a site that the tab left while the popover was open', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/permissions.html`;
    const other = `http://localhost:${fixturePort()}/permissions.html`;
    // Both sites decided about notifications, so a change that reached either of them shows.
    let overlay: Page | undefined;
    for (const address of [other, url]) {
      await open(browser, address);
      const page = await waitForPage(browser, (current) => current === address);
      const asked = page.evaluate(() => Notification.requestPermission());
      overlay = await overlayPage(browser);
      await overlay
        .getByRole('dialog', { name: `${new URL(address).host} wants to` })
        .getByRole('button', { name: 'Allow' })
        .click();
      expect(await asked).toBe('granted');
    }
    const allowed = { notifications: 'allow' };
    await expect
      .poll(() => savedSites(browser))
      .toEqual({ [server.origin]: allowed, [new URL(other).origin]: allowed });
    const dialog = await siteInfo(browser, 'Page on this computer');
    await expect(dialog.getByRole('switch', { name: 'Notifications' })).toBeChecked();
    const id = await overlay?.evaluate(
      () =>
        (document.querySelector('overlay-page') as unknown as { content: { id: number } }).content
          .id,
    );
    // A change of the switch reaches the handler of its channel at once, as `ipcMain` hands it
    // over with the overlay as its sender, so that it can come in the middle of a navigation,
    // which no message of the overlay can.
    await browser.main.evaluate(({ ipcMain, webContents }) => {
      const electronIpc = ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, payload: unknown) => unknown>;
      };
      // oxlint-disable-next-line eslint/no-underscore-dangle -- where Electron keeps the handlers of ipcMain
      const handlers = electronIpc._invokeHandlers;
      (globalThis as unknown as { siteChange: unknown }).siteChange = (
        request: unknown,
      ): Promise<unknown> =>
        new Promise((reply, fail) => {
          const overlayContents = webContents
            .getAllWebContents()
            .find((c) => c.getURL().startsWith('app://overlay'));
          const handler = handlers.get('overlay.setSitePermission');
          if (overlayContents === undefined || handler === undefined) {
            fail(new Error('No overlay'));
            return;
          }
          // The handler answers with its result, or through the event in older versions.
          const answer = handler(
            {
              sender: overlayContents,
              senderFrame: overlayContents.mainFrame,
              _reply: reply,
              _throw: fail,
            },
            request,
          );
          Promise.resolve(answer).then(reply, fail);
        });
    });
    type SiteChange = (request: unknown) => Promise<unknown>;
    const send = (allow: boolean): Promise<unknown> =>
      browser.main.evaluate(
        (_electron, request) =>
          (globalThis as unknown as { siteChange: SiteChange }).siteChange(request),
        { id, permission: 'notifications', allowed: allow },
      );
    // Sent this way, a change of the site that the popover shows applies.
    await send(false);
    await expect.poll(() => savedSites(browser)[server.origin]).toEqual({ notifications: 'block' });
    await send(true);
    await expect.poll(() => savedSites(browser)[server.origin]).toEqual(allowed);

    // The tab goes to the other site. One change comes once Chromium shows the other page but
    // before the tab learned of it, the other one from the overlay, which arrives once the tab
    // shows the other site but before the popover learned of it.
    await browser.main.evaluate(
      ({ webContents }, { from, to, popover }) => {
        const contents = webContents.getAllWebContents().find((c) => c.getURL() === from);
        const overlayContents = webContents
          .getAllWebContents()
          .find((c) => c.getURL().startsWith('app://overlay'));
        if (contents === undefined || overlayContents === undefined) throw new Error('No page');
        const g = globalThis as unknown as { siteChange: SiteChange; siteChanges: unknown };
        const request = { id: popover, permission: 'notifications', allowed: false };
        g.siteChanges = new Promise((done) => {
          // Before the browser's own listener, which tells the tab of the new page.
          contents.prependOnceListener('did-navigate', () => {
            done(
              Promise.all([
                Promise.resolve(contents.getURL()),
                g.siteChange(request),
                overlayContents.executeJavaScript(
                  `window.bridge.invoke('overlay.setSitePermission', ${JSON.stringify(request)})`,
                ),
              ]),
            );
          });
        });
        void contents.loadURL(to);
      },
      { from: url, to: other, popover: id },
    );
    const [seen] = (await browser.main.evaluate(
      () => (globalThis as unknown as { siteChanges: Promise<unknown> }).siteChanges,
    )) as [string];
    expect(seen).toBe(other);
    await waitForPage(browser, (current) => current === other);
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // Neither site got the change. The settings would be saved 300 ms after one.
    await new Promise((done) => setTimeout(done, 1000));
    expect(savedSites(browser)).toEqual({
      [server.origin]: allowed,
      [new URL(other).origin]: allowed,
    });
  } finally {
    await browser.close();
  }
});
