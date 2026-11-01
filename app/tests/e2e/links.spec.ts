import { expect, test } from '@playwright/test';
import { FixtureServer, launch, shellState, startAgain } from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

test('opens links from other apps, at the start and in a running browser', async () => {
  const browser = await launch([`${server.origin}/index.html`, 'file:///etc/hosts']);
  try {
    await expect(browser.shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
    await expect(browser.shell.getByRole('tab')).toHaveCount(1);
    // The browser registers itself with -- before the link, so a link is never a switch.
    expect(await startAgain(browser, ['--', `${server.origin}/second.html`])).toBe(0);
    await expect(browser.shell.getByRole('tab', { name: 'Fixture second' })).toBeVisible();
    await expect
      .poll(async () => {
        const state = await shellState(browser.shell);
        return state.tabs.find((tab) => tab.id === state.activeTabId)?.title;
      })
      .toBe('Fixture second');
    // A second start without a link only brings the window to the front.
    expect(await startAgain(browser, [])).toBe(0);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
  } finally {
    await browser.close();
  }
});
