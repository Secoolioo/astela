import { expect, test, type Page } from '@playwright/test';
import {
  FixtureServer,
  launch,
  packageWithoutBlockerData,
  shellState,
  waitForPage,
} from './harness.ts';

const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

// The test package carries filter data built from fixtures/blocker: it blocks the script
// fixture-ad.js and the image fixture-tracker.gif of the fixture server.
for (const enabled of [true, false]) {
  test(`loads the blocked requests of a page only when the blocker is ${enabled ? 'on' : 'off'}`, async () => {
    const browser = await launch([], { settings: { 'contentBlocker.enabled': enabled } });
    try {
      const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
      await address.fill(`${server.origin}/blocker.html`);
      await address.press('Enter');
      const page = await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
      await page.waitForLoadState('load');
      // Polled, so a slow page or a load event of the previous document cannot decide.
      await expect
        .poll(() =>
          page.evaluate(() => ({
            script: (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded === true,
            image:
              (document.getElementById('tracker') as HTMLImageElement | null)?.naturalWidth === 1,
            page: document.querySelector('p')?.textContent,
          })),
        )
        .toEqual({ script: !enabled, image: !enabled, page: 'Content' });
      // Scriptlets run before the page's own scripts, and elements are hidden, in the page
      // and in its frame.
      const frame = page.frames().find((f) => f.url().endsWith('/blocker-frame.html'));
      for (const target of [page, frame]) {
        expect(
          await target?.evaluate(
            () => (window as unknown as { scriptletBeforePage?: boolean }).scriptletBeforePage,
          ),
        ).toBe(enabled);
        await expect
          .poll(() =>
            target?.evaluate(() => {
              const ad = document.querySelector('.fixture-ad');
              return ad === null ? 'missing' : getComputedStyle(ad).display;
            }),
          )
          .toBe(enabled ? 'none' : 'block');
      }
    } finally {
      await browser.close();
    }
  });
}

test('switches the blocker off from the settings page', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const toggle = settings.getByRole('switch', { name: /Block ads and trackers/ });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect
      .poll(() => settings.evaluate(() => window.bridge.invoke('settings.getAll', {})))
      .toMatchObject({
        settings: expect.arrayContaining([
          { key: 'contentBlocker.enabled', value: false, locked: false },
        ]),
      });
  } finally {
    await browser.close();
  }
});

test('counts blocked requests and switches the blocker off for one site', async () => {
  const browser = await launch();
  try {
    await browser.main.evaluate(({ Menu }) => {
      const recorded: Electron.Menu[] = [];
      Object.assign(globalThis, { recordedMenus: recorded });
      Menu.prototype.popup = function popup(this: Electron.Menu) {
        recorded.push(this);
      };
    });
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocker.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
    const shield = browser.shell.getByRole('button', { name: 'Content blocker: 2 blocked' });
    await expect(shield).toBeVisible();
    await shield.click();
    const items = (): Promise<string[] | undefined> =>
      browser.main.evaluate(() =>
        (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
          .at(-1)
          ?.items.map((item) => (item.type === 'separator' ? '-' : item.label.replaceAll('&', ''))),
      );
    await expect
      .poll(items)
      .toEqual(
        process.platform === 'darwin'
          ? [
              'Blocked on This Page: 2',
              '-',
              'Block Ads on 127.0.0.1',
              '-',
              'Content Blocker Settings…',
            ]
          : [
              'Blocked on this page: 2',
              '-',
              'Block ads on 127.0.0.1',
              '-',
              'Content blocker settings',
            ],
      );
    await browser.main.evaluate(() => {
      const menu = (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus.at(
        -1,
      );
      menu?.items[2]?.click();
    });
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    // The page reloads, so asking it can fail until the new page is there.
    await expect
      .poll(() =>
        page
          .evaluate(() => (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded)
          .catch(() => undefined),
      )
      .toBe(true);
  } finally {
    await browser.close();
  }
});

test('runs every scriptlet in a scope of its own, in its world and with its arguments', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/scriptlets.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/scriptlets.html'));
    await page.waitForLoadState('load');
    await expect
      .poll(() =>
        page.evaluate(() => ({
          // Two scriptlets declare the same helper class; both run.
          sharedA: (window as unknown as { fixtureSharedA?: string }).fixtureSharedA,
          sharedB: (window as unknown as { fixtureSharedB?: string }).fixtureSharedB,
          // A percent sign in an argument arrives as it is.
          argument: (window as unknown as { fixtureArgument?: string }).fixtureArgument,
          // An isolated scriptlet does not see the page's globals.
          world: document.documentElement.dataset['world'],
          // A hiding rule beats the page's own !important rule.
          hidden: getComputedStyle(document.getElementById('fixture-hidden') as Element).display,
        })),
      )
      .toEqual({
        sharedA: 'ran',
        sharedB: 'ran',
        argument: '100%',
        world: 'undefined',
        hidden: 'none',
      });
  } finally {
    await browser.close();
  }
});

test('shows when the content blocker has no filter data', async () => {
  const copy = packageWithoutBlockerData();
  const browser = await launch([], { app: copy.app });
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocker.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
    await expect(
      browser.shell.getByRole('button', {
        name: 'Content blocker: not working, its filter data is missing',
      }),
    ).toBeVisible();
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await expect(settings.getByRole('alert')).toHaveText(
      'Not working: the filter data is missing or damaged, so nothing is blocked. Reinstall the browser to repair it.',
    );
  } finally {
    await browser.close();
    copy.remove();
  }
});

test('serves stand-ins for redirected scripts, removes tracking parameters and adds policies', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const open = async (path: string): Promise<Page> => {
      await address.fill(`${server.origin}${path}`);
      await address.press('Enter');
      const page = await waitForPage(browser, (url) => url.includes(path.split('?')[0] ?? path));
      await page.waitForLoadState('load');
      return page;
    };
    // A blocked script with a stand-in loads it, so its load event fires, not its error.
    const page = await open('/redirect.html');
    await expect
      .poll(() =>
        page.evaluate(() => ({
          events: (window as unknown as { events: string[] }).events,
          ima: (window as unknown as { fixtureIma?: { ready: boolean } }).fixtureIma?.ready,
        })),
      )
      .toEqual({ events: ['noop:load', 'ima:load'], ima: true });
    // Tracking parameters leave the addresses of requests and of pages.
    expect(
      await page.evaluate(async () => (await fetch('/probe.html?fixture_tracking=1&keep=2')).url),
    ).toBe(`${server.origin}/probe.html?keep=2`);
    await address.fill(`${server.origin}/second.html?fixture_tracking=1&keep=2`);
    await address.press('Enter');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.url)
      .toBe(`${server.origin}/second.html?keep=2`);
    // A page with a policy filter runs none of its inline scripts.
    const policy = await open('/csp.html');
    expect(
      await policy.evaluate(() => (window as unknown as { inlineRan?: boolean }).inlineRan),
    ).toBeUndefined();
  } finally {
    await browser.close();
  }
});

test('applies procedural rules and blocks popups that the lists name', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/procedural.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/procedural.html'));
    const display = (id: string): Promise<string> =>
      page.evaluate((element) => {
        const found = document.getElementById(element);
        return found === null ? 'removed' : getComputedStyle(found).display;
      }, id);
    await expect.poll(() => display('sponsored')).toBe('none');
    await expect.poll(() => display('late')).toBe('none');
    expect(await display('news')).toBe('block');
    expect(await display('removed')).toBe('removed');

    await address.fill(`${server.origin}/popup.html`);
    await address.press('Enter');
    const opener = await waitForPage(browser, (url) => url.endsWith('/popup.html'));
    await opener.locator('#blocked').click();
    await opener.locator('#allowed').click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/popup.html`, `${server.origin}/second.html`]);
    expect((await shellState(browser.shell)).tabs[0]?.blocked).toBe(1);
  } finally {
    await browser.close();
  }
});

test('turns the blocker off for a whole domain, its other hosts included', async () => {
  const browser = await launch();
  try {
    await browser.main.evaluate(({ Menu }) => {
      const recorded: Electron.Menu[] = [];
      Object.assign(globalThis, { recordedMenus: recorded });
      Menu.prototype.popup = function popup(this: Electron.Menu) {
        recorded.push(this);
      };
    });
    // Hosts under localhost reach the fixture server, and news.localhost is their domain.
    const port = new URL(server.origin).port;
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const open = async (url: string): Promise<Page> => {
      await address.fill(url);
      await address.press('Enter');
      return waitForPage(browser, (current) => current === url);
    };
    await open(`http://www.news.localhost:${port}/blocker.html`);
    await browser.shell.getByRole('button', { name: 'Content blocker: 1 blocked' }).click();
    const lastMenu = (): Promise<string | undefined> =>
      browser.main.evaluate(() =>
        (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
          .at(-1)
          ?.items[2]?.label.replaceAll('&', ''),
      );
    await expect
      .poll(lastMenu)
      .toBe(
        process.platform === 'darwin'
          ? 'Block Ads on news.localhost'
          : 'Block ads on news.localhost',
      );
    await browser.main.evaluate(() => {
      (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
        .at(-1)
        ?.items[2]?.click();
    });
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    // Another host of the same domain is covered by the exception, another site is not.
    const other = await open(`http://shop.news.localhost:${port}/blocker.html`);
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        other.evaluate(() => (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded),
      )
      .toBe(true);
    await open(`${server.origin}/blocker.html`);
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: 2 blocked' }),
    ).toBeVisible();
    // The menu of a covered host offers to remove the exception of the domain.
    await open(`http://www.news.localhost:${port}/blocker.html`);
    await browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }).click();
    await expect
      .poll(lastMenu)
      .toBe(
        process.platform === 'darwin'
          ? 'Block Ads on news.localhost'
          : 'Block ads on news.localhost',
      );
  } finally {
    await browser.close();
  }
});
