import { expect, test } from '@playwright/test';
import { launch, type Browser } from './harness.ts';

/** Records the searches that would leave the computer and cancels them. */
async function recordSearches(browser: Browser): Promise<void> {
  await browser.main.evaluate(({ session }) => {
    const searched: string[] = [];
    Reflect.set(globalThis, 'searched', searched);
    session.fromPartition('persist:default').webRequest.onBeforeRequest(
      {
        urls: [
          'https://search.example/*',
          'https://en.wikipedia.org/*',
          'https://duckduckgo.com/*',
        ],
      },
      (details, callback) => {
        searched.push(details.url);
        callback({ cancel: true });
      },
    );
  });
}

/** Types into the address bar and waits for the search it leads to. */
async function search(browser: Browser, input: string): Promise<unknown> {
  const before = await browser.main.evaluate(
    () => (Reflect.get(globalThis, 'searched') as string[]).length,
  );
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(input);
  await address.press('Enter');
  await expect
    .poll(() =>
      browser.main.evaluate(() => (Reflect.get(globalThis, 'searched') as string[]).length),
    )
    .toBe(before + 1);
  return browser.main.evaluate(() => (Reflect.get(globalThis, 'searched') as string[]).at(-1));
}

test('searches with the engine of a keyword and the site of a !bang', async () => {
  const browser = await launch([], {
    settings: {
      'search.engines': [{ name: 'Example', keyword: 'ex', url: 'https://search.example/?q=%s' }],
    },
  });
  try {
    await recordSearches(browser);
    expect(await search(browser, 'ex astela tabs')).toBe('https://search.example/?q=astela%20tabs');
    const wikipedia = 'https://en.wikipedia.org/wiki/Special:Search?search=astela';
    expect(await search(browser, '!w astela')).toBe(wikipedia);
    expect(await search(browser, 'astela !w')).toBe(wikipedia);
    // An unknown !bang searches with the default engine.
    expect(await search(browser, '!nothing astela')).toBe(
      'https://duckduckgo.com/?q=!nothing%20astela',
    );
  } finally {
    await browser.close();
  }
});

test('searches !bangs with the default engine when they are off', async () => {
  const browser = await launch([], { settings: { 'search.bangs': false } });
  try {
    await recordSearches(browser);
    expect(await search(browser, '!w astela')).toBe('https://duckduckgo.com/?q=!w%20astela');
  } finally {
    await browser.close();
  }
});
