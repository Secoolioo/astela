import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FixtureServer, launch, waitForPage } from './harness.ts';

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
