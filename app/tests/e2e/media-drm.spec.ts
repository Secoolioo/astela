import { expect, test, type Page } from '@playwright/test';
import { FixtureServer, launch, overlayPage, waitForPage, type Browser } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** Opens a page in the active tab, once it has loaded. */
async function open(browser: Browser, url: string): Promise<Page> {
  const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await field.fill(url);
  await field.press('Enter');
  const page = await waitForPage(browser, (current) => current === url);
  await expect(page.locator('#result, h1').first()).toBeVisible();
  return page;
}

test('says when a site wants protected video or music, which the browser cannot play yet', async () => {
  const browser = await launch();
  try {
    const sign = browser.shell.getByRole('button', { name: 'Protected video or music' });
    const widevine = await open(browser, `${server.origin}/drm.html?keySystem=com.widevine.alpha`);
    await expect(widevine.locator('#result')).toHaveText('NotSupportedError');
    await expect(sign).toBeVisible();
    await expect(sign).toHaveAttribute('aria-expanded', 'false');
    await sign.click();
    const overlay = await overlayPage(browser);
    const popover = overlay.getByRole('dialog', {
      name: 'This site wants to play protected video or music',
    });
    await expect(popover).toContainText('Astela cannot play video or music that sites protect');
    await expect(popover.getByRole('button', { name: 'Learn more' })).toBeVisible();
    // The sign shows that its popover is open, as the other buttons with a popover do.
    await expect(sign).toHaveAttribute('aria-expanded', 'true');
    await overlay.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(sign).toHaveAttribute('aria-expanded', 'false');

    // Another page goes without the sign, as does a page that asks only for Clear Key, which
    // the browser has.
    const clearKey = await open(browser, `${server.origin}/drm.html?keySystem=org.w3.clearkey`);
    await expect(clearKey.locator('#result')).not.toHaveText('');
    await new Promise((done) => setTimeout(done, 1000));
    await expect(sign).toBeHidden();

    // A page that played media before its request failed only probed, as a news site's
    // script that tells browsers apart does, and goes without the sign.
    const played = await open(
      browser,
      `${server.origin}/drm.html?keySystem=com.widevine.alpha&play`,
    );
    await expect(played.locator('#result')).toHaveText('NotSupportedError');
    await new Promise((done) => setTimeout(done, 1000));
    await expect(sign).toBeHidden();
  } finally {
    await browser.close();
  }
});
