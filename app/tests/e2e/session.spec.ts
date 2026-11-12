import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FixtureServer, launch, pressNative, shellState, waitForPage } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('restores the tabs of the last session and loads only the active one', async () => {
  const first = await launch();
  const address = first.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${server.origin}/index.html`);
  await address.press('Enter');
  await waitForPage(first, (url) => url.endsWith('/index.html'));
  await pressNative(first, 'T', ['primary']);
  await address.fill(`${server.origin}/second.html`);
  await address.press('Enter');
  await waitForPage(first, (url) => url.endsWith('/second.html'));
  await first.close({ keepProfile: true });

  const second = await launch([], { profile: first.profile });
  try {
    const state = await shellState(second.shell);
    expect(state.tabs.map((tab) => [tab.url, tab.title])).toEqual([
      [`${server.origin}/index.html`, 'Fixture home'],
      [`${server.origin}/second.html`, 'Fixture second'],
    ]);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
    const loaded = (): Promise<number> =>
      second.main.evaluate(
        ({ webContents }, origin) =>
          webContents.getAllWebContents().filter((c) => c.getURL().startsWith(origin)).length,
        server.origin,
      );
    await expect.poll(loaded).toBe(1);
    await second.shell.getByRole('tab', { name: 'Fixture home' }).click();
    await expect.poll(loaded).toBe(2);
  } finally {
    await second.close();
  }
});

test('restores a tab whose pinned flag in the session is broken, as a tab that is not pinned', async () => {
  // Each optional field of a stored tab is read on its own, so a broken one costs only itself.
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  mkdirSync(join(profile, 'data'), { recursive: true });
  writeFileSync(
    join(profile, 'data', 'session.json'),
    JSON.stringify({
      version: 1,
      windows: [
        {
          tabs: [
            { url: `${server.origin}/index.html`, title: 'Fixture home', pinned: 'yes' },
            { url: `${server.origin}/second.html`, title: 'Fixture second', pinned: true },
            { url: `${server.origin}/opened.html`, title: 'Fixture opened' },
          ],
          active: 2,
        },
      ],
    }),
  );
  const browser = await launch([], { profile });
  try {
    const state = await shellState(browser.shell);
    expect(state.tabs.map((tab) => [tab.url, tab.pinned])).toEqual([
      [`${server.origin}/second.html`, true],
      [`${server.origin}/index.html`, false],
      [`${server.origin}/opened.html`, false],
    ]);
    expect(state.activeTabId).toBe(state.tabs[2]?.id);
  } finally {
    await browser.close();
  }
});

test('opens a new tab page instead when the setting says so', async () => {
  const first = await launch();
  const address = first.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${server.origin}/index.html`);
  await address.press('Enter');
  await waitForPage(first, (url) => url.endsWith('/index.html'));
  await first.close({ keepProfile: true });
  const second = await launch([], {
    profile: first.profile,
    settings: { 'startup.page': 'newtab' },
  });
  try {
    expect((await shellState(second.shell)).tabs.map((tab) => tab.url)).toEqual(['app://newtab/']);
  } finally {
    await second.close();
  }
});

test('opens the pages of the settings at start, and loads only the first', async () => {
  const pages = [`${server.origin}/index.html`, `${server.origin}/second.html`];
  const browser = await launch([], {
    settings: { 'startup.page': 'pages', 'startup.urls': pages },
  });
  try {
    const state = await shellState(browser.shell);
    expect(state.tabs.map((tab) => tab.url)).toEqual(pages);
    expect(state.activeTabId).toBe(state.tabs[0]?.id);
    const loaded = (): Promise<number> =>
      browser.main.evaluate(
        ({ webContents }, origin) =>
          webContents.getAllWebContents().filter((c) => c.getURL().startsWith(origin)).length,
        server.origin,
      );
    await expect.poll(loaded).toBe(1);
  } finally {
    await browser.close();
  }
});

test('opens the home page from the home button and its shortcut, which are off by default', async () => {
  const plain = await launch();
  try {
    await expect(plain.shell.getByRole('button', { name: 'Home' })).toHaveCount(0);
  } finally {
    await plain.close();
  }
  const browser = await launch([], {
    settings: { 'home.button': true, 'home.page': `${server.origin}/second.html` },
  });
  try {
    await browser.shell.getByRole('button', { name: 'Home' }).click();
    await waitForPage(browser, (url) => url.endsWith('/second.html'));
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    if (process.platform === 'darwin') await pressNative(browser, 'H', ['primary', 'shift']);
    else await pressNative(browser, 'Home', ['alt']);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/second.html`]);
  } finally {
    await browser.close();
  }
});
