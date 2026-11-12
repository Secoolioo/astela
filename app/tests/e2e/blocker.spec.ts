import { expect, test, type Page } from '@playwright/test';
import {
  chooseMenuItem,
  FixtureServer,
  launch,
  overlayAttached,
  overlayPage,
  packageWithoutBlockerData,
  recordMenus,
  shellState,
  waitForPage,
  type Browser,
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
          {
            key: 'contentBlocker.enabled',
            value: false,
            locked: false,
            changed: true,
            recommended: false,
            restart: false,
          },
        ]),
      });
  } finally {
    await browser.close();
  }
});

test('counts blocked requests and switches the blocker off for one site', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocker.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
    const overlay = await openShield(browser, 'Content blocker: 2 blocked');
    const popover = overlay.getByRole('dialog', { name: 'Content blocker' });
    await expect(popover).toContainText('127.0.0.1');
    await expect(popover.locator('strong')).toHaveText('2');
    await expect(popover).toContainText('blocked on this page');
    // The popover counts along when the page loads more that the lists block.
    await page.evaluate(() => {
      const script = document.createElement('script');
      script.src = 'fixture-ad.js?again';
      document.head.append(script);
    });
    await expect(popover.locator('strong')).toHaveText('3');
    const blockHere = popover.getByRole('switch', { name: 'Block ads on 127.0.0.1' });
    await expect(blockHere).toBeChecked();
    await blockHere.click();
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    await expect(blockHere).not.toBeChecked();
    // The page reloads, so asking it can fail until the new page is there.
    await expect
      .poll(() =>
        page
          .evaluate(() => (window as unknown as { fixtureAdLoaded?: boolean }).fixtureAdLoaded)
          .catch(() => undefined),
      )
      .toBe(true);
    // The popover's way to the settings opens them and closes the popover.
    await popover.getByRole('button', { name: 'Content blocker settings' }).click();
    await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await expect.poll(() => overlayAttached(browser)).toBe(false);
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
    // The stand-ins load also where the page's policy allows only its own scripts, and a page
    // cannot load them by itself to find out that the browser blocks.
    const strict = await open('/redirect-csp.html');
    await expect
      .poll(() => strict.evaluate(() => (window as unknown as { events: string[] }).events))
      .toEqual(['noop:load', 'ima:load']);
    expect(
      await strict.evaluate(async () => {
        try {
          return (await fetch('astela-resource://resource/noop.js')).status;
        } catch {
          return 'refused';
        }
      }),
    ).not.toBe(200);
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

// The fixture lists block fixture-icon.png only as an image of a page of the fixture server,
// so the icon's request must reach the blocker as an image and with its page.
test('blocks the icon of a page as the lists block the images of the page', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocked-icon.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/blocked-icon.html'));
    await page.waitForLoadState('load');
    await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.loading).toBe(false);
    // An icon that the lists allow comes after it in the same tab, so the blocked icon had
    // its turn long before.
    await address.fill(`${server.origin}/icon.html`);
    await address.press('Enter');
    await expect(
      browser.shell.getByRole('tab', { name: 'Page with an icon' }).locator('.favicon img'),
    ).toHaveAttribute('src', /^data:image\/png;base64,/);
    expect(server.requests.map((request) => request.path)).toContain('/image.png');
    expect(server.requests.map((request) => request.path)).not.toContain('/fixture-icon.png');
  } finally {
    await browser.close();
  }
});

test('turns the blocker off for a whole domain, its other hosts included', async () => {
  const browser = await launch();
  try {
    // Hosts under localhost reach the fixture server, and news.localhost is their domain.
    const port = new URL(server.origin).port;
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const open = async (url: string): Promise<Page> => {
      await address.fill(url);
      await address.press('Enter');
      return waitForPage(browser, (current) => current === url);
    };
    await open(`http://www.news.localhost:${port}/blocker.html`);
    const overlay = await openShield(browser, 'Content blocker: 1 blocked');
    await overlay.getByRole('switch', { name: 'Block ads on news.localhost' }).click();
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
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
    // The popover of a covered host offers to remove the exception of the domain.
    await open(`http://www.news.localhost:${port}/blocker.html`);
    await openShield(browser, 'Content blocker: off on this site');
    await expect(
      overlay.getByRole('switch', { name: 'Block ads on news.localhost' }),
    ).not.toBeChecked();
  } finally {
    await browser.close();
  }
});

test('closes the popover with Escape or a click next to it and gives the page the focus', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocker.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
    const overlay = await openShield(browser, 'Content blocker: 2 blocked');
    // The popover takes the focus, so the keyboard reaches its switch.
    await expect(overlay.getByRole('switch')).toBeFocused();
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await openShield(browser, 'Content blocker: 2 blocked');
    await expect.poll(() => overlayAttached(browser)).toBe(true);
    // A click next to the popover closes it and reaches nothing below.
    await overlay.mouse.click(40, 400);
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    expect((await shellState(browser.shell)).tabs).toHaveLength(1);
  } finally {
    await browser.close();
  }
});

test('opens the settings of the content blocker at its row from the shield, also a second time', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/blocker.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/blocker.html'));
    const overlay = await openShield(browser, 'Content blocker: 2 blocked');
    await overlay.getByRole('button', { name: 'Content blocker settings' }).click();
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await expect(settings).toHaveURL('app://settings/#contentBlocker.enabled');
    const blocker = settings.getByRole('switch', { name: 'Block ads and trackers' });
    await expect(blocker).toBeFocused();
    await expect(blocker).toBeInViewport();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // The settings scroll to their top and the search takes the focus; the page shows again.
    await settings.getByRole('searchbox', { name: 'Search settings' }).focus();
    await settings.evaluate(() => window.scrollTo(0, 0));
    await expect(blocker).not.toBeInViewport();
    await browser.shell.getByRole('tab', { name: 'Fixture blocker' }).click();
    await openShield(browser, 'Content blocker: 2 blocked');
    // The link leads to the address that the settings show already, and to their row again.
    await overlay.getByRole('button', { name: 'Content blocker settings' }).click();
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'Settings',
    );
    await expect(blocker).toBeFocused();
    await expect(blocker).toBeInViewport();
    await expect(settings).toHaveURL('app://settings/#contentBlocker.enabled');
    expect((await shellState(browser.shell)).tabs).toHaveLength(2);
  } finally {
    await browser.close();
  }
});

test('takes the settings that the browser menu opened to the row of the content blocker', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const fixture = `${server.origin}/blocker.html`;
    await address.fill(fixture);
    await address.press('Enter');
    await waitForPage(browser, (url) => url === fixture);
    // The menu opens the settings at their top, in a tab after that of the page.
    await recordMenus(browser);
    await browser.shell.getByRole('button', { name: 'Menu', exact: true }).click();
    await chooseMenuItem(browser, [process.platform === 'darwin' ? 'Settings…' : 'Settings']);
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await expect(settings).toHaveURL('app://settings/');
    const blocker = settings.getByRole('switch', { name: 'Block ads and trackers' });
    await expect(blocker).toBeVisible();
    await expect(blocker).not.toBeInViewport();
    await browser.shell.getByRole('tab', { name: 'Fixture blocker' }).click();
    const overlay = await openShield(browser, 'Content blocker: 2 blocked');
    // The link takes the tab of the settings to the address of the row.
    await overlay.getByRole('button', { name: 'Content blocker settings' }).click();
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'Settings',
    );
    await expect(settings).toHaveURL('app://settings/#contentBlocker.enabled');
    await expect(blocker).toBeFocused();
    await expect(blocker).toBeInViewport();
    expect((await shellState(browser.shell)).tabs.map((tab) => tab.url)).toEqual([
      fixture,
      'app://settings/#contentBlocker.enabled',
    ]);
  } finally {
    await browser.close();
  }
});

test('hides cookie notices and annoyances once their lists are on in the settings', async () => {
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const open = async (url: string): Promise<Page> => {
      await address.fill(url);
      await address.press('Enter');
      return waitForPage(browser, (current) => current.startsWith(url));
    };
    const extras = `${server.origin}/extras.html`;
    let page = await open(extras);
    expect(await displayOf(page, 'fixture-cookie-notice')).toBe('block');
    expect(await displayOf(page, 'fixture-newsletter')).toBe('block');
    // Going between a web page and the settings replaces the tab's view, and its page.
    let settings = await open('app://settings');
    await settings.getByRole('switch', { name: 'Hide cookie notices' }).check();
    page = await open(extras);
    await expect.poll(() => displayOf(page, 'fixture-cookie-notice')).toBe('none');
    expect(await displayOf(page, 'fixture-newsletter')).toBe('block');
    // The script at the end of the page has run, or was blocked, once the page has loaded.
    await loaded(page);
    expect(await page.evaluate(() => Reflect.get(window, 'fixtureAnnoyanceLoaded'))).toBe(true);
    settings = await open('app://settings');
    await settings.getByRole('switch', { name: 'Hide annoyances' }).check();
    page = await open(extras);
    await expect.poll(() => displayOf(page, 'fixture-newsletter')).toBe('none');
    await loaded(page);
    expect(await page.evaluate(() => Reflect.get(window, 'fixtureAnnoyanceLoaded'))).toBe(
      undefined,
    );
  } finally {
    await browser.close();
  }
});

test('lists the sites without blocking in the settings, to remove and to add them', async () => {
  const browser = await launch([], {
    settings: { 'contentBlocker.allowedSites': ['news.localhost'] },
  });
  try {
    const port = new URL(server.origin).port;
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    const open = async (url: string): Promise<Page> => {
      await address.fill(url);
      await address.press('Enter');
      return waitForPage(browser, (current) => current.startsWith(url));
    };
    let settings = await open('app://settings');
    let sites = settings.getByRole('list', { name: 'Sites without blocking' });
    await expect(sites.getByRole('listitem')).toHaveText(['news.localhost Remove']);
    await settings.getByRole('button', { name: 'Remove news.localhost' }).click();
    // The row of the list says so once its last site is gone.
    await expect(
      settings
        .locator('.row')
        .filter({ has: settings.locator('#allowed-sites') })
        .getByText('None', { exact: true }),
    ).toBeVisible();
    await open(`http://www.news.localhost:${port}/blocker.html`);
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: 1 blocked' }),
    ).toBeVisible();
    // A site can be typed with its address; what is no site name is refused.
    settings = await open('app://settings');
    sites = settings.getByRole('list', { name: 'Sites without blocking' });
    const field = settings.getByRole('textbox', { name: 'Site to add' });
    await field.fill('not a site');
    await field.press('Enter');
    await expect(settings.getByRole('alert')).toHaveText(
      'Enter the name of a site, such as example.com.',
    );
    await field.fill(`http://127.0.0.1:${port}/blocker.html`);
    await field.press('Enter');
    await expect(sites.getByRole('listitem')).toHaveText(['127.0.0.1 Remove']);
    await open(`${server.origin}/blocker.html`);
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: off on this site' }),
    ).toBeVisible();
  } finally {
    await browser.close();
  }
});

/** Waits until a page has loaded, with its scripts and images. */
async function loaded(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => document.readyState)).toBe('complete');
}

/** The display of an element of a page, or `missing` when the page has no such element. */
function displayOf(page: Page, id: string): Promise<string> {
  return page.evaluate((element) => {
    const found = document.getElementById(element);
    return found === null ? 'missing' : getComputedStyle(found).display;
  }, id);
}

/** Clicks the shield button and returns the page of the overlay that opens. */
async function openShield(browser: Browser, name: string): Promise<Page> {
  await browser.shell.getByRole('button', { name }).click();
  const overlay = await overlayPage(browser);
  await expect(overlay.getByRole('dialog', { name: 'Content blocker' })).toBeVisible();
  return overlay;
}
