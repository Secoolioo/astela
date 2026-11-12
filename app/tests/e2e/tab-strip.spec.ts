import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Frame, type Page } from '@playwright/test';
import type * as Electron from 'electron';
import {
  chooseMenuItem,
  FixtureServer,
  lastMenu,
  launch,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  tabViews,
  waitForPage,
  type Browser,
} from './harness.ts';

test('places the tab strip at a side and fits the page next to it', async () => {
  const browser = await launch([], { settings: { 'tabs.position': 'left' } });
  try {
    // The window shows one tab, whose view follows it to the settings.
    const page = async (): Promise<Electron.Rectangle | undefined> =>
      (await tabViews(browser)).find((view) => /^app:\/\/(?:newtab|settings)\//.test(view.url))
        ?.bounds;
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

test('shows the icon of a page in its tab, loaded like an image of the page without cookies', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    // The site has a cookie, which the page's own request carries.
    await browser.main.evaluate(
      ({ session }, url) =>
        session.fromPartition('persist:default').cookies.set({ url, name: 'visit', value: '1' }),
      server.origin,
    );
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/icon.html`);
    await address.press('Enter');
    const tab = browser.shell.getByRole('tab', { name: 'Page with an icon' });
    await expect(tab.locator('.favicon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    const page = server.requests.find((request) => request.path === '/icon.html');
    expect(page?.headers.cookie).toBe('visit=1');
    const icon = server.requests.find((request) => request.path === '/image.png');
    expect(icon).toBeDefined();
    expect(icon?.headers.cookie).toBeUndefined();
    // The request names its page and asks for an image, as the page's own images do.
    expect(icon?.headers.referer).toBe(`${server.origin}/icon.html`);
    expect(icon?.headers['sec-fetch-dest']).toBe('image');
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

test("takes the speaker away when one of the browser's own pages takes the place of a page that plays sound", async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/sound.html`);
    await address.press('Enter');
    const sound = browser.shell.getByRole('tab', { name: 'Sound' });
    await expect(sound.getByRole('button', { name: 'Mute tab' })).toBeVisible();
    // The settings page gets a view of its own in the same tab.
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = browser.shell.getByRole('tab', { name: 'Settings' });
    await expect(settings.locator('.favicon svg')).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Mute tab' })).toHaveCount(0);
    expect((await shellState(browser.shell)).tabs.map((tab) => tab.audible)).toEqual([false]);
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

/**
 * How far the active tab's surface is from the active tab, in whole pixels, once the tabs and
 * the surface stand still, or `moving` while they move.
 */
function surfaceOffset(shell: Page): Promise<string> {
  return shell.evaluate(() => {
    const root = document.querySelector('app-shell')?.shadowRoot;
    const surface = root?.querySelector('.indicator');
    const active = root?.querySelector('[role="tab"][aria-selected="true"]');
    if (root === undefined || root === null || surface === undefined || surface === null) {
      return 'missing';
    }
    if (active === undefined || active === null) return 'missing';
    const moving = root
      .getAnimations()
      .some(
        (animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target?.matches('.tab, .indicator') === true,
      );
    if (moving) return 'moving';
    const from = surface.getBoundingClientRect();
    const to = active.getBoundingClientRect();
    return [from.left - to.left, from.top - to.top, from.width - to.width, from.height - to.height]
      .map((difference) => Math.round(difference))
      .join(' ');
  });
}

/**
 * Renders the shell four more times while its tabs move, once it shows a number of tabs, as
 * the states do that the browser publishes while pages load.
 */
async function renderAgain(shell: Page, tabs: number): Promise<void> {
  await shell.evaluate(async (count) => {
    const host = document.querySelector('app-shell');
    if (host === null) throw new Error('The shell is missing');
    for (let frame = 0; frame < 300; frame += 1) {
      if (host.shadowRoot?.querySelectorAll('[role="tab"]').length === count) break;
      await new Promise((done) => requestAnimationFrame(done));
    }
    for (let round = 0; round < 4; round += 1) {
      await new Promise((done) => setTimeout(done, 20));
      Reflect.set(host, 'state', { ...(Reflect.get(host, 'state') as object) });
    }
  }, tabs);
}

test('keeps the surface of the active tab under it when tabs close, move or are dropped in place', async () => {
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
    await expect
      .poll(() => tabs.evaluateAll(titles))
      .toEqual(['Fixture home', 'Fixture second', 'Fixture opened']);
    await tabs.nth(1).click();
    await expect(active).toHaveAttribute('title', 'Fixture second');
    await expect.poll(() => surfaceOffset(shell)).toBe('0 0 0 0');
    // Closing the active tab in the middle moves the next tab into its place, while the
    // shell renders again.
    await pressNative(browser, 'W', ['primary']);
    await renderAgain(shell, 2);
    await expect(active).toHaveAttribute('title', 'Fixture opened');
    await expect.poll(() => surfaceOffset(shell)).toBe('0 0 0 0');
    // Windows and Linux move the active tab with Ctrl+Shift+Page Up.
    if (process.platform !== 'darwin') {
      await pressNative(browser, 'PageUp', ['primary', 'shift']);
      await expect.poll(() => tabs.evaluateAll(titles)).toEqual(['Fixture opened', 'Fixture home']);
      await expect.poll(() => surfaceOffset(shell)).toBe('0 0 0 0');
    }
    // A drag of the active tab that ends where it started brings the tab back with its surface.
    const box = await active.boundingBox();
    if (box === null) throw new Error('The tab is not visible');
    await shell.mouse.move(box.x + 20, box.y + box.height / 2);
    await shell.mouse.down();
    await shell.mouse.move(box.x + 50, box.y + box.height / 2, { steps: 6 });
    await shell.mouse.up();
    await expect(shell.locator('.tabs')).not.toHaveAttribute('data-dragging', '');
    await expect.poll(() => surfaceOffset(shell)).toBe('0 0 0 0');
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('slides the surface of the active tab once, also while the shell renders again meanwhile', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    await shell.getByRole('button', { name: 'New tab' }).click();
    await expect(shell.getByRole('tab')).toHaveCount(2);
    await expect.poll(() => surfaceOffset(shell)).toBe('0 0 0 0');
    // Switches to the first tab and renders the shell again while the surface slides there,
    // as the states do that the browser publishes while a page loads.
    const slides = await shell.evaluate(async () => {
      const host = document.querySelector('app-shell');
      const surface = host?.shadowRoot?.querySelector<HTMLElement>('.indicator');
      const first = host?.shadowRoot?.querySelector<HTMLElement>('[role="tab"]');
      if (host === null || host === undefined || surface === null || surface === undefined) {
        throw new Error('The tab strip is missing');
      }
      const started: Animation[] = [];
      const animate = surface.animate.bind(surface);
      surface.animate = (...args: Parameters<Element['animate']>): Animation => {
        const animation = animate(...args);
        started.push(animation);
        return animation;
      };
      first?.click();
      for (let frame = 0; frame < 300 && started.length === 0; frame += 1) {
        await new Promise((done) => requestAnimationFrame(done));
      }
      for (let round = 0; round < 4; round += 1) {
        await new Promise((done) => setTimeout(done, 20));
        Reflect.set(host, 'state', { ...(Reflect.get(host, 'state') as object) });
      }
      await Promise.all(started.map((animation) => animation.finished.catch(() => undefined)));
      return started.length;
    });
    expect(slides).toBe(1);
    await expect(shell.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => surfaceOffset(shell)).toBe('0 0 0 0');
  } finally {
    await browser.close();
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
    await chooseMenuItem(browser, ['Pin']);
    const tabs = shell.getByRole('tab');
    await expect.poll(() => tabs.evaluateAll(titles)).toEqual(['Fixture second', 'Fixture home']);
    await expect(tabs.first()).toHaveAttribute('data-pinned', '');
    await expect(tabs.first().locator('.title')).toBeHidden();
    await expect(tabs.first().getByRole('button', { name: 'Close tab' })).toBeHidden();
    expect((await tabs.first().boundingBox())?.width).toBeCloseTo(40, 1);
    // Duplicate opens the page again right after the tab, which is not pinned.
    await shell.getByRole('tab', { name: 'Fixture home' }).click({ button: 'right' });
    await chooseMenuItem(browser, ['Duplicate']);
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

test('names the tabs below a tab in its menu at a side, and runs no item once the tab closed', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch([], { settings: { 'tabs.position': 'left' } });
  try {
    const shell = browser.shell;
    await expect(shell.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
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
    const mac = process.platform === 'darwin';
    await expect
      .poll(() => lastMenu(browser))
      .toEqual(
        expect.arrayContaining(
          mac ? ['New Tab Below', 'Close Tabs Below'] : ['New tab below', 'Close tabs below'],
        ),
      );
    expect((await lastMenu(browser)).join()).not.toMatch(/right/i);
    // The tab closes while its menu is open, as a page that closes itself does.
    await second.getByRole('button', { name: 'Close tab' }).click();
    await expect(shell.getByRole('tab')).toHaveCount(1);
    for (const [index, label] of ['Reload', 'Pin', 'Close'].entries()) {
      await chooseMenuItem(browser, [label], { again: index > 0 });
    }
    await expect(shell.getByRole('tab')).toHaveCount(1);
    await expect(shell.getByRole('tab')).toHaveAttribute('title', 'Fixture home');
    await expect(shell.getByRole('tab')).not.toHaveAttribute('data-pinned', '');
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('drags no tab once the button is up, also after a press whose release went to a menu', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    await shell.getByRole('button', { name: 'New tab' }).click();
    await shell.getByRole('button', { name: 'New tab' }).click();
    const tabs = shell.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await recordMenus(browser);
    const first = await tabs.first().boundingBox();
    if (first === null) throw new Error('The tab is not visible');
    const y = first.y + first.height / 2;
    const transforms = (): Promise<string[]> =>
      tabs.evaluateAll((elements) =>
        elements.map((element) => (element instanceof HTMLElement ? element.style.transform : '')),
      );
    const session = await shell.context().newCDPSession(shell);
    // Control and the primary button: on macOS, this opens the menu of the tab, which takes
    // the release of the button, so the shell never sees it.
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: first.x + 20,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers: 2,
    });
    if (process.platform === 'darwin') {
      await expect.poll(() => lastMenu(browser)).toContain('Duplicate');
    }
    // The pointer then moves along the tab strip without a button.
    for (let step = 1; step <= 10; step += 1) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: first.x + 20 + step * 30,
        y,
        button: 'none',
        buttons: 0,
      });
    }
    await session.detach();
    await expect(shell.locator('.tabs')).not.toHaveAttribute('data-dragging', '');
    expect(await transforms()).toEqual(['', '', '']);
    // A click afterwards chooses its tab and moves none.
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(shell.locator('.tabs')).not.toHaveAttribute('data-dragging', '');
    expect(await transforms()).toEqual(['', '', '']);
  } finally {
    await browser.close();
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

/**
 * How an element of a page, or a pseudo-element of it, computes its regions that move a
 * window: `app-region`, and `window-drag` where the engine knows it.
 */
function appRegions(page: Page | Frame, targets: Record<string, string>): Promise<unknown> {
  return page.evaluate(
    (selectors) =>
      Object.fromEntries(
        Object.entries(selectors).map(([name, target]) => {
          const [selector = '', pseudo] = target.split('|');
          const element = document.querySelector(selector);
          if (element === null) return [name, 'missing'];
          const style = getComputedStyle(element, pseudo);
          const region = style.getPropertyValue('-webkit-app-region');
          const drag = CSS.supports('window-drag', 'move')
            ? style.getPropertyValue('window-drag')
            : 'none';
          return [name, `${region} ${drag}`];
        }),
      ),
    targets,
  );
}

test('keeps web pages from marking parts of the window that move it', async () => {
  const server = new FixtureServer();
  await server.start();
  // The content blocker is off: what keeps pages from moving the window does not depend on it.
  const browser = await launch([], { settings: { 'contentBlocker.enabled': false } });
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/app-region.html`);
    await address.press('Enter');
    const page = await waitForPage(browser, (url) => url.endsWith('/app-region.html'));
    await page.waitForLoadState('load');
    // Every element keeps the initial value, which marks no region; the page's own declarations,
    // also those with !important and those of pseudo-elements, have no effect.
    await expect
      .poll(() =>
        appRegions(page, {
          cover: '#cover',
          before: '#cover|::before',
          inline: '#inline',
          standard: '#standard',
        }),
      )
      .toEqual({
        cover: 'none none',
        before: 'none none',
        inline: 'none none',
        standard: 'none none',
      });
    const frame = page
      .frames()
      .find((candidate) => candidate.url().endsWith('/app-region-frame.html'));
    expect(frame).toBeDefined();
    if (frame !== undefined) {
      await expect
        .poll(() => appRegions(frame, { cover: '#cover' }))
        .toEqual({ cover: 'none none' });
    }
    // A blank page that a script opened and filled, before it had a document of its own. The
    // page that wrote it lends it its address, so it is found by its title.
    await page.getByRole('button', { name: 'Open a blank page' }).click();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const written = async (): Promise<Page | undefined> => {
      for (const candidate of browser.cdp.contexts().flatMap((context) => context.pages())) {
        if ((await candidate.title().catch(() => '')) === 'Written') return candidate;
      }
      return undefined;
    };
    await expect.poll(async () => (await written()) !== undefined).toBe(true);
    const blank = await written();
    expect(blank).toBeDefined();
    if (blank !== undefined) {
      await expect
        .poll(() => appRegions(blank, { written: '#written' }))
        .toEqual({ written: 'none none' });
    }
    // The shell keeps its own title bar.
    expect(
      await browser.shell.evaluate(() => {
        const row = document.querySelector('app-shell')?.shadowRoot?.querySelector('.top-row');
        return row === null || row === undefined
          ? 'missing'
          : getComputedStyle(row).getPropertyValue('-webkit-app-region');
      }),
    ).toBe('drag');
  } finally {
    await browser.close();
    await server.stop();
  }
});

/** Opens the settings page at one of its settings. */
async function openSetting(browser: Browser, setting: string): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`app://settings/#${setting}`);
  await address.press('Enter');
  return waitForPage(browser, (url) => url.startsWith('app://settings'));
}

test('fits the window controls to the top row when the density, the colors or the place of the tabs change', async () => {
  const mac = process.platform === 'darwin';
  const browser = await launch([], { settings: { 'appearance.colorMode': 'light' } });
  try {
    // Windows and Linux: the window controls that the browser gives Chromium to draw, and how
    // high Chromium drew them. macOS: where the three buttons of the window are.
    await browser.main.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0];
      if (window === undefined || process.platform === 'darwin') return;
      const overlays: Electron.TitleBarOverlay[] = [];
      Object.assign(globalThis, { overlays });
      const set = window.setTitleBarOverlay.bind(window);
      window.setTitleBarOverlay = (overlay) => {
        overlays.push(overlay);
        set(overlay);
      };
    });
    const controls = (): Promise<unknown> =>
      mac
        ? browser.main.evaluate(({ BaseWindow }) =>
            BaseWindow.getAllWindows()[0]?.getWindowButtonPosition(),
          )
        : browser.main.evaluate(() =>
            (globalThis as unknown as { overlays: Electron.TitleBarOverlay[] }).overlays.at(-1),
          );
    const drawnHeight = (): Promise<number> =>
      browser.shell.evaluate(
        () =>
          (
            Reflect.get(navigator, 'windowControlsOverlay') as { getTitlebarAreaRect(): DOMRect }
          ).getTitlebarAreaRect().height,
      );
    const settings = await openSetting(browser, 'appearance.density');
    // Compact: the tabs are 28 px high, with 2 px above them.
    await settings.getByRole('radio', { name: 'Compact' }).check();
    if (mac) {
      await expect.poll(controls).toEqual({ x: 14, y: 8 });
    } else {
      await expect.poll(controls).toEqual({ color: '#f5f7f9', symbolColor: '#1f2329', height: 30 });
      await expect.poll(drawnHeight).toBe(30);
    }
    // The controls take the colors of the dark mode.
    await settings.getByRole('radio', { name: 'Dark', exact: true }).check();
    if (!mac) {
      await expect.poll(controls).toEqual({ color: '#14161a', symbolColor: '#e8eaed', height: 30 });
    }
    // With the tabs at a side, the toolbar is the top row, in its own color.
    await settings.getByRole('radio', { name: 'Left' }).check();
    if (mac) {
      await expect.poll(controls).toEqual({ x: 14, y: 9 });
    } else {
      await expect.poll(controls).toEqual({ color: '#1f2226', symbolColor: '#e8eaed', height: 32 });
      await expect.poll(drawnHeight).toBe(32);
    }
  } finally {
    await browser.close();
  }
});

test('leaves no room for the window controls in full screen, where the system hides them', async () => {
  const mac = process.platform === 'darwin';
  const browser = await launch();
  try {
    const host = browser.shell.locator('app-shell');
    const side = mac ? 'start' : 'end';
    await expect(host).toHaveAttribute('data-titlebar', side);
    const padding = (): Promise<string> =>
      browser.shell.evaluate(() => {
        const row = document.querySelector('app-shell')?.shadowRoot?.querySelector('.top-row');
        if (row === null || row === undefined) return 'missing';
        const style = getComputedStyle(row);
        return `${style.paddingLeft} ${style.paddingRight}`;
      });
    const fullScreen = async (on: boolean): Promise<void> => {
      await pressNative(browser, mac ? 'F' : 'F11', mac ? ['control', 'primary'] : []);
      await expect
        .poll(
          () =>
            browser.main.evaluate(({ BaseWindow }) =>
              BaseWindow.getAllWindows()[0]?.isFullScreen(),
            ),
          { timeout: 15_000 },
        )
        .toBe(on);
    };
    await fullScreen(true);
    await expect(host).not.toHaveAttribute('data-titlebar', /.*/);
    // The row keeps only its own padding, the same at both ends.
    await expect.poll(padding).toBe('8px 8px');
    await fullScreen(false);
    await expect(host).toHaveAttribute('data-titlebar', side);
    await expect.poll(padding).not.toBe('8px 8px');
  } finally {
    await browser.close();
  }
});

/**
 * How much more free room the top row of the shell has at its end, after its last button, than
 * the room that the shell keeps there at least, `--space-7`; negative with less room.
 */
function extraRoom(): number {
  const host = document.querySelector('app-shell');
  const row = host?.shadowRoot?.querySelector('.top-row');
  const last = row?.querySelector(':scope > button:last-of-type');
  if (host === null || row === null || row === undefined || last === null || last === undefined) {
    return -1000;
  }
  const end =
    row.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(row).paddingRight);
  const least = Number.parseFloat(getComputedStyle(host).getPropertyValue('--space-7'));
  return least > 0 ? Math.round(end - last.getBoundingClientRect().right - least) : -1000;
}

test('keeps free room to move the window in the top row when the tabs or the address bar fill it', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  mkdirSync(join(profile, 'data'), { recursive: true });
  const tabs = Array.from({ length: 24 }, (_, index) => ({
    url: `https://site${index}.test/`,
    title: `Site ${index}`,
  }));
  writeFileSync(
    join(profile, 'data', 'session.json'),
    JSON.stringify({
      version: 1,
      windows: [{ tabs, active: 0, bounds: { x: 0, y: 0, width: 1000, height: 700 } }],
    }),
  );
  const browser = await launch(['--host-resolver-rules=MAP * ~NOTFOUND'], { profile });
  try {
    await expect(browser.shell.getByRole('tab')).toHaveCount(24);
    // The tabs fill the row and scroll, and the room after the new tab button stays.
    await expect(browser.shell.locator('.tabs')).toHaveAttribute('data-after', '');
    await expect.poll(() => browser.shell.evaluate(extraRoom)).toBeGreaterThanOrEqual(0);
    // With the tabs at a side, the toolbar is the top row; the address bar leaves the room.
    const settings = await openSetting(browser, 'tabs.position');
    await settings.getByRole('radio', { name: 'Left' }).check();
    await expect(browser.shell.getByRole('tablist')).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    await expect.poll(() => browser.shell.evaluate(extraRoom)).toBeGreaterThanOrEqual(0);
  } finally {
    await browser.close();
  }
});

test('leaves room for the window controls where the window draws them', async () => {
  test.skip(process.platform === 'darwin', 'The buttons of a window on macOS are at its start');
  // A Linux desktop that puts the window buttons at the start of the title bar, as elementary
  // OS does, or GNOME when told to.
  const config = mkdtempSync(join(tmpdir(), 'e2e-config-'));
  for (const gtk of ['gtk-3.0', 'gtk-4.0']) {
    mkdirSync(join(config, gtk));
    writeFileSync(
      join(config, gtk, 'settings.ini'),
      '[Settings]\ngtk-decoration-layout=close,minimize,maximize:\n',
    );
  }
  const linux = process.platform === 'linux';
  const browser = await launch([], linux ? { env: { XDG_CONFIG_HOME: config } } : {});
  try {
    const layout = (): Promise<{
      visible: boolean;
      start: number;
      end: number;
      left: number;
      right: number;
      tab: number;
    }> =>
      browser.shell.evaluate(() => {
        const overlay = Reflect.get(navigator, 'windowControlsOverlay') as {
          readonly visible: boolean;
          getTitlebarAreaRect(): DOMRect;
        };
        const free = overlay.getTitlebarAreaRect();
        const host = document.querySelector('app-shell');
        const root = host?.shadowRoot;
        const row = root?.querySelector('.top-row');
        const space =
          host === null
            ? 0
            : Number.parseFloat(getComputedStyle(host).getPropertyValue('--space-2'));
        const style = row === null || row === undefined ? undefined : getComputedStyle(row);
        return {
          visible: overlay.visible,
          start: Math.round(free.x),
          end: Math.round(window.innerWidth - free.right),
          // The room that the row leaves at its ends, without its own padding.
          left: style === undefined ? -1 : Number.parseFloat(style.paddingLeft) - space,
          right: style === undefined ? -1 : Number.parseFloat(style.paddingRight) - space,
          tab: root?.querySelector('[role="tab"]')?.getBoundingClientRect().left ?? -1,
        };
      });
    await expect.poll(async () => (await layout()).visible).toBe(true);
    await expect
      .poll(async () => {
        const { start, end, left, right } = await layout();
        return { left: left - start, right: right - end };
      })
      .toEqual({ left: 0, right: 0 });
    const { start, tab } = await layout();
    if (linux) expect(start, 'the window buttons at the start of the row').toBeGreaterThan(0);
    // The first tab starts after the buttons.
    expect(tab).toBeGreaterThanOrEqual(start);
    await expect(browser.shell.locator('app-shell')).toHaveAttribute(
      'data-titlebar',
      linux ? 'start' : 'end',
    );
  } finally {
    await browser.close();
    rmSync(config, { recursive: true, force: true });
  }
});

test('leaves a click next to a popover to the overlay instead of moving the window', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    const region = (): Promise<string> =>
      browser.shell.evaluate(() => {
        const row = document.querySelector('app-shell')?.shadowRoot?.querySelector('.top-row');
        return row === null || row === undefined
          ? 'missing'
          : getComputedStyle(row).getPropertyValue('-webkit-app-region');
      });
    expect(await region()).toBe('drag');
    // The popover covers the whole window: the top row below it moves the window no more.
    await browser.shell.getByRole('button', { name: /^Content blocker:/ }).click();
    const overlay = await overlayPage(browser);
    await expect(overlay.getByRole('dialog', { name: 'Content blocker' })).toBeVisible();
    await expect.poll(async () => (await shellState(browser.shell)).covered).toBe(true);
    await expect.poll(region).toBe('no-drag');
    await overlay.keyboard.press('Escape');
    await expect.poll(async () => (await shellState(browser.shell)).covered).toBe(false);
    await expect.poll(region).toBe('drag');
  } finally {
    await browser.close();
    await server.stop();
  }
});
