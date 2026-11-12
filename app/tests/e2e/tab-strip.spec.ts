import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type * as Electron from 'electron';
import { FixtureServer, launch, pressNative, waitForPage, type Browser } from './harness.ts';

test('places the tab strip at a side and fits the page next to it', async () => {
  const browser = await launch([], { settings: { 'tabs.position': 'left' } });
  try {
    const page = (): Promise<Electron.Rectangle | undefined> =>
      browser.main.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.contentView.children[1]?.getBounds(),
      );
    const tabs = browser.shell.getByRole('tablist');
    await expect(tabs).toHaveAttribute('aria-orientation', 'vertical');
    await expect.poll(async () => (await page())?.x).toBe(240);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('radio', { name: 'Bottom' }).check();
    await expect(tabs).toHaveAttribute('aria-orientation', 'horizontal');
    await expect.poll(async () => (await page())?.x).toBe(0);
    const { height } = await browser.shell.evaluate(() => ({ height: window.innerHeight }));
    const strip = await tabs.boundingBox();
    const bounds = await page();
    expect(bounds !== undefined && strip !== null && bounds.y + bounds.height).toBe(
      Math.round(strip?.y ?? 0),
    );
    expect(Math.round((strip?.y ?? 0) + (strip?.height ?? 0))).toBe(height);
  } finally {
    await browser.close();
  }
});

test('shows the icon of a page in its tab, loaded without cookies', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/icon.html`);
    await address.press('Enter');
    const tab = browser.shell.getByRole('tab', { name: 'Page with an icon' });
    await expect(tab.locator('.favicon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const icon = server.requests.find((request) => request.path === '/image.png');
    expect(icon?.headers.cookie).toBeUndefined();
    // The browser's own pages show an icon of their own.
    await address.fill('app://settings');
    await address.press('Enter');
    await expect(
      browser.shell.getByRole('tab', { name: 'Settings' }).locator('.favicon svg'),
    ).toBeVisible();
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('mutes a tab that plays sound and turns its sound on again', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/sound.html`);
    await address.press('Enter');
    const muted = (): Promise<boolean | undefined> =>
      browser.main.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().endsWith('/sound.html'))
          ?.isAudioMuted(),
      );
    const tab = browser.shell.getByRole('tab', { name: 'Sound' });
    await tab.getByRole('button', { name: 'Mute tab' }).click();
    await expect(tab.getByRole('button', { name: 'Unmute tab' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await muted()).toBe(true);
    await tab.getByRole('button', { name: 'Unmute tab' }).click();
    await expect(tab.getByRole('button', { name: 'Mute tab' })).toBeVisible();
    expect(await muted()).toBe(false);
  } finally {
    await browser.close();
    await server.stop();
  }
});

/** The titles of the tabs in the order the strip shows them. */
function titles(tabs: Element[]): (string | null)[] {
  return tabs.map((tab) => tab.getAttribute('title'));
}

test('moves a tab that is dragged to another place, without making it the active tab', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await expect(shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
    await shell.getByRole('button', { name: 'New tab' }).click();
    await address.fill(`${server.origin}/second.html`);
    await address.press('Enter');
    await expect(shell.getByRole('tab', { name: 'Fixture second' })).toBeVisible();
    await shell.getByRole('button', { name: 'New tab' }).click();
    const tabs = shell.getByRole('tab');
    await expect
      .poll(() => tabs.evaluateAll(titles))
      .toEqual(['Fixture home', 'Fixture second', 'New tab']);
    const from = await shell.getByRole('tab', { name: 'Fixture home' }).boundingBox();
    const to = await shell.getByRole('tab', { name: 'New tab' }).boundingBox();
    if (from === null || to === null) throw new Error('The tabs are not visible');
    await shell.mouse.move(from.x + 20, from.y + from.height / 2);
    await shell.mouse.down();
    await shell.mouse.move(to.x + to.width - 10, to.y + to.height / 2, { steps: 10 });
    await shell.mouse.up();
    await expect
      .poll(() => tabs.evaluateAll(titles))
      .toEqual(['Fixture second', 'New tab', 'Fixture home']);
    await expect(shell.getByRole('tab', { name: 'New tab' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // A drag that ends where it started leaves the order as it was.
    const second = await shell.getByRole('tab', { name: 'Fixture second' }).boundingBox();
    if (second === null) throw new Error('The tab is not visible');
    await shell.mouse.move(second.x + 20, second.y + second.height / 2);
    await shell.mouse.down();
    await shell.mouse.move(second.x + 40, second.y + second.height / 2, { steps: 4 });
    await shell.mouse.move(second.x + 20, second.y + second.height / 2, { steps: 4 });
    await shell.mouse.up();
    await expect(shell.locator('.tabs')).not.toHaveAttribute('data-dragging', '');
    expect(await tabs.evaluateAll(titles)).toEqual(['Fixture second', 'New tab', 'Fixture home']);
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('animates tabs that open and close, but not when the system asks for reduced motion', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    // Counts the animations of tabs and of the active tab's surface.
    await shell.evaluate(() => {
      const counts = { tabs: 0 };
      Reflect.set(window, 'tabAnimations', counts);
      const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
        ?.value as Element['animate'];
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ): Animation {
        if (this.matches('.tab, .indicator')) counts.tabs += 1;
        return Reflect.apply(animate, this, args);
      };
    });
    const animations = (): Promise<number> =>
      shell.evaluate(() => (Reflect.get(window, 'tabAnimations') as { tabs: number }).tabs);
    const tabs = shell.getByRole('tab');
    await shell.getByRole('button', { name: 'New tab' }).click();
    await expect(tabs).toHaveCount(2);
    await expect.poll(animations).toBeGreaterThan(0);
    const opened = await animations();
    await tabs.last().getByRole('button', { name: 'Close tab' }).click();
    await expect(tabs).toHaveCount(1);
    await expect.poll(animations).toBeGreaterThan(opened);
    await shell.emulateMedia({ reducedMotion: 'reduce' });
    const still = await animations();
    await shell.getByRole('button', { name: 'New tab' }).click();
    await expect(tabs).toHaveCount(2);
    await tabs.last().getByRole('button', { name: 'Close tab' }).click();
    await expect(tabs).toHaveCount(1);
    expect(await animations()).toBe(still);
  } finally {
    await browser.close();
  }
});

test('fits many tabs: narrow tabs show their icon, the active one its close button, and the strip scrolls', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  mkdirSync(join(profile, 'data'), { recursive: true });
  const tabs = Array.from({ length: 40 }, (_, index) => ({
    url: `https://site${index}.test/`,
    title: `Site ${index}`,
  }));
  writeFileSync(
    join(profile, 'data', 'session.json'),
    JSON.stringify({
      version: 1,
      windows: [{ tabs, active: 39, bounds: { x: 0, y: 0, width: 1000, height: 700 } }],
    }),
  );
  const browser = await launch(['--host-resolver-rules=MAP * ~NOTFOUND'], { profile });
  try {
    const shell = browser.shell;
    const strip = shell.getByRole('tab');
    await expect(strip).toHaveCount(40);
    const widths = await strip.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().width),
    );
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(40);
    const active = shell.locator('[role="tab"][aria-selected="true"]');
    await expect(strip.last()).toHaveAttribute('aria-selected', 'true');
    await expect(strip.first()).toHaveAttribute('title', 'Site 0');
    await expect(active.getByRole('button', { name: 'Close tab' })).toBeVisible();
    await expect(strip.first().getByRole('button', { name: 'Close tab' })).toBeHidden();
    await expect(strip.first().locator('.title')).toBeHidden();
    await expect(strip.first().locator('.favicon')).toBeVisible();
    // The strip shows the active tab at its end, and a line marks the side of hidden tabs.
    await expect(shell.locator('.tabs')).toHaveAttribute('data-before', '');
    await expect(shell.locator('.tabs')).not.toHaveAttribute('data-after', '');
  } finally {
    await browser.close();
  }
});

/** Makes the browser record its menus instead of showing them, so a test can choose items. */
async function recordMenus(browser: Browser): Promise<void> {
  await browser.main.evaluate(({ Menu }) => {
    const recorded: Electron.Menu[] = [];
    Object.assign(globalThis, { recordedMenus: recorded });
    Menu.prototype.popup = function popup(this: Electron.Menu) {
      recorded.push(this);
    };
  });
}

/** Chooses an item of the last menu that the browser built, by its text without access keys. */
async function choose(browser: Browser, label: string): Promise<void> {
  await expect
    .poll(() =>
      browser.main.evaluate(
        () => (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus.length,
      ),
    )
    .toBeGreaterThan(0);
  await browser.main.evaluate((_electron, text) => {
    const { recordedMenus } = globalThis as unknown as { recordedMenus: Electron.Menu[] };
    const menu = recordedMenus.pop();
    const item = menu?.items.find((candidate) => candidate.label.replaceAll('&', '') === text);
    if (item === undefined) throw new Error(`No menu item ${text}`);
    item.click();
  }, label);
}

test('pins a tab from its menu, keeps it first and small, and pinned at the next start', async () => {
  const server = new FixtureServer();
  await server.start();
  let browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await shell.getByRole('button', { name: 'New tab' }).click();
    await address.fill(`${server.origin}/second.html`);
    await address.press('Enter');
    const second = shell.getByRole('tab', { name: 'Fixture second' });
    await expect(second).toBeVisible();
    await recordMenus(browser);
    await second.click({ button: 'right' });
    await choose(browser, 'Pin');
    const tabs = shell.getByRole('tab');
    await expect.poll(() => tabs.evaluateAll(titles)).toEqual(['Fixture second', 'Fixture home']);
    await expect(tabs.first()).toHaveAttribute('data-pinned', '');
    await expect(tabs.first().locator('.title')).toBeHidden();
    await expect(tabs.first().getByRole('button', { name: 'Close tab' })).toBeHidden();
    expect((await tabs.first().boundingBox())?.width).toBeCloseTo(40, 1);
    // Duplicate opens the page again right after the tab, which is not pinned.
    await shell.getByRole('tab', { name: 'Fixture home' }).click({ button: 'right' });
    await choose(browser, 'Duplicate');
    await expect
      .poll(() => tabs.evaluateAll(titles))
      .toEqual(['Fixture second', 'Fixture home', 'Fixture home']);
    const { profile } = browser;
    await browser.close({ keepProfile: true });
    browser = await launch(['--restore-last-session'], { profile });
    const restored = browser.shell.getByRole('tab');
    await expect(restored).toHaveCount(3);
    await expect(restored.first()).toHaveAttribute('data-pinned', '');
    await expect(restored.first()).toHaveAttribute('title', 'Fixture second');
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('switches to a tab by its place and moves the active tab with the keyboard', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    for (const page of ['index.html', 'second.html', 'opened.html']) {
      if (page !== 'index.html') await shell.getByRole('button', { name: 'New tab' }).click();
      await address.fill(`${server.origin}/${page}`);
      await address.press('Enter');
      await waitForPage(browser, (url) => url.endsWith(`/${page}`));
    }
    const tabs = shell.getByRole('tab');
    const active = shell.locator('[role="tab"][aria-selected="true"]');
    await pressNative(browser, '1', ['primary']);
    await expect(active).toHaveAttribute('title', 'Fixture home');
    await pressNative(browser, '9', ['primary']);
    await expect(active).toHaveAttribute('title', (await tabs.last().getAttribute('title')) ?? '');
    // Windows and Linux move the active tab with Ctrl+Shift+Page Up and Page Down.
    if (process.platform !== 'darwin') {
      const last = await tabs.last().getAttribute('title');
      await pressNative(browser, 'PageUp', ['primary', 'shift']);
      await expect
        .poll(() => tabs.evaluateAll(titles))
        .toEqual(['Fixture home', last, 'Fixture second']);
      await pressNative(browser, 'PageDown', ['primary', 'shift']);
      await expect
        .poll(() => tabs.evaluateAll(titles))
        .toEqual(['Fixture home', 'Fixture second', last]);
    }
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('draws the title bar with the tabs, and leaves it to the system after a restart when chosen', async () => {
  let browser = await launch();
  try {
    const host = browser.shell.locator('app-shell');
    const side = process.platform === 'darwin' ? 'start' : 'end';
    await expect(host).toHaveAttribute('data-titlebar', side);
    // The top row moves the window, and its tabs and buttons stay clickable.
    const regions = (): Promise<{ row: string; tab: string; button: string }> =>
      browser.shell.evaluate(() => {
        const root = document.querySelector('app-shell')?.shadowRoot;
        const region = (selector: string): string =>
          root === null || root === undefined
            ? ''
            : getComputedStyle(root.querySelector(selector) ?? document.body).getPropertyValue(
                '-webkit-app-region',
              );
        return {
          row: region('.top-row'),
          tab: region('[role="tab"]'),
          button: region('.top-row button'),
        };
      });
    expect(await regions()).toEqual({ row: 'drag', tab: 'no-drag', button: 'no-drag' });
    // Choosing the system's title bar waits for a restart.
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings/#appearance.titleBar');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.getByRole('radio', { name: 'Of the system' }).check();
    await expect(settings.getByText('Takes effect after a restart').first()).toBeVisible();
    await expect(host).toHaveAttribute('data-titlebar', side);
    const { profile } = browser;
    await browser.close({ keepProfile: true });
    browser = await launch([], { profile });
    await expect(browser.shell.getByRole('tablist')).toBeVisible();
    await expect(browser.shell.locator('app-shell')).not.toHaveAttribute('data-titlebar', /.*/);
  } finally {
    await browser.close();
  }
});
