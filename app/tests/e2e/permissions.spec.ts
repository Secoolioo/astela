import { expect, test, type Locator, type Page } from '@playwright/test';
import { release } from 'node:os';
import { FixtureServer, launch, pressNative, waitForPage, type Browser } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

const url = (): string => `${server.origin}/permissions.html`;

/**
 * macOS 15 and later (Darwin 24) let people choose what to share in a picker of their own,
 * which needs no access to the whole screen, and the browser leaves the choice to it.
 */
const systemPicker = process.platform === 'darwin' && Number.parseInt(release(), 10) >= 24;

async function open(browser: Browser, address: string): Promise<Page> {
  const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await field.fill(address);
  await field.press('Enter');
  return waitForPage(browser, (current) => current === address);
}

/** The question of the fixture site in the overlay of the window. */
async function question(browser: Browser): Promise<Locator> {
  const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
  return overlay.getByRole('dialog', { name: `${new URL(server.origin).host} wants to` });
}

/** Asks for the camera or the microphone, and tells how many tracks the page got, or why none. */
function media(page: Page, constraints: MediaStreamConstraints): Promise<string> {
  return page.evaluate(
    (wanted) =>
      navigator.mediaDevices.getUserMedia(wanted).then(
        (stream) => `tracks: ${stream.getTracks().length}`,
        (error: unknown) => (error instanceof Error ? error.name : String(error)),
      ),
    constraints,
  );
}

test('asks before a site shows notifications, keeps the answer and lets the settings change it', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, url());
    const asked = page.evaluate(() => Notification.requestPermission());
    const prompt = await question(browser);
    await expect(prompt).toContainText('Show notifications');
    // The question has the focus, not a button: Enter, meant for the page, decides nothing.
    await expect(prompt).toBeFocused();
    await prompt.page().keyboard.press('Enter');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Allow' }).click();
    expect(await asked).toBe('granted');
    await expect(prompt).toBeHidden();
    // The answer holds, so the site asks no more.
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('granted');
    expect(await page.evaluate(() => Notification.permission)).toBe('granted');

    // The settings list the answer, in a tab of their own. The page has the focus again, so
    // the key goes to it, as a key of the keyboard would.
    await pressNative(browser, 'T', ['primary'], server.origin);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await field.fill('app://settings');
    await field.press('Enter');
    const settings = await waitForPage(browser, (current) => current.startsWith('app://settings'));
    const choice = settings.getByRole('combobox', { name: `Notifications for ${server.origin}` });
    await expect(choice).toHaveValue('allow');
    await choice.selectOption('block');
    await browser.shell.getByRole('tab', { name: 'Fixture permissions' }).click();
    await expect.poll(() => page.evaluate(() => Notification.permission)).toBe('denied');
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');

    // Without an answer, the site asks again.
    await browser.shell.getByRole('tab', { name: 'Settings' }).click();
    await settings
      .getByRole('button', { name: `Remove Notifications for ${server.origin}` })
      .click();
    await expect(settings.getByText('No site has asked yet.')).toBeVisible();
    await browser.shell.getByRole('tab', { name: 'Fixture permissions' }).click();
    const again = page.evaluate(() => Notification.requestPermission());
    await expect(prompt).toContainText('Show notifications');
    await prompt.getByRole('button', { name: 'Block' }).click();
    expect(await again).toBe('denied');
  } finally {
    await browser.close();
  }
});

test('refuses notifications to frames of other sites without a question', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, url());
    const frameUrl = url().replace('127.0.0.1', 'localhost');
    await page.evaluate(
      (src) =>
        new Promise<void>((done) => {
          const frame = document.createElement('iframe');
          frame.src = src;
          frame.addEventListener('load', () => done());
          document.body.append(frame);
        }),
      frameUrl,
    );
    const frame = page.frames().find((candidate) => candidate.url() === frameUrl);
    // A question would wait for an answer; a refusal comes at once.
    expect(
      await frame?.evaluate(() =>
        Promise.race([
          Notification.requestPermission(),
          new Promise((done) => setTimeout(() => done('asked'), 3000)),
        ]),
      ),
    ).toBe('denied');
    // The page itself still asks.
    const asked = page.evaluate(() => Notification.requestPermission());
    await (await question(browser)).getByRole('button', { name: 'Block' }).click();
    expect(await asked).toBe('denied');
  } finally {
    await browser.close();
  }
});

test('refuses what the user blocks, and asks again after a closed question', async () => {
  // Chromium's own test devices stand in for a camera and a microphone.
  const browser = await launch(['--use-fake-device-for-media-stream']);
  try {
    const page = await open(browser, url());
    let asked = media(page, { video: true });
    const prompt = await question(browser);
    await expect(prompt).toContainText('Use your camera');
    // Escape closes the question without an answer: refused this time only.
    await prompt.page().keyboard.press('Escape');
    expect(await asked).toBe('NotAllowedError');
    asked = media(page, { video: true });
    await expect(prompt).toContainText('Use your camera');
    await prompt.getByRole('button', { name: 'Block' }).click();
    expect(await asked).toBe('NotAllowedError');
    // A blocked camera is refused at once, also with the microphone.
    expect(await media(page, { video: true })).toBe('NotAllowedError');
    expect(await media(page, { video: true, audio: true })).toBe('NotAllowedError');
    // The microphone was not part of the answer.
    asked = media(page, { audio: true });
    await expect(prompt).toContainText('Use your microphone');
    await expect(prompt).not.toContainText('Use your camera');
    await prompt.getByRole('button', { name: 'Allow' }).click();
    expect(await asked).toBe('tracks: 1');
  } finally {
    await browser.close();
  }
});

test('takes a double click on Allow as one answer, not also as the answer to the next question', async () => {
  const browser = await launch(['--use-fake-device-for-media-stream']);
  try {
    const page = await open(browser, url());
    const camera = media(page, { video: true });
    const microphone = media(page, { audio: true });
    const prompt = await question(browser);
    await expect(prompt).toContainText('Use your camera');
    await prompt.getByRole('button', { name: 'Allow' }).click();
    expect(await camera).toBe('tracks: 1');
    // The second click of a double click comes a moment later, when the next question shows
    // where the first one was. It answers nothing.
    await expect(prompt).toContainText('Use your microphone');
    await prompt.getByRole('button', { name: 'Allow' }).click({ force: true });
    await prompt.getByRole('button', { name: 'Block' }).click();
    expect(await microphone).toBe('NotAllowedError');
  } finally {
    await browser.close();
  }
});

test('closes a question with a click next to it, which refuses this time only', async () => {
  const browser = await launch(['--use-fake-device-for-media-stream']);
  try {
    const page = await open(browser, url());
    const asked = media(page, { video: true });
    const prompt = await question(browser);
    await expect(prompt).toContainText('Use your camera');
    await prompt.page().mouse.click(8, 8);
    expect(await asked).toBe('NotAllowedError');
    // Nothing was decided, so the site may ask again.
    const again = media(page, { video: true });
    await expect(prompt).toContainText('Use your camera');
    await prompt.getByRole('button', { name: 'Allow' }).click();
    expect(await again).toBe('tracks: 1');
  } finally {
    await browser.close();
  }
});

test('asks for the camera and the microphone together and lets the page use both', async () => {
  const browser = await launch(['--use-fake-device-for-media-stream']);
  try {
    const page = await open(browser, url());
    const asked = media(page, { video: true, audio: true });
    const prompt = await question(browser);
    await expect(prompt).toContainText('Use your camera');
    await expect(prompt).toContainText('Use your microphone');
    await prompt.getByRole('button', { name: 'Allow' }).click();
    expect(await asked).toBe('tracks: 2');
    expect(
      await page.evaluate(
        async () => (await navigator.permissions.query({ name: 'camera' })).state,
      ),
    ).toBe('granted');
  } finally {
    await browser.close();
  }
});

test('asks about the location and the clipboard, and only the visible tab asks', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, url());
    const located = page.evaluate(
      () =>
        new Promise<number | string>((done) =>
          navigator.geolocation.getCurrentPosition(
            () => done('located'),
            (error) => done(error.code),
          ),
        ),
    );
    const prompt = await question(browser);
    await expect(prompt).toContainText('Know your location');
    await prompt.getByRole('button', { name: 'Block' }).click();
    expect(await located).toBe(1);

    await browser.main.evaluate(({ clipboard }) => clipboard.writeText('Copied text'));
    const read = page.evaluate(() =>
      navigator.clipboard.readText().then(
        (text) => text,
        (error: unknown) => (error instanceof Error ? error.name : String(error)),
      ),
    );
    await expect(prompt).toContainText('See text and images that you copy');
    await prompt.getByRole('button', { name: 'Allow' }).click();
    expect(await read).toBe('Copied text');

    // A tab in the background gets no question and no permission.
    await pressNative(browser, 'T', ['primary'], server.origin);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
    await expect(prompt).toBeHidden();
  } finally {
    await browser.close();
  }
});

test('lets a site see the screen or the window that the user chooses', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, url());
    await page.getByRole('button', { name: 'Share the screen' }).click();
    if (systemPicker) {
      // The picker of the system asks, and a test cannot answer it: the browser shows no
      // picker of its own, and the site waits.
      await new Promise((done) => setTimeout(done, 2000));
      const pages = browser.cdp.contexts().flatMap((context) => context.pages());
      expect(pages.some((current) => current.url().startsWith('app://overlay'))).toBe(false);
      await expect(page.locator('#result')).toHaveText('');
      return;
    }
    const overlay = await waitForPage(browser, (current) => current.startsWith('app://overlay'));
    const picker = overlay.getByRole('dialog', {
      name: `Choose what ${new URL(server.origin).host} may see`,
    });
    const share = picker.getByRole('button', { name: 'Share', exact: true });
    await expect(share).toBeDisabled();
    await picker.getByRole('button', { pressed: false }).first().click();
    await share.click();
    await expect(page.locator('#result')).toHaveText('video tracks: 1');
    // Canceling lets the site see nothing; Electron reports it as an aborted capture.
    await page.getByRole('button', { name: 'Share the screen' }).click();
    await picker.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#result')).toHaveText('AbortError');
  } finally {
    await browser.close();
  }
});
