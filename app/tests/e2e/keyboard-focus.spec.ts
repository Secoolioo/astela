import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  FixtureServer,
  focusedElement,
  launch,
  pressFocused,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

// The keys go to the view that has the focus, as the keyboard sends them, so that the browser and
// the page see them as they see the keys of people; the browser process tells where the focus is.

const server = new FixtureServer();

/** F6 and Shift+F6 for the panes, which macOS gives no shortcut at first. */
const panes = {
  settings: { 'keys.shortcuts': { 'focus.nextPane': ['F6'], 'focus.previousPane': ['Shift+F6'] } },
};

test.beforeAll(async () => {
  await server.start();
});

test.afterAll(async () => {
  await server.stop();
});

/** Loads an address in the active tab from the address bar, whose page then has the focus. */
async function open(browser: Browser, url: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
  await waitForPage(browser, (page) => page === url);
  await expect.poll(() => focusedElement(browser)).toBe('page body');
}

/**
 * The element with the focus in a frame of a page, by its id, while the frame has the focus, or
 * `none`.
 */
async function frameFocus(page: Page, url: string): Promise<string> {
  const frame = page.frames().find((candidate) => candidate.url() === url);
  if (frame === undefined) return 'missing';
  return frame.evaluate(() =>
    document.hasFocus() && document.activeElement !== null
      ? `#${document.activeElement.id}`
      : 'none',
  );
}

/** A port on which nothing listens, so connections to it are refused. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** Presses a key in the view with the focus, and waits until the focus is where it should be. */
async function step(
  browser: Browser,
  key: string,
  modifiers: readonly ('shift' | 'primary')[],
  where: string,
): Promise<void> {
  await pressFocused(browser, key, modifiers);
  await expect.poll(() => focusedElement(browser)).toBe(where);
}

test('goes on from the ends of a page to the toolbar with Tab and Shift+Tab, and back into the page', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/focus.html`);
    for (const where of ['page #one', 'page #field', 'page #two', 'shell Workspace Default']) {
      await step(browser, 'Tab', [], where);
    }
    // Shift+Tab from the first control of the toolbar goes into the page at its end.
    for (const where of ['page body', 'page #two', 'page #field', 'page #one', 'shell Menu']) {
      await step(browser, 'Tab', ['shift'], where);
    }
    // Tab from the last control goes into the page at its start.
    await step(browser, 'Tab', [], 'page body');
    await step(browser, 'Tab', [], 'page #one');
  } finally {
    await browser.close();
  }
});

test('reaches the page with Tab and Shift+Tab from the address bar through the toolbar', async () => {
  const browser = await launch();
  try {
    await open(browser, `${server.origin}/focus.html`);
    for (const modifiers of [[], ['shift']] as const) {
      await step(browser, 'L', ['primary'], 'shell Address and search bar');
      const seen: string[] = [];
      let before = 'shell Address and search bar';
      for (let i = 0; i < 20 && !before.startsWith('page'); i += 1) {
        await pressFocused(browser, 'Tab', modifiers);
        // Each key moves the focus on; the toolbar holds far fewer than 20 controls.
        await expect.poll(() => focusedElement(browser)).not.toBe(before);
        before = await focusedElement(browser);
        seen.push(before);
      }
      expect(seen.at(-1), seen.join(' > ')).toBe('page body');
      expect(
        seen.slice(0, -1).every((where) => where.startsWith('shell ')),
        seen.join(' > '),
      ).toBe(true);
    }
  } finally {
    await browser.close();
  }
});

test('moves between the address bar and the page with F6 and Shift+F6, and keeps what the page holds', async () => {
  const browser = await launch([], panes);
  try {
    await open(browser, `${server.origin}/focus.html`);
    await step(browser, 'Tab', [], 'page #one');
    await step(browser, 'Tab', [], 'page #field');
    const page = await waitForPage(browser, (url) => url.endsWith('/focus.html'));
    await page.evaluate(() => {
      const field = document.querySelector('input');
      if (field !== null) field.value = 'typed here';
      scrollTo(0, 1500);
    });
    for (const key of [[], ['shift']] as const) {
      await step(browser, 'F6', key, 'shell Address and search bar');
      await step(browser, 'F6', key, 'page #field');
    }
    expect(
      await page.evaluate(() => [document.querySelector('input')?.value, Math.round(scrollY)]),
    ).toEqual(['typed here', 1500]);
  } finally {
    await browser.close();
  }
});

test('goes into the frames of a page, of its own site and of others, with Tab and Shift+Tab', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/focus-frames.html`;
    const same = `${server.origin}/frame-field.html`;
    const other = `${server.origin.replace('127.0.0.1', 'localhost')}/frame-field.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (address) => address === url);
    await expect.poll(() => page.frames().length).toBe(4);
    await step(browser, 'Tab', [], 'page #one');
    // The frame of another site with nothing to focus hands the key on to the next frame.
    await step(browser, 'Tab', [], 'page #same');
    await expect.poll(() => frameFocus(page, same)).toBe('#field');
    await step(browser, 'Tab', [], 'page #other');
    await expect.poll(() => frameFocus(page, other)).toBe('#field');
    // The browser sends the keys of the keyboard on to the frame of another process that has the
    // focus, as the developer tools do with theirs; Electron's own keys reach the page's frame.
    await page.keyboard.press('Tab');
    await expect.poll(() => focusedElement(browser)).toBe('page #two');
    await step(browser, 'Tab', [], 'shell Workspace Default');
    await step(browser, 'Tab', ['shift'], 'page body');
    await step(browser, 'Tab', ['shift'], 'page #two');
    await step(browser, 'Tab', ['shift'], 'page #other');
    await expect.poll(() => frameFocus(page, other)).toBe('#field');
  } finally {
    await browser.close();
  }
});

test('reaches the frame of another site that a page holds alone with Tab', async () => {
  const browser = await launch();
  try {
    const url = `${server.origin}/focus-frame-only.html`;
    const other = `${server.origin.replace('127.0.0.1', 'localhost')}/frame-field.html`;
    await open(browser, url);
    const page = await waitForPage(browser, (address) => address === url);
    await expect.poll(() => page.frames().some((frame) => frame.url() === other)).toBe(true);
    await step(browser, 'Tab', [], 'page #other');
    await expect.poll(() => frameFocus(page, other)).toBe('#field');
    // From the toolbar, the page itself comes first, and then its frame.
    await step(browser, 'L', ['primary'], 'shell Address and search bar');
    let before = 'shell Address and search bar';
    for (let i = 0; i < 20 && before.startsWith('shell'); i += 1) {
      await pressFocused(browser, 'Tab');
      await expect.poll(() => focusedElement(browser)).not.toBe(before);
      before = await focusedElement(browser);
    }
    expect(before).toMatch(/^page /);
    // The page starts over at its start once its view has the focus, which first gives it back to
    // the field of the frame, where the focus was before.
    await expect.poll(() => focusedElement(browser)).toBe('page body');
    await expect.poll(() => frameFocus(page, other)).toBe('none');
    await step(browser, 'Tab', [], 'page #other');
    await expect.poll(() => frameFocus(page, other)).toBe('#field');
  } finally {
    await browser.close();
  }
});

test('moves between the address bar and the problem of a page that could not load with F6', async () => {
  const browser = await launch([], panes);
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`http://127.0.0.1:${String(await freePort())}/`);
    await address.press('Enter');
    await expect(
      browser.shell.getByRole('region', { name: "This page can't be reached" }),
    ).toBeVisible();
    await step(browser, 'L', ['primary'], 'shell Address and search bar');
    // The problem shows in the place of the page, and F6 goes there and back in either direction.
    for (const modifiers of [[], ['shift']] as const) {
      await step(browser, 'F6', modifiers, 'shell Try again');
      await step(browser, 'F6', modifiers, 'shell Address and search bar');
    }
  } finally {
    await browser.close();
  }
});

test('leaves a page with nothing to focus and the new tab page with Tab', async () => {
  const browser = await launch([], panes);
  try {
    await open(browser, `${server.origin}/second.html`);
    await step(browser, 'Tab', [], 'shell Workspace Default');
    await step(browser, 'Tab', ['shift'], 'page body');
    await step(browser, 'Tab', ['shift'], 'shell Menu');
    // The new tab page holds its search field, which the keys reach after the toolbar.
    await pressFocused(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await waitForPage(browser, (url) => url.startsWith('app://newtab'));
    await expect.poll(async () => (await shellState(browser.shell)).tabs[1]?.loading).toBe(false);
    await expect.poll(() => focusedElement(browser)).toBe('shell Address and search bar');
    let before = 'shell Address and search bar';
    for (let i = 0; i < 10 && before.startsWith('shell'); i += 1) {
      await pressFocused(browser, 'Tab');
      await expect.poll(() => focusedElement(browser)).not.toBe(before);
      before = await focusedElement(browser);
    }
    expect(before).toBe('newtab body');
    await step(browser, 'Tab', [], 'newtab Search with DuckDuckGo or enter address');
    await step(browser, 'Tab', [], 'shell Workspace Default');
    // F6 goes into the new tab page's own view too.
    await step(browser, 'F6', [], 'newtab Search with DuckDuckGo or enter address');
  } finally {
    await browser.close();
  }
});

test('gives the first page the focus at the start, of a link and of the session it restores', async () => {
  const url = `${server.origin}/focus.html`;
  const first = await launch(['--', url]);
  try {
    await waitForPage(first, (page) => page === url);
    await expect.poll(() => focusedElement(first)).toBe('page body');
    await step(first, 'Tab', [], 'page #one');
  } finally {
    await first.close({ keepProfile: true });
  }
  const second = await launch([], { profile: first.profile });
  try {
    await waitForPage(second, (page) => page === url);
    await expect.poll(() => focusedElement(second)).toBe('page body');
    await step(second, 'Tab', [], 'page #one');
  } finally {
    await second.close();
  }
});
