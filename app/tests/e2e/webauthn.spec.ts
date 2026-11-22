import { expect, test, type Page } from '@playwright/test';
import { FixtureServer, launch, overlayPage, waitForPage, type Browser } from './harness.ts';

const server = new FixtureServer();

// Windows shows its own dialog for security keys and passkeys.
test.skip(process.platform === 'win32', 'Windows asks for security keys itself');

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** How a request of the fixture ended, and after how many milliseconds. */
interface Outcome {
  readonly state: string;
  readonly ms?: number;
}

/** Opens the fixture on localhost, which is a domain, as WebAuthn needs one. */
async function open(browser: Browser): Promise<Page> {
  const url = `${server.origin.replace('127.0.0.1', 'localhost')}/webauthn.html`;
  const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await field.fill(url);
  await field.press('Enter');
  const page = await waitForPage(browser, (current) => current === url);
  await expect(browser.shell.getByRole('tab', { name: 'Fixture security keys' })).toBeVisible();
  return page;
}

/** How a request of the fixture ended, once it has. */
async function outcome(page: Page, label: string): Promise<Outcome> {
  const read = (): Promise<Outcome | undefined> =>
    page.evaluate(
      (name) => (window as unknown as { results: Record<string, Outcome> }).results[name],
      label,
    );
  await expect.poll(async () => (await read())?.state, { timeout: 30_000 }).not.toBe('pending');
  return (await read()) ?? { state: 'missing' };
}

/** Runs a function of the fixture in the page. */
function run(page: Page, script: string): Promise<void> {
  return page.evaluate(script);
}

test('asks for a security key with the name of the site and lets people cancel', async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    await page.getByRole('button', { name: 'Create a passkey' }).click();
    const overlay = await overlayPage(browser);
    const question = overlay.getByRole('dialog', { name: 'Use your security key with localhost' });
    await expect(question).toBeVisible({ timeout: 1000 });
    await expect(question).toContainText('Insert your security key and touch it.');
    const cancelled = Date.now();
    await question.getByRole('button', { name: 'Cancel' }).click();
    expect((await outcome(page, 'click')).state).toBe('NotAllowedError');
    expect(Date.now() - cancelled).toBeLessThan(1000);
    await expect(question).toBeHidden();

    // The site's own timeout holds, which Chromium would stretch to three minutes.
    await page.getByRole('button', { name: 'Sign in with a key for three seconds' }).click();
    await expect(question).toBeVisible();
    const short = await outcome(page, 'short');
    expect(short.state).toBe('NotAllowedError');
    expect(short.ms).toBeGreaterThanOrEqual(2900);
    expect(short.ms).toBeLessThan(6000);
    await expect(question).toBeHidden();

    // The site's own signal still aborts with its reason.
    await run(
      page,
      `{ const site = new AbortController(); signIn('aborted', 20000, undefined, site.signal); setTimeout(() => site.abort(), 500); }`,
    );
    expect((await outcome(page, 'aborted')).state).toBe('AbortError');
    await expect(question).toBeHidden();

    // A request that waits for the autofill of a field asks nothing.
    await run(page, `signIn('conditional', 20000, undefined, undefined, 'conditional')`);
    await new Promise((done) => setTimeout(done, 1000));
    await expect(overlay.getByRole('dialog')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('signs in with a security key and with the passkeys that it holds', async () => {
  const browser = await launch();
  try {
    const page = await open(browser);
    // A security key of DevTools that people touch at once stands in for a real one.
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('WebAuthn.enable', { enableUI: false });
    await devtools.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await run(page, `create('create', 20000)`);
    expect((await outcome(page, 'create')).state).toBe('resolved');
    // As a second factor, for a credential that the site names.
    await run(page, `signIn('second factor', 20000, lastCredential.rawId)`);
    expect((await outcome(page, 'second factor')).state).toBe('resolved');
    // As a passkey, which the key finds by itself.
    await run(page, `signIn('passkey', 20000)`);
    expect((await outcome(page, 'passkey')).state).toBe('resolved');

    // With two accounts on the key, people choose one.
    await run(page, `create('second account', 20000, 'other')`);
    expect((await outcome(page, 'second account')).state).toBe('resolved');
    await run(page, `signIn('choice', 20000)`);
    const overlay = await overlayPage(browser);
    const choice = overlay.getByRole('dialog', {
      name: 'Choose an account to sign in to localhost',
    });
    await expect(choice).toBeVisible();
    await expect(choice.getByRole('button')).toHaveCount(3);
    await choice.getByRole('button', { name: /^other/ }).click();
    expect((await outcome(page, 'choice')).state).toBe('resolved');
    await expect(choice).toBeHidden();

    // A choice that nobody makes ends with the request, at the site's time limit, and the
    // next request of the site asks anew.
    await run(page, `signIn('choice in time', 3000)`);
    await expect(choice).toBeVisible();
    expect((await outcome(page, 'choice in time')).state).toBe('NotAllowedError');
    await expect(choice).toBeHidden();
    await run(page, `signIn('choice again', 20000)`);
    await expect(choice).toBeVisible();
    await choice.getByRole('button', { name: /^tester/ }).click();
    expect((await outcome(page, 'choice again')).state).toBe('resolved');
    await expect(choice).toBeHidden();
  } finally {
    await browser.close();
  }
});
