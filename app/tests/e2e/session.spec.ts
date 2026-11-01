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
