import { expect, test, type Page } from '@playwright/test';
import {
  FixtureServer,
  focusPage,
  launch,
  menuCount,
  menuEntries,
  openBrowserMenu,
  overlayAttached,
  overlayMenu,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});

/** Opens a page of the fixture server in the first tab. */
async function open(browser: Browser, name: string): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(`${server.origin}/${name}`);
  await address.press('Enter');
  const page = await waitForPage(browser, (url) => url === `${server.origin}/${name}`);
  await page.waitForLoadState('load');
  return page;
}

/** How many windows are open. */
function windowCount(browser: Browser): Promise<number> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
}

/** The menu button of the first window. */
function menuButton(browser: Browser): ReturnType<Page['getByRole']> {
  return browser.shell.getByRole('button', { name: 'Menu', exact: true });
}

/** How many views of the overlay the browser made, shown or not. */
function overlayViews(browser: Browser): Promise<number> {
  return browser.main.evaluate(
    ({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().startsWith('app://overlay')).length,
  );
}

/** Presses or releases Alt alone in a view whose address starts with a prefix. */
async function alt(browser: Browser, type: 'keyDown' | 'keyUp', prefix: string): Promise<void> {
  await browser.main.evaluate(
    ({ webContents }, { start, kind }) => {
      const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(start));
      view?.sendInputEvent({
        type: kind,
        keyCode: 'Alt',
        modifiers: kind === 'keyDown' ? ['alt'] : [],
      });
    },
    { start: prefix, kind: type },
  );
}

/** Whether a view whose address starts with a prefix has the focus of its window. */
function focused(browser: Browser, prefix: string): Promise<boolean> {
  return browser.main.evaluate(
    ({ webContents }, start) =>
      webContents
        .getAllWebContents()
        .some((contents) => contents.getURL().startsWith(start) && contents.isFocused()),
    prefix,
  );
}

test('opens the browser menu in the overlay and leaves no native menu', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'false');
    const menu = await openBrowserMenu(browser);
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'true');
    const zoom = mac
      ? 'Zoom: Zoom Out, Reset Zoom, Zoom In, Toggle Full Screen'
      : 'Zoom: Zoom out, Reset zoom, Zoom in, Full screen';
    expect(await menuEntries(menu)).toEqual(
      mac
        ? [
            'New Tab ⌘T',
            'New Window ⌘N',
            'New Private Window ⇧⌘N',
            'Close Window ⇧⌘W',
            '-',
            zoom,
            '-',
            'History ⌘Y',
            'Downloads ⌥⌘L',
            'Bookmarks ⇧⌘O',
            '-',
            'Command Palette… ⌘K',
            'Search Tabs… ⇧⌘A',
            '-',
            'Find… ⌘F',
            'Reader View ⌥⌘R',
            'Picture in Picture',
            'Print… ⌘P',
            'Save Page As… ⌘S',
            'More Tools',
            '-',
            'Settings… ⌘,',
            'About Astela',
            'Quit Astela ⌘Q',
          ]
        : [
            'New tab Ctrl+T',
            'New window Ctrl+N',
            'New private window Ctrl+Shift+N',
            'Close window Ctrl+Shift+W',
            '-',
            zoom,
            '-',
            'History Ctrl+H',
            'Downloads Ctrl+J',
            'Bookmarks Ctrl+Shift+O',
            '-',
            'Command palette… Ctrl+K',
            'Search tabs… Ctrl+Shift+A',
            '-',
            'Find… Ctrl+F',
            'Reader view F9',
            'Picture in picture',
            'Print… Ctrl+P',
            'Save page as… Ctrl+S',
            'More tools',
            '-',
            'Settings',
            'About Astela',
            process.platform === 'win32' ? 'Exit' : 'Quit',
          ],
    );
    // The new tab page is one of the browser's own pages, which the page tools leave alone.
    for (const name of mac
      ? ['Find…', 'Print…', 'Save Page As…']
      : ['Find…', 'Print…', 'Save page as…']) {
      await expect(menu.getByRole('menuitem', { name, exact: true })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    // It has no article, so the reader view cannot show; its item is not checked.
    const reader = menu.getByRole('menuitemcheckbox', {
      name: mac ? 'Reader View' : 'Reader view',
      exact: true,
    });
    await expect(reader).toHaveAttribute('aria-disabled', 'true');
    await expect(reader).toHaveAttribute('aria-checked', 'false');
    // Nor a video, so picture in picture cannot show one; its item is not checked either.
    const pictureInPicture = menu.getByRole('menuitemcheckbox', {
      name: mac ? 'Picture in Picture' : 'Picture in picture',
      exact: true,
    });
    await expect(pictureInPicture).toHaveAttribute('aria-disabled', 'true');
    await expect(pictureInPicture).toHaveAttribute('aria-checked', 'false');
    await expect(menu.getByRole('menuitem', { name: mac ? 'New Tab' : 'New tab' })).toHaveAttribute(
      'aria-keyshortcuts',
      mac ? 'Meta+T' : 'Control+T',
    );
    await menu
      .getByRole('menuitem', { name: mac ? 'New Window' : 'New window', exact: true })
      .click();
    await expect.poll(() => windowCount(browser)).toBe(2);
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'false');
    expect(await menuCount(browser)).toBe(0);
  } finally {
    await browser.close();
  }
});

test('changes the zoom from the zoom row and keeps the menu open', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html');
    const zoomOf = async (): Promise<number | undefined> =>
      (await shellState(browser.shell)).tabs[0]?.zoom;
    const menu = await openBrowserMenu(browser);
    const zoom = menu.getByRole('group', { name: 'Zoom' });
    const reset = zoom.getByRole('menuitem', { name: mac ? 'Reset Zoom' : 'Reset zoom' });
    const zoomIn = zoom.getByRole('menuitem', { name: mac ? 'Zoom In' : 'Zoom in' });
    const zoomOut = zoom.getByRole('menuitem', { name: mac ? 'Zoom Out' : 'Zoom out' });
    await expect(reset).toHaveText('100%');
    await zoomIn.click();
    await expect.poll(zoomOf).toBeCloseTo(1.1, 3);
    await expect(menu).toBeVisible();
    await expect(reset).toHaveText('110%');
    await expect(zoom.locator('[aria-live]')).toHaveText('Zoom 110%');
    await reset.click();
    await expect.poll(zoomOf).toBeCloseTo(1, 3);
    await expect(reset).toHaveText('100%');
    // Out to the smallest zoom, where zooming out stops.
    for (let step = 0; step < 7; step += 1) await zoomOut.click();
    await expect.poll(zoomOf).toBeCloseTo(0.25, 3);
    await expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
    await expect(zoomIn).not.toHaveAttribute('aria-disabled', 'true');
    await expect(reset).toHaveText('25%');
    await expect(menu).toBeVisible();
    const fullScreen = zoom.getByRole('menuitemcheckbox', {
      name: mac ? 'Toggle Full Screen' : 'Full screen',
    });
    await expect(fullScreen).toHaveAttribute('aria-checked', 'false');
    await fullScreen.click();
    await expect
      .poll(() =>
        browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.isFullScreen()),
      )
      .toBe(true);
    await expect.poll(() => overlayAttached(browser)).toBe(false);
  } finally {
    await browser.close();
  }
});

test('opens the menu from its button with the keyboard, its submenus with the arrows, and gives the focus back to the button', async () => {
  const browser = await launch();
  try {
    // On a web page, the tools of More tools can be chosen, so its first item takes the focus.
    await open(browser, 'index.html');
    await focusPage(browser, browser.shell);
    await menuButton(browser).focus();
    await menuButton(browser).press('Enter');
    const menu = await overlayMenu(browser);
    const first = menu.getByRole('menuitem', { name: mac ? 'New Tab' : 'New tab', exact: true });
    await expect(first).toBeFocused();
    const overlay = menu.page();
    // From the end, past the separator, to the submenu.
    await overlay.keyboard.press('End');
    await expect(
      menu.getByRole('menuitem', {
        name: mac ? 'Quit Astela' : process.platform === 'win32' ? 'Exit' : 'Quit',
      }),
    ).toBeFocused();
    for (let step = 0; step < 3; step += 1) await overlay.keyboard.press('ArrowUp');
    const moreTools = menu.getByRole('menuitem', { name: mac ? 'More Tools' : 'More tools' });
    await expect(moreTools).toBeFocused();
    await expect(moreTools).toHaveAttribute('aria-expanded', 'false');
    await overlay.keyboard.press('ArrowRight');
    const tools = await overlayMenu(browser, mac ? 'More Tools' : 'More tools');
    await expect(tools.getByRole('menuitem', { name: 'Save as PDF…' })).toBeFocused();
    await expect(moreTools).toHaveAttribute('aria-expanded', 'true');
    await overlay.keyboard.press('ArrowLeft');
    await expect(tools).toBeHidden();
    await expect(moreTools).toBeFocused();
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // The keyboard goes on from the menu button.
    await expect.poll(() => focused(browser, 'app://shell')).toBe(true);
    await expect(menuButton(browser)).toBeFocused();
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'false');
    // The arrow down opens the menu from its button as well.
    await menuButton(browser).press('ArrowDown');
    await expect(first).toBeFocused();
  } finally {
    await browser.close();
  }
});

/** The shell of the window that opened after the first one. */
async function secondShell(browser: Browser): Promise<Page> {
  const find = (): Page | undefined =>
    browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .find(
        (page) =>
          !page.isClosed() && page.url().startsWith('app://shell') && page !== browser.shell,
      );
  await expect.poll(() => find() !== undefined).toBe(true);
  const shell = find();
  if (shell === undefined) throw new Error('The second window has no shell');
  await expect(shell.getByRole('tab')).toHaveCount(1);
  return shell;
}

test('closes a window from the browser menu and with its shortcut, and keeps the others', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html');
    await pressNative(browser, 'N', ['primary']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    const second = await secondShell(browser);
    const overlays = browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url().startsWith('app://overlay'));
    await second.getByRole('button', { name: 'Menu', exact: true }).click();
    const menu = await overlayMenu(browser, 'Menu', overlays);
    const close = menu.getByRole('menuitem', { name: mac ? 'Close Window' : 'Close window' });
    await expect(close).toHaveAttribute(
      'aria-keyshortcuts',
      mac ? 'Shift+Meta+W' : 'Control+Shift+W',
    );
    await close.click();
    await expect.poll(() => windowCount(browser)).toBe(1);
    // Shift with the key that closes a tab closes the window that has the focus.
    await pressNative(browser, 'N', ['primary']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    await secondShell(browser);
    // Its new tab page is the only one: the first window shows a page of the server.
    await pressNative(browser, 'W', ['primary', 'shift'], 'app://newtab');
    await expect.poll(() => windowCount(browser)).toBe(1);
    // The first window keeps its tab.
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.map((tab) => tab.url))
      .toEqual([`${server.origin}/index.html`]);
  } finally {
    await browser.close();
  }
});

test('speaks German with German access keys and key names', async () => {
  const browser = await launch(['--lang=de']);
  try {
    if (mac) {
      // The shell speaks German, so its menu button is named Menü.
      const button = browser.shell.getByRole('button', { name: 'Menü', exact: true });
      await focusPage(browser, browser.shell);
      await button.focus();
      await button.press('Enter');
    } else {
      await pressNative(browser, 'F10');
    }
    const menu = await overlayMenu(browser, 'Menü');
    const entries = await menuEntries(menu);
    // macOS shows Command+Q next to Quit in any case.
    const keys = mac
      ? ['Neuer Tab ⌘T', 'Neues privates Fenster ⇧⌘N', 'Fenster schließen ⇧⌘W', 'Beenden ⌘Q']
      : [
          'Neuer Tab Strg+T',
          'Neues privates Fenster Strg+Umschalt+N',
          'Fenster schließen Strg+Umschalt+W',
          'Beenden',
        ];
    expect(entries).toEqual(expect.arrayContaining([...keys, 'Weitere Tools']));
    const history = menu.getByRole('menuitem', { name: 'Verlauf', exact: true });
    await expect(history).toBeVisible();
    if (!mac) {
      // The keyboard opened the menu, so its access keys show.
      const key = history.locator('.key');
      await expect(key).toHaveText('V');
      await expect(key).toHaveCSS('text-decoration-line', 'underline');
    }
  } finally {
    await browser.close();
  }
});

test.describe('without a menu bar', () => {
  test.skip(mac, 'macOS opens its menus from the menu bar, without F10 or Alt alone');

  test('opens the menu with F10 and Alt alone and works it with the keyboard', async () => {
    let browser = await launch();
    try {
      const page = await open(browser, 'index.html');
      const origin = server.origin;
      await focusPage(browser, page);
      await pressNative(browser, 'F10', [], origin);
      const menu = await overlayMenu(browser);
      const overlay = menu.page();
      await expect(menu.getByRole('menuitem', { name: 'New tab', exact: true })).toBeFocused();
      await expect(
        menu.getByRole('menuitem', { name: 'New tab', exact: true }).locator('.key'),
      ).toHaveCSS('text-decoration-line', 'underline');
      await overlay.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem', { name: 'New window', exact: true })).toBeFocused();
      await overlay.keyboard.press('End');
      await expect(
        menu.getByRole('menuitem', {
          name: process.platform === 'win32' ? 'Exit' : 'Quit',
          exact: true,
        }),
      ).toBeFocused();
      await overlay.keyboard.press('Home');
      await expect(menu.getByRole('menuitem', { name: 'New tab', exact: true })).toBeFocused();
      await overlay.keyboard.press('Escape');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      await expect.poll(() => focused(browser, origin)).toBe(true);
      // Alt pressed and released alone opens the menu, and once more closes it.
      await pressNative(browser, 'Alt', [], origin);
      await expect(await overlayMenu(browser)).toBeVisible();
      await pressNative(browser, 'Alt', [], 'app://overlay');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      // F10 in the menu closes it too.
      await pressNative(browser, 'F10', [], origin);
      await expect(await overlayMenu(browser)).toBeVisible();
      await pressNative(browser, 'F10', [], 'app://overlay');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      // An Alt that went down before the window lost the focus, as for Alt+Tab, closes nothing.
      await pressNative(browser, 'F10', [], origin);
      const kept = await overlayMenu(browser);
      await alt(browser, 'keyDown', 'app://overlay');
      await browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.emit('blur'));
      await alt(browser, 'keyUp', 'app://overlay');
      await new Promise((done) => setTimeout(done, 300));
      await expect(kept).toBeVisible();
      await kept.page().keyboard.press('Escape');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      // Alt in a combination opens nothing: Alt+Left goes back, a click while Alt is down,
      // and Ctrl with Alt, which is AltGr on Windows.
      await open(browser, 'second.html');
      await expect
        .poll(async () => (await shellState(browser.shell)).tabs[0]?.canGoBack)
        .toBe(true);
      await browser.main.evaluate(({ webContents }, start) => {
        const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(start));
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Alt', modifiers: ['alt'] });
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['alt'] });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['alt'] });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Alt', modifiers: [] });
      }, origin);
      await expect
        .poll(async () => (await shellState(browser.shell)).tabs[0]?.url)
        .toBe(`${origin}/index.html`);
      await browser.main.evaluate(({ webContents }, start) => {
        const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(start));
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Alt', modifiers: ['alt'] });
        view?.sendInputEvent({
          type: 'mouseDown',
          x: 20,
          y: 20,
          button: 'left',
          clickCount: 1,
          modifiers: ['alt'],
        });
        view?.sendInputEvent({
          type: 'mouseUp',
          x: 20,
          y: 20,
          button: 'left',
          clickCount: 1,
          modifiers: ['alt'],
        });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Alt', modifiers: [] });
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Alt', modifiers: ['control', 'alt'] });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Alt', modifiers: ['control'] });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Control', modifiers: [] });
      }, origin);
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayAttached(browser)).toBe(false);
      // A letter chooses the item of its access key.
      await pressNative(browser, 'F10', [], origin);
      await overlayMenu(browser);
      await pressNative(browser, 'H', [], 'app://overlay');
      await waitForPage(browser, (url) => url.startsWith('app://history'));
      await expect(browser.shell.getByRole('tab', { name: 'History' })).toBeVisible();
    } finally {
      await browser.close();
    }
    // Without the setting, Alt alone leaves the page alone, and F10 still opens the menu.
    browser = await launch([], { settings: { 'keys.altOpensMenu': false } });
    try {
      await open(browser, 'index.html');
      await pressNative(browser, 'Alt', [], server.origin);
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayAttached(browser)).toBe(false);
      await pressNative(browser, 'F10', [], server.origin);
      const menu = await overlayMenu(browser);
      await menu.page().keyboard.press('Escape');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      // The settings turn it on again, at once.
      const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
      await address.fill('app://settings/#keys.altOpensMenu');
      await address.press('Enter');
      const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
      const toggle = settings.getByRole('switch', { name: 'Open the menu with Alt' });
      await expect(toggle).not.toBeChecked();
      await expect(
        settings.getByText('Pressing and releasing Alt alone opens the menu'),
      ).toBeVisible();
      await toggle.click();
      await expect(toggle).toBeChecked();
      await focusPage(browser, settings);
      await pressNative(browser, 'Alt', [], 'app://settings');
      await expect(await overlayMenu(browser)).toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('prepares nothing while Alt is down, as Alt starts other shortcuts too', async () => {
    const browser = await launch();
    try {
      await new Promise((done) => setTimeout(done, 300));
      expect(await overlayViews(browser)).toBe(0);
      // Alt in a combination, such as Alt+Home, makes no overlay.
      await alt(browser, 'keyDown', 'app://shell');
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayViews(browser)).toBe(0);
      await browser.main.evaluate(({ webContents }) => {
        const shell = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith('app://shell'));
        shell?.sendInputEvent({ type: 'keyDown', keyCode: 'Home', modifiers: ['alt'] });
        shell?.sendInputEvent({ type: 'keyUp', keyCode: 'Home', modifiers: ['alt'] });
      });
      await alt(browser, 'keyUp', 'app://shell');
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayViews(browser)).toBe(0);
      // Alt alone makes the overlay as it opens the menu.
      await alt(browser, 'keyDown', 'app://shell');
      await alt(browser, 'keyUp', 'app://shell');
      await expect(await overlayMenu(browser)).toBeVisible();
      expect(await overlayViews(browser)).toBe(1);
    } finally {
      await browser.close();
    }
  });

  test('opens nothing for an Alt that goes down while the pointer drags in a page', async () => {
    const browser = await launch();
    try {
      const page = await open(browser, 'index.html');
      const origin = server.origin;
      await focusPage(browser, page);
      // A drag that starts before Alt, which goes down and up while the button is held, as to
      // draw a shape from its center, and the button is released before Alt.
      await browser.main.evaluate(({ webContents }, start) => {
        const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(start));
        view?.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
        view?.sendInputEvent({ type: 'mouseMove', x: 30, y: 30, modifiers: ['leftbuttondown'] });
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Alt', modifiers: ['alt'] });
        view?.sendInputEvent({
          type: 'mouseMove',
          x: 40,
          y: 40,
          modifiers: ['alt', 'leftbuttondown'],
        });
        view?.sendInputEvent({
          type: 'mouseUp',
          x: 40,
          y: 40,
          button: 'left',
          clickCount: 1,
          modifiers: ['alt'],
        });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Alt', modifiers: [] });
      }, origin);
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayAttached(browser)).toBe(false);
      // The release of the button alone, without a move, disarms Alt as well.
      await browser.main.evaluate(({ webContents }, start) => {
        const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(start));
        view?.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
        view?.sendInputEvent({ type: 'keyDown', keyCode: 'Alt', modifiers: ['alt'] });
        view?.sendInputEvent({
          type: 'mouseUp',
          x: 20,
          y: 20,
          button: 'left',
          clickCount: 1,
          modifiers: ['alt'],
        });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Alt', modifiers: [] });
      }, origin);
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayAttached(browser)).toBe(false);
      // A key press of Alt that reports a held button does not arm.
      await browser.main.evaluate(({ webContents }, start) => {
        const view = webContents.getAllWebContents().find((w) => w.getURL().startsWith(start));
        view?.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
        view?.sendInputEvent({
          type: 'keyDown',
          keyCode: 'Alt',
          modifiers: ['alt', 'leftbuttondown'],
        });
        view?.sendInputEvent({ type: 'keyUp', keyCode: 'Alt', modifiers: ['leftbuttondown'] });
        view?.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 });
      }, origin);
      await new Promise((done) => setTimeout(done, 500));
      expect(await overlayAttached(browser)).toBe(false);
      // Alt alone after the drag opens the menu.
      await pressNative(browser, 'Alt', [], origin);
      await expect(await overlayMenu(browser)).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});

test.describe('with the menu bar of macOS', () => {
  test.skip(!mac, 'Only macOS has a menu bar of its own');

  test('closes the popover before a command of the menu bar of macOS runs', async () => {
    const browser = await launch();
    try {
      await open(browser, 'index.html');
      await openBrowserMenu(browser);
      expect(await overlayAttached(browser)).toBe(true);
      await browser.main.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View');
        view?.submenu?.items.find((item) => item.label === 'Find…')?.click();
      });
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      await expect(browser.shell.getByRole('search', { name: 'Find in page' })).toBeVisible();
    } finally {
      await browser.close();
    }
  });
});

test('prepares the overlay when the pointer reaches the menu button', async () => {
  const browser = await launch();
  try {
    const overlays = (): Promise<number> => overlayViews(browser);
    // Nothing is made at the start.
    await new Promise((done) => setTimeout(done, 300));
    expect(await overlays()).toBe(0);
    await menuButton(browser).hover();
    await expect.poll(overlays).toBe(1);
    const page = await overlayPage(browser);
    await page.waitForLoadState('load');
    expect(await overlayAttached(browser)).toBe(false);
    await menuButton(browser).click();
    await expect(await overlayMenu(browser)).toBeVisible();
    expect(await overlays()).toBe(1);
  } finally {
    await browser.close();
  }
});

test('takes a menu whose page crashed or hangs out of the window, and opens it again', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html');
    await openBrowserMenu(browser);
    // A page that crashed would take every click and key of the window. Electron's own way
    // ends the renderer on Windows and macOS, but makes it crash on Linux, where the crash
    // handler of the system can keep the process alive while it saves a dump. As in the test
    // of crashed pages, the test ends the process of the page at once, the same way on every
    // system.
    await browser.main.evaluate(({ webContents }) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith('app://overlay'));
      if (contents === undefined) throw new Error('No page of an overlay');
      process.kill(contents.getOSProcessId(), 'SIGKILL');
    });
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'false');
    // The page loads again for the next menu. The connection of the tests to the page that
    // crashed is gone, so the browser process reads the menu that the page shows.
    await menuButton(browser).click();
    await expect.poll(() => overlayAttached(browser)).toBe(true);
    await expect
      .poll(() =>
        browser.main.evaluate(({ webContents }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().startsWith('app://overlay'));
          if (contents === undefined || contents.isCrashed() || contents.isLoading()) return '';
          return contents.executeJavaScript(
            `document.querySelector('overlay-page')?.shadowRoot?.querySelector('.current overlay-menu')?.shadowRoot?.querySelector('[role="menu"]')?.getAttribute('aria-label') ?? ''`,
          ) as Promise<string>;
        }),
      )
      .toBe('Menu');
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'true');
    expect(await overlayViews(browser)).toBe(1);
    // A page that stops answering takes the menu out of the window as well.
    await browser.main.evaluate(({ webContents }) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('app://overlay'))
        ?.emit('unresponsive');
    });
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(menuButton(browser)).toHaveAttribute('aria-expanded', 'false');
  } finally {
    await browser.close();
  }
});

test('lets the suggestions of the address bar take the place of a menu that leaves', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html');
    const menu = await openBrowserMenu(browser);
    const overlay = menu.page();
    // The menu takes long to leave here, so that the suggestions come while it still leaves.
    await overlay.evaluate(() => {
      const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
        ?.value as Element['animate'];
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ): Animation {
        const [keyframes, options] = args;
        const slow = typeof options === 'object' ? { ...options, duration: 20_000 } : options;
        return animate.call(this, keyframes, slow);
      };
    });
    await overlay.keyboard.press('Escape');
    const leaving = overlay.locator('.leaving');
    await expect(leaving).toHaveCount(1);
    // Without the page's word, the view leaves the window after a moment all the same.
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await focusPage(browser, browser.shell);
    await address.click();
    await address.pressSequentially('fixture');
    await expect(overlay.getByRole('listbox', { name: 'Suggestions' })).toBeVisible();
    // The menu that leaves is gone at once, as the list lies elsewhere in the window.
    await expect(leaving).toHaveCount(0);
  } finally {
    await browser.close();
  }
});
