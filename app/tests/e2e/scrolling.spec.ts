import { expect, test, type Locator, type Page } from '@playwright/test';
import { launch, pressNative, waitForPage, type Browser } from './harness.ts';

let browser: Browser;

test.beforeEach(async () => {
  browser = await launch();
  // A small window, so the browser's own pages are taller than the space for them.
  await browser.main.evaluate(({ BaseWindow }) => {
    BaseWindow.getAllWindows()[0]?.setContentSize(1280, 600);
  });
});
test.afterEach(async () => {
  await browser.close();
});

/** Scrolls with the mouse wheel, as a person does, until the element is in view. */
async function wheelTo(page: Page, target: Locator): Promise<void> {
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.move(size.width / 2, size.height / 2);
  await expect
    .poll(async () => {
      const inView = await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      });
      if (!inView) await page.mouse.wheel(0, 400);
      return inView;
    })
    .toBe(true);
}

/** Clicks the middle of an element without letting Playwright scroll it into view. */
async function clickWhereItIs(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('The element has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('scrolls the settings page down to its last section', async () => {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill('app://settings');
  await address.press('Enter');
  const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
  const open = settings.getByRole('button', { name: 'Open the setup guide' });
  await expect(open).toBeAttached();
  await wheelTo(settings, open);
  await clickWhereItIs(settings, open);
  await waitForPage(browser, (url) => url.startsWith('app://setup'));
});

test('scrolls a long bookmarks page down to its last bookmark', async () => {
  await pressNative(browser, 'O', ['primary', 'shift']);
  const bookmarks = await waitForPage(browser, (url) => url.startsWith('app://bookmarks'));
  await bookmarks.evaluate(async () => {
    for (let n = 1; n <= 30; n += 1) {
      await window.bridge.invoke('bookmarks.add', {
        parentId: 1,
        title: `Bookmark ${String(n).padStart(2, '0')}`,
        url: `https://example.com/${n}`,
      });
    }
  });
  const last = bookmarks.getByRole('button', { name: /^Bookmark 30/ });
  await expect(last).toBeAttached();
  await wheelTo(bookmarks, last);
  // The history page scrolls the same way.
  await pressNative(browser, process.platform === 'darwin' ? 'Y' : 'H', ['primary']);
  const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
  expect(await history.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
    'auto',
  );
});
