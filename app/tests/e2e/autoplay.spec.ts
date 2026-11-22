import { expect, test } from '@playwright/test';
import { FixtureServer, launch, waitForPage, type Browser } from './harness.ts';

// Playwright's trace reads the title of each page as it loads, by a script that it runs with a
// user gesture. That gives the page the user activation of a click, which these tests check that
// a page lacks before a click on it, so they keep no trace.
test.use({ trace: 'off' });

const server = new FixtureServer();
let browser: Browser;

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});
test.beforeEach(async () => {
  browser = await launch();
});
test.afterEach(async () => {
  await browser.close();
});

async function navigate(input: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(input);
  await address.press('Enter');
}

/** What a page of the autoplay fixture could start, and whether its tab plays sound. */
interface AutoplayReport {
  readonly context: string;
  readonly play: string;
  readonly autoPaused: boolean;
  readonly autoTime: number;
  readonly activated: boolean;
  readonly audible: boolean;
}

/**
 * Reads what a page of the autoplay fixture could start, from the browser process and without
 * a user gesture, which a script of Playwright would give the page.
 * @param url - The address of the page.
 */
function autoplayReport(url: string): Promise<AutoplayReport | undefined> {
  return browser.main.evaluate(async ({ webContents }, address) => {
    const contents = webContents.getAllWebContents().find((page) => page.getURL() === address);
    if (contents === undefined) return undefined;
    const report = (await contents.executeJavaScript('window.report()', false)) as object;
    return { ...report, audible: contents.isCurrentlyAudible() } as AutoplayReport;
  }, url);
}

/**
 * Runs a script in a page of the autoplay fixture without a user gesture, such as one that
 * starts a video, or reads when the page's video with the autoplay attribute started.
 * @param url - The address of the page.
 * @param script - The script, whose value the page gives back.
 */
function inAutoplayPage(url: string, script: string): Promise<unknown> {
  return browser.main.evaluate(
    ({ webContents }, { address, code }) =>
      webContents
        .getAllWebContents()
        .find((page) => page.getURL() === address)
        ?.executeJavaScript(code, false),
    { address: url, code: script },
  );
}

/**
 * Makes the browser hand every page its preferences anew, as Chromium does when the theme of
 * the system changes, with the theme as it was.
 */
async function refreshPreferences(): Promise<void> {
  await browser.main.evaluate(async ({ nativeTheme }) => {
    const before = nativeTheme.themeSource;
    nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
    await new Promise((done) => setTimeout(done, 300));
    nativeTheme.themeSource = before;
    await new Promise((done) => setTimeout(done, 300));
  });
}

const silent = {
  context: 'suspended',
  play: 'NotAllowedError',
  autoPaused: true,
  autoTime: 0,
  activated: false,
};

test('lets pages play sound only after a click on them, also pages that they open', async () => {
  const url = `${server.origin}/autoplay.html`;
  await navigate(url);
  await expect(browser.shell.getByRole('tab', { name: 'Fixture autoplay' })).toBeVisible();
  // Nothing touches the page for three seconds, in which a page could start its sound.
  await new Promise((done) => setTimeout(done, 3000));
  expect(await autoplayReport(url)).toEqual({ ...silent, audible: false });
  const page = await waitForPage(browser, (address) => address === url);
  await page.click('h1');
  await expect.poll(async () => (await autoplayReport(url))?.context).toBe('running');
  await expect.poll(async () => (await autoplayReport(url))?.audible).toBe(true);

  // A page of another site that the click opened gets no sound, as in Chrome.
  const other = `${url.replace('127.0.0.1', 'localhost')}?opened=localhost`;
  await page.click('#other');
  await expect(browser.shell.getByRole('tab')).toHaveCount(2);
  await expect.poll(async () => (await autoplayReport(other))?.play).not.toBe('pending');
  // Its video with the autoplay attribute has all it needs to play, and stays paused.
  const enough = "document.getElementById('auto').readyState === HTMLMediaElement.HAVE_ENOUGH_DATA";
  await expect.poll(() => inAutoplayPage(other, enough)).toBe(true);
  await new Promise((done) => setTimeout(done, 500));
  const started = async (): Promise<string> =>
    JSON.stringify(await inAutoplayPage(other, 'window.timeline'));
  expect(await autoplayReport(other), await started()).toEqual({ ...silent, audible: false });
  // The page keeps the rule also once the browser hands the pages their preferences anew, as
  // for a change of the system's theme: a page that a page opens has those of a tab.
  await refreshPreferences();
  const playAgain =
    "document.getElementById('played').play().then(() => 'resolved', (error) => error.name)";
  expect(await inAutoplayPage(other, playAgain), await started()).toBe('NotAllowedError');
  expect(await autoplayReport(other), await started()).toEqual({ ...silent, audible: false });

  // A page of the same site that a click opened may play sound, as in Chrome.
  await browser.shell.getByRole('tab', { name: 'Fixture autoplay' }).first().click();
  const same = `${url}?opened=127.0.0.1`;
  await page.click('#same');
  await expect(browser.shell.getByRole('tab')).toHaveCount(3);
  await expect.poll(async () => (await autoplayReport(same))?.play).toBe('resolved');
  await expect.poll(async () => (await autoplayReport(same))?.context).toBe('running');
});
