import { expect, test, type Page } from '@playwright/test';
import type * as Electron from 'electron';
import {
  chooseMenuItem,
  closeRecordedMenu,
  FixtureServer,
  focusPage,
  launch,
  menuCount,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  tabViews,
  waitForPage,
  type Browser,
} from './harness.ts';

const mac = process.platform === 'darwin';
const server = new FixtureServer();

test.beforeAll(async () => {
  await server.start();
});

test.afterAll(async () => {
  await server.stop();
});

/** The settings of the one row with the tabs and the toolbar, hidden until they are needed. */
const zen = { 'toolbar.placement': 'tab-row', 'toolbar.autoHide': true };

/** Opens an address in the active tab through the address bar. */
async function open(browser: Browser, url: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(url);
  await address.press('Enter');
}

/** Opens the settings page at one of its rows. */
async function openSetting(browser: Browser, row: string): Promise<Page> {
  await open(browser, `app://settings/#${row}`);
  return waitForPage(browser, (url) => url.startsWith('app://settings'));
}

/** The rows at the top of the window, as the browser tells its shell. */
async function rowsOf(shell: Page): Promise<unknown> {
  return (await shellState(shell)).layout;
}

/**
 * What stays of rows that hide: an edge of 4 px on macOS, and on Windows and Linux, where the
 * browser draws the title bar, the title row of the height of the one row, 40 px.
 */
const hidden = { shown: false, rest: mac ? 'edge' : 'title', height: mac ? 4 : 40 } as const;

/**
 * Where the shell of the first window lies among the views of the window, and its bounds:
 * first, below the pages, or last, above them.
 */
function shellPlace(browser: Browser): Promise<{ place: string; bounds: Electron.Rectangle }> {
  return browser.main.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0];
    const children = window?.contentView.children ?? [];
    const index = children.findIndex(
      (child) =>
        'webContents' in child &&
        (child as Electron.WebContentsView).webContents.getURL().startsWith('app://shell'),
    );
    const place = index === 0 ? 'first' : index === children.length - 1 ? 'last' : String(index);
    return { place, bounds: children[index]?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 } };
  });
}

/** The size of the content of the first window. */
function contentSize(browser: Browser): Promise<{ width: number; height: number }> {
  return browser.main.evaluate(({ BaseWindow }) => {
    const { width, height } = BaseWindow.getAllWindows()[0]?.getContentBounds() ?? {
      width: 0,
      height: 0,
    };
    return { width, height };
  });
}

/**
 * Puts the system's pointer at a point of the content of the first window, as the browser asks
 * the system where it is: input events that a test sends move no pointer of the system.
 */
async function cursorAt(browser: Browser, x: number, y: number): Promise<void> {
  await browser.main.evaluate(
    ({ BaseWindow, screen }, point) => {
      const area = BaseWindow.getAllWindows()[0]?.getContentBounds() ?? { x: 0, y: 0 };
      screen.getCursorScreenPoint = () => ({ x: area.x + point.x, y: area.y + point.y });
    },
    { x, y },
  );
}

/** Sends an input event of the pointer to the shell of the first window, with the pointer there. */
async function pointShell(browser: Browser, input: Electron.MouseInputEvent): Promise<void> {
  await cursorAt(browser, input.x, input.y);
  await browser.main.evaluate(({ webContents }, event) => {
    webContents
      .getAllWebContents()
      .find((contents) => contents.getURL().startsWith('app://shell'))
      ?.sendInputEvent(event);
  }, input);
}

/** Where the content area of the shell starts, below its rows. */
function contentTop(shell: Page): Promise<number> {
  return shell.evaluate(() =>
    Math.round(
      document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('.content')
        ?.getBoundingClientRect().top ?? -1,
    ),
  );
}

/**
 * Lets the shell see where the focus is: Playwright pretends that a page it drives always has
 * the focus, so the shell would never notice that the focus went to the page.
 */
async function useRealFocus(browser: Browser): Promise<void> {
  const session = await browser.shell.context().newCDPSession(browser.shell);
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: false });
}

/** Whether the view of a page at the start of an address has the focus. */
function viewFocused(browser: Browser, prefix: string): Promise<boolean> {
  return browser.main.evaluate(
    ({ webContents }, start) =>
      webContents
        .getAllWebContents()
        .some((contents) => contents.getURL().startsWith(start) && contents.isFocused()),
    prefix,
  );
}

test('puts the address bar into the row of the tabs and fits the page and the window controls below that row', async () => {
  const browser = await launch([], {
    settings: { 'toolbar.placement': 'tab-row', 'appearance.colorMode': 'light' },
  });
  try {
    const host = browser.shell.locator('app-shell');
    await expect(host).toHaveAttribute('data-toolbar', 'tab-row');
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
    const buttons = (): Promise<unknown> =>
      browser.main.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.getWindowButtonPosition(),
      );
    const overlay = (): Promise<unknown> =>
      browser.main.evaluate(() =>
        (globalThis as unknown as { overlays: Electron.TitleBarOverlay[] }).overlays.at(-1),
      );
    const drawnHeight = (): Promise<number> =>
      browser.shell.evaluate(
        () =>
          (
            Reflect.get(navigator, 'windowControlsOverlay') as { getTitlebarAreaRect(): DOMRect }
          ).getTitlebarAreaRect().height,
      );
    // The tab strip and the toolbar share one row, the toolbar first, and the menu button
    // follows the New tab button.
    const row = (): Promise<unknown> =>
      browser.shell.evaluate(() => {
        const root = document.querySelector('app-shell')?.shadowRoot;
        const box = (selector: string): { top: number; height: number } | null => {
          const rect = root?.querySelector(selector)?.getBoundingClientRect();
          return rect === undefined
            ? null
            : { top: Math.round(rect.top), height: Math.round(rect.height) };
        };
        const newTab = root?.querySelector('[role="tablist"] > button[aria-label="New tab"]');
        return {
          tabs: box('[role="tablist"]'),
          nav: box('nav'),
          first: root?.querySelector('nav, [role="tablist"]')?.localName,
          afterNewTab: newTab?.nextElementSibling?.getAttribute('aria-label'),
          menuInNav: root?.querySelector('nav .menu-button') !== null,
        };
      });
    await expect.poll(row).toEqual({
      tabs: { top: 0, height: 40 },
      nav: { top: 0, height: 40 },
      first: 'nav',
      afterNewTab: 'Menu',
      menuInNav: false,
    });
    const pageTop = async (prefix: string): Promise<number | undefined> =>
      (await tabViews(browser)).find((view) => view.url.startsWith(prefix))?.bounds.y;
    await expect.poll(() => pageTop('app://newtab')).toBe(40);
    if (mac) await expect.poll(buttons).toEqual({ x: 14, y: 13 });
    else await expect.poll(drawnHeight).toBe(40);
    // At the compact density, the row and everything with it is 32 px high.
    const settings = await openSetting(browser, 'appearance.density');
    await settings
      .getByRole('radiogroup', { name: 'Density' })
      .getByRole('radio', { name: 'Compact' })
      .check();
    await expect.poll(row).toEqual({
      tabs: { top: 0, height: 32 },
      nav: { top: 0, height: 32 },
      first: 'nav',
      afterNewTab: 'Menu',
      menuInNav: false,
    });
    await expect.poll(() => pageTop('app://settings')).toBe(32);
    if (mac) {
      await expect.poll(buttons).toEqual({ x: 14, y: 9 });
    } else {
      await expect.poll(overlay).toEqual({ color: '#f5f7f9', symbolColor: '#1f2329', height: 32 });
      await expect.poll(drawnHeight).toBe(32);
    }
    // With the tabs at a side, the toolbar keeps its row, and its setting says why.
    await settings
      .getByRole('radiogroup', { name: 'Tabs' })
      .getByRole('radio', { name: 'Left' })
      .check();
    await expect(host).toHaveAttribute('data-toolbar', 'own-row');
    const placement = settings.locator('[data-row="toolbar.placement"]');
    await expect(placement.getByText('Needs the tabs at the top')).toBeVisible();
    await expect(placement.getByRole('radio', { name: 'Next to the tabs' })).toBeChecked();
    await expect(placement.getByRole('radio', { name: 'Next to the tabs' })).toBeDisabled();
    await expect(placement.getByRole('radio', { name: 'In its own row' })).toBeDisabled();
    const autoHide = settings.locator('[data-row="toolbar.autoHide"]');
    await expect(autoHide.getByText('Needs the tabs at the top')).toBeVisible();
    await expect(autoHide.getByRole('switch')).toBeDisabled();
  } finally {
    await browser.close();
  }
});

test('keeps the tabs, their buttons and the toolbar clear of each other and of the window controls in a narrow window', async () => {
  const browser = await launch([], { settings: { 'toolbar.placement': 'tab-row' } });
  try {
    await expect(browser.shell.locator('app-shell')).toHaveAttribute('data-toolbar', 'tab-row');
    // Where the tabs, the toolbar and the buttons after the tabs are, and where the window
    // controls start: at the end of the top row on Windows and Linux, none on macOS, whose
    // buttons lie at the start.
    const row = (): Promise<unknown> =>
      browser.shell.evaluate(() => {
        const root = document.querySelector('app-shell')?.shadowRoot;
        const box = (selector: string): DOMRect | undefined =>
          root?.querySelector(selector)?.getBoundingClientRect();
        const overlay = Reflect.get(navigator, 'windowControlsOverlay') as
          { visible: boolean; getTitlebarAreaRect(): DOMRect } | undefined;
        const area = overlay?.visible === true ? overlay.getTitlebarAreaRect() : undefined;
        const controls = area === undefined ? innerWidth : area.x + area.width;
        const strip = box('[role="tablist"]');
        const nav = box('nav');
        const ends = ['button[aria-label="New tab"]', '.menu-button'].map(
          (selector) => box(`[role="tablist"] ${selector}`)?.right ?? Infinity,
        );
        const last = root?.querySelector('nav')?.lastElementChild?.getBoundingClientRect();
        return {
          oneRow: strip?.top === nav?.top,
          // The New tab and Menu buttons end before the window controls, inside the window.
          clear: ends.every((end) => end <= controls) && (strip?.right ?? Infinity) <= innerWidth,
          // The last button of the toolbar ends inside it, and the toolbar before the tabs.
          toolbar:
            (last?.right ?? Infinity) <= (nav?.right ?? 0) &&
            (strip?.top !== nav?.top || (nav?.right ?? Infinity) <= (strip?.left ?? 0)),
          tab: (box('[role="tab"][aria-selected="true"]')?.width ?? 0) >= 40,
        };
      });
    const resize = (width: number): Promise<void> =>
      browser.main.evaluate(({ BaseWindow }, size) => {
        BaseWindow.getAllWindows()[0]?.setContentSize(size, 600);
      }, width);
    const pageTop = async (name: string): Promise<number | undefined> =>
      (await tabViews(browser)).find((view) => view.url.includes(name))?.bounds.y;
    // At every width, on the new tab page and on a web page, whose star and shield need more
    // room: a window too narrow for the one row puts the tabs above the toolbar, below the row
    // of the window controls, and a wider one keeps the one row, with room for the tabs.
    const widths = [480, 520, 560, 600, 640, 680, 720, 800, 1000];
    for (const [address, name] of [
      [undefined, 'app://newtab'],
      [`${server.origin}/rows.html`, '/rows.html'],
    ] as const) {
      if (address !== undefined) {
        await resize(1000);
        await open(browser, address);
        await waitForPage(browser, (url) => url.endsWith(name));
        await expect(browser.shell.getByRole('button', { name: 'Bookmark this page' })).toHaveCount(
          1,
        );
      }
      for (const width of widths) {
        await resize(width);
        await expect
          .poll(row, { message: `${name} at ${String(width)} px` })
          .toEqual(
            width === 480
              ? { oneRow: false, clear: true, toolbar: true, tab: true }
              : width === 1000
                ? { oneRow: true, clear: true, toolbar: true, tab: true }
                : expect.objectContaining({ clear: true, toolbar: true, tab: true }),
          );
      }
      // Both rows are as high as the one row, and the page starts below them.
      await resize(480);
      await expect.poll(() => pageTop(name)).toBe(80);
      await resize(1000);
      await expect.poll(() => pageTop(name)).toBe(40);
    }
  } finally {
    await browser.close();
  }
});

test('hides the top rows and shows them over the page when the pointer reaches the top edge', async () => {
  const browser = await launch([], {
    settings: { ...zen, 'bookmarks.bar': true, 'contentBlocker.enabled': false },
  });
  try {
    // On macOS, the three buttons of the window hide and show with the rows.
    await browser.main.evaluate(({ BaseWindow }) => {
      const window = BaseWindow.getAllWindows()[0];
      const shown: boolean[] = [];
      Object.assign(globalThis, { buttonsShown: shown });
      if (window === undefined || process.platform !== 'darwin') return;
      const set = window.setWindowButtonVisibility.bind(window);
      window.setWindowButtonVisibility = (visible) => {
        shown.push(visible);
        set(visible);
      };
    });
    const buttonsShown = (): Promise<boolean[]> =>
      browser.main.evaluate(
        () => (globalThis as unknown as { buttonsShown: boolean[] }).buttonsShown,
      );
    await open(browser, `${server.origin}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    // The rows show for a moment for the new site, and then hide.
    await expect
      .poll(() => rowsOf(browser.shell), { timeout: 10_000 })
      .toEqual({ toolbar: 'tab-row', hiding: hidden });
    const size = await contentSize(browser);
    const view = async (): Promise<Electron.Rectangle | undefined> =>
      (await tabViews(browser)).find((candidate) => candidate.url.endsWith('/rows.html'))?.bounds;
    // The page lies below what stays of the rows, and the shell lies below the page.
    await expect.poll(async () => (await view())?.y).toBe(hidden.height);
    await expect
      .poll(() => shellPlace(browser))
      .toEqual({ place: 'first', bounds: { x: 0, y: 0, ...size } });
    await expect(browser.shell.locator('.reveal')).toHaveCount(1);
    const before = await view();
    const inner = await page.evaluate(() => [innerWidth, innerHeight]);
    // The buttons of a macOS window showed and hid for the new site; what follows counts.
    await browser.main.evaluate(() => {
      (globalThis as unknown as { buttonsShown: boolean[] }).buttonsShown.length = 0;
    });
    // When the shell takes the rows as hidden, and when the browser lays the page above it.
    await browser.shell.evaluate(() => {
      const host = document.querySelector('app-shell');
      if (!(host instanceof HTMLElement)) return;
      new MutationObserver(() => {
        if (host.dataset['rows'] === 'hidden') Reflect.set(window, 'hiddenAt', Date.now());
      }).observe(host, { attributes: true, attributeFilter: ['data-rows'] });
    });
    await browser.main.evaluate(({ BaseWindow }) => {
      const content = BaseWindow.getAllWindows()[0]?.contentView;
      if (content === undefined) return;
      const add = content.addChildView.bind(content);
      // Diagnosis of the macOS order of the views: every change with where it came from.
      const log: string[] = [];
      Object.assign(globalThis, { viewLog: log });
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- runs in the main process
      const name = (child: Electron.View): string =>
        'webContents' in child ? (child as Electron.WebContentsView).webContents.getURL() : 'view';
      content.addChildView = (child, index) => {
        if ('webContents' in child) {
          const url = (child as Electron.WebContentsView).webContents.getURL();
          if (url.endsWith('/rows.html')) Object.assign(globalThis, { pageAbove: Date.now() });
        }
        log.push(
          `${Date.now()} add ${name(child)} ${String(index)} @ ${(new Error().stack ?? '').split('\n').slice(1, 8).join(' | ')}`,
        );
        add(child, index);
        log.push(`  children ${content.children.map(name).join(', ')}`);
      };
      const remove = content.removeChildView.bind(content);
      content.removeChildView = (child) => {
        log.push(
          `${Date.now()} remove ${name(child)} @ ${(new Error().stack ?? '').split('\n').slice(1, 8).join(' | ')}`,
        );
        remove(child);
      };
    });
    // The pointer at the top edge of the window shows the rows over the page.
    await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
    await expect
      .poll(() => rowsOf(browser.shell))
      .toEqual({ toolbar: 'tab-row', hiding: { ...hidden, shown: true } });
    await expect(browser.shell.locator('.reveal')).toHaveCount(0);
    const top = await contentTop(browser.shell);
    // The rows with the bookmarks bar are higher than what stays of them.
    expect(top).toBeGreaterThan(hidden.height);
    try {
      await expect
        .poll(() => shellPlace(browser))
        .toEqual({ place: 'last', bounds: { x: 0, y: 0, width: size.width, height: top } });
    } catch (error) {
      const log = await browser.main.evaluate(
        () => (globalThis as unknown as { viewLog: string[] }).viewLog,
      );
      throw new Error(`${String(error)}\nVIEWLOG\n${log.join('\n')}`, { cause: error });
    }
    if (mac) await expect.poll(buttonsShown).toEqual([true]);
    // The page neither moved nor changed its size.
    expect(await view()).toEqual(before);
    expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual(inner);
    expect(await page.evaluate(() => Reflect.get(window, 'resizes'))).toBe(0);
    // The pointer that leaves the rows lets them hide after a moment.
    await pointShell(browser, { type: 'mouseLeave', x: 300, y: 300 });
    await expect
      .poll(() => shellPlace(browser))
      .toEqual({ place: 'first', bounds: { x: 0, y: 0, ...size } });
    expect(await rowsOf(browser.shell)).toEqual({ toolbar: 'tab-row', hiding: hidden });
    // The page went above the shell only after the shell took the rows as hidden and drew
    // them so, as the regions of its rows that move the window would win over the page.
    const hiddenAt = await browser.shell.evaluate(() => Reflect.get(window, 'hiddenAt') as number);
    const pageAbove = await browser.main.evaluate(
      () => (globalThis as unknown as { pageAbove: number }).pageAbove,
    );
    expect(pageAbove).toBeGreaterThan(hiddenAt);
    if (mac) await expect.poll(buttonsShown).toEqual([true, false]);
    expect(await view()).toEqual(before);
    expect(await page.evaluate(() => Reflect.get(window, 'resizes'))).toBe(0);
  } finally {
    await browser.close();
  }
});

test('keeps the rows that show while the pointer is over their free room, which moves the window', async () => {
  const browser = await launch([], { settings: { ...zen, 'contentBlocker.enabled': false } });
  try {
    await open(browser, `${server.origin}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    const shown = async (): Promise<boolean | undefined> =>
      (await shellState(browser.shell)).layout.hiding?.shown;
    await expect.poll(shown, { timeout: 10_000 }).toBe(false);
    await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
    await expect.poll(shown).toBe(true);
    // The free room after the last button of the tab strip moves the window.
    const room = await browser.shell.evaluate(() => {
      const strip = document
        .querySelector('app-shell')
        ?.shadowRoot?.querySelector('[role="tablist"]');
      const end = strip?.lastElementChild?.getBoundingClientRect();
      const box = strip?.getBoundingClientRect();
      return {
        region:
          strip === null || strip === undefined
            ? ''
            : getComputedStyle(strip, '::after').getPropertyValue('-webkit-app-region'),
        x: Math.round((end?.right ?? 0) + 8),
        y: Math.round((box?.top ?? 0) + (box?.height ?? 0) / 2),
      };
    });
    expect(room.region).toBe('drag');
    // There, the shell gets no events of the pointer, as if the pointer had left it.
    await pointShell(browser, { type: 'mouseLeave', x: room.x, y: room.y });
    await new Promise((done) => setTimeout(done, 1000));
    expect(await shown()).toBe(true);
    // Once the pointer is over the page, the rows hide.
    await cursorAt(browser, 300, 300);
    await expect.poll(shown).toBe(false);
  } finally {
    await browser.close();
  }
});

test('keeps the hidden rows from moving the window and from taking the clicks of the page', async () => {
  const browser = await launch([], { settings: { ...zen, 'contentBlocker.enabled': false } });
  try {
    await open(browser, `${server.origin}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    await expect
      .poll(() => rowsOf(browser.shell), { timeout: 10_000 })
      .toEqual({ toolbar: 'tab-row', hiding: hidden });
    const regions = await browser.shell.evaluate(() => {
      const root = document.querySelector('app-shell')?.shadowRoot;
      const styles = (selector: string): string[] =>
        [...(root?.querySelectorAll(selector) ?? [])].map((element) => {
          const computed = getComputedStyle(element);
          return `${computed.getPropertyValue('-webkit-app-region')} ${computed.pointerEvents}`;
        });
      const reveal = root?.querySelector('.reveal');
      return {
        rows: styles('.top-row'),
        controls: [...new Set(styles('.top-row :is(button, input, [role="tab"])'))],
        reveal:
          reveal === null || reveal === undefined
            ? null
            : {
                region: getComputedStyle(reveal).getPropertyValue('-webkit-app-region'),
                text: (reveal.textContent ?? '').replace(/\s+/g, ' ').trim(),
              },
      };
    });
    // Neither the rows nor their controls move the window or take a click of the page.
    expect(regions.rows).toEqual(['no-drag none', 'no-drag none']);
    expect(regions.controls).toEqual(['no-drag none']);
    // What stays takes the pointer and moves no window, as a region that moves the window gets
    // no events of the pointer. The title row shows the site and the title of the page.
    expect(regions.reveal).toEqual(
      mac
        ? { region: 'no-drag', text: '' }
        : { region: 'no-drag', text: `${new URL(server.origin).host} Fixture rows` },
    );
    // A click right below what stays of the rows reaches the page.
    await browser.main.evaluate(({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith('/rows.html'));
      for (const type of ['mouseDown', 'mouseUp'] as const) {
        view?.sendInputEvent({ type, x: 100, y: 6, button: 'left', clickCount: 1 });
      }
    });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'clicks'))).toBe(1);
  } finally {
    await browser.close();
  }
});

test('names the site of every web page in the title row of the hidden rows', async () => {
  test.skip(mac, 'macOS keeps an edge of the rows, without a title row');
  const browser = await launch([], { settings: { ...zen, 'contentBlocker.enabled': false } });
  try {
    await open(browser, `${server.origin}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    const titleRow = (): Promise<string> =>
      browser.shell.evaluate(() =>
        (
          document.querySelector('app-shell')?.shadowRoot?.querySelector('.reveal')?.textContent ??
          ''
        )
          .replace(/\s+/g, ' ')
          .trim(),
      );
    const host = new URL(server.origin).host;
    await expect.poll(titleRow, { timeout: 10_000 }).toBe(`${host} Fixture rows`);
    // A page that the site made itself, whose title names another site, names the site.
    const spoof = 'accounts.example.com - Sign in';
    await page.evaluate((title) => {
      const html = `<!doctype html><title>${title}</title><p>Sign in</p>`;
      location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    }, spoof);
    await expect.poll(titleRow, { timeout: 10_000 }).toBe(`${host} ${spoof}`);
    // So does an empty page that a page fills, by its address.
    await browser.main.evaluate(async ({ webContents }, title) => {
      const contents = webContents
        .getAllWebContents()
        .find((candidate) => candidate.getURL().startsWith('blob:'));
      await contents?.loadURL('about:blank');
      await contents?.executeJavaScript(`document.title = ${JSON.stringify(title)}`);
    }, spoof);
    await expect.poll(titleRow, { timeout: 10_000 }).toBe(`about:blank ${spoof}`);
  } finally {
    await browser.close();
  }
});

test('gives the page the keys when the rows hide after a click on them that left no field with the focus', async () => {
  const browser = await launch([], { settings: { ...zen, 'contentBlocker.enabled': false } });
  try {
    await useRealFocus(browser);
    await open(browser, `${server.origin}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    const shown = async (): Promise<boolean | undefined> =>
      (await shellState(browser.shell)).layout.hiding?.shown;
    await expect.poll(shown, { timeout: 10_000 }).toBe(false);
    // A click in the shell gives its view the focus of the window, as Chromium does, and the
    // element that it hits, when that takes the focus; one on an element that takes none takes
    // it from the element that had it.
    const clickShell = async (x: number, y: number): Promise<void> => {
      await browser.main.evaluate(({ webContents }) => {
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().startsWith('app://shell'))
          ?.focus();
      });
      await expect.poll(() => viewFocused(browser, 'app://shell')).toBe(true);
      for (const type of ['mouseDown', 'mouseUp'] as const) {
        await pointShell(browser, { type, x, y, button: 'left', clickCount: 1 });
      }
    };
    const tab = browser.shell.getByRole('tab', { selected: true });
    for (const target of ['what stays of the rows', 'the tab that shows'] as const) {
      await focusPage(browser, page);
      if (target === 'what stays of the rows') {
        // A click on the title row or the edge, which takes no focus; the rows then show.
        await clickShell(300, 1);
        await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
        await expect.poll(shown).toBe(true);
        expect(await browser.shell.evaluate(() => document.activeElement?.localName)).toBe('body');
      } else {
        // A click on the tab that shows leaves the focus on the tab, which holds nothing.
        await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
        await expect.poll(shown).toBe(true);
        const box = await tab.boundingBox();
        if (box === null) throw new Error('The tab has no box');
        await clickShell(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
        await expect(tab).toBeFocused();
      }
      // Once the pointer left the rows, they hide, and the keys go to the page.
      await pointShell(browser, { type: 'mouseLeave', x: 300, y: 300 });
      await expect.poll(shown).toBe(false);
      await expect.poll(() => viewFocused(browser, page.url())).toBe(true);
    }
  } finally {
    await browser.close();
  }
});

test('lays a split view out below what stays of the hidden rows', async () => {
  const browser = await launch([], {
    settings: { ...zen, 'bookmarks.bar': true, 'contentBlocker.enabled': false },
  });
  try {
    await open(browser, `${server.origin}/rows.html`);
    const left = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await left.waitForLoadState('load');
    await focusPage(browser, left);
    // The shortcut of split view opens a new tab page beside the page; its address bar has the
    // keys, and opens the second page there.
    await pressNative(
      browser,
      'S',
      mac ? ['control', 'primary'] : ['control', 'shift'],
      left.url(),
    );
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    await open(browser, `${server.origin}/second.html`);
    const right = await waitForPage(browser, (url) => url.endsWith('/second.html'));
    await focusPage(browser, right);
    const shown = async (): Promise<boolean | undefined> =>
      (await shellState(browser.shell)).layout.hiding?.shown;
    await expect.poll(shown, { timeout: 10_000 }).toBe(false);
    /**
     * Where the split view begins in the shell, and where its pages begin, as the browser lays
     * them out and as the shell draws their sides below them, below the line of the focus.
     */
    const place = async (): Promise<{ split: number; pages: number[]; sides: number[] }> => {
      const pages = (await tabViews(browser))
        .filter((view) => /\/(rows|second)\.html$/.test(view.url))
        .map((view) => view.bounds.y);
      const shell = await browser.shell.evaluate(() => {
        const split = document.querySelector('app-shell')?.shadowRoot?.querySelector('.split');
        return {
          split: Math.round(split?.getBoundingClientRect().top ?? -1),
          sides: [...(split?.querySelectorAll('.pane') ?? [])].map((pane) =>
            Math.round(pane.getBoundingClientRect().top),
          ),
        };
      });
      return { split: shell.split, pages, sides: shell.sides };
    };
    // The split view starts right below what stays of the rows, also with the bookmarks bar,
    // which hides with them, and the shell draws the sides where the pages are.
    await expect.poll(async () => (await place()).split).toBe(hidden.height);
    const hiddenPlace = await place();
    expect(hiddenPlace.pages).toHaveLength(2);
    expect(hiddenPlace.sides).toEqual(hiddenPlace.pages);
    // The rows show over the split view, whose pages stay where they are.
    await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
    await expect.poll(shown).toBe(true);
    expect((await place()).pages).toEqual(hiddenPlace.pages);
  } finally {
    await browser.close();
  }
});

test('never hides the rows of a popup window', async () => {
  const browser = await launch([], { settings: { ...zen, 'contentBlocker.enabled': false } });
  try {
    await open(browser, `${server.origin}/opener.html`);
    const opener = await waitForPage(browser, (url) => url.endsWith('/opener.html'));
    await expect
      .poll(async () => ((await shellState(browser.shell)).layout.hiding ?? null) !== null)
      .toBe(true);
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    await waitForPage(browser, (url) => url.endsWith('/opened.html'));
    const shells = (): Page[] =>
      browser.cdp
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => page.url().startsWith('app://shell') && page !== browser.shell);
    await expect.poll(() => shells().length).toBe(1);
    const popupShell = shells()[0];
    if (popupShell === undefined) throw new Error('No shell of the popup');
    await popupShell.waitForSelector('app-shell');
    await expect.poll(() => rowsOf(popupShell)).toEqual({ toolbar: 'tab-row', hiding: null });
    // The popup's page starts below its rows, which always show: the popup of 520 px is too
    // narrow for the one row, so its tab lies in a row of its own above the toolbar.
    await expect(popupShell.locator('app-shell')).toHaveAttribute('data-narrow', '');
    const popupId = await browser.main.evaluate(({ BaseWindow }) =>
      Math.max(...BaseWindow.getAllWindows().map((window) => window.id)),
    );
    await expect
      .poll(
        async () =>
          (await tabViews(browser, popupId)).find((view) => view.url.endsWith('/opened.html'))
            ?.bounds.y,
      )
      .toBe(80);
    // The rows of the window that opened it still hide.
    expect((await shellState(browser.shell)).layout.hiding).not.toBe(null);
  } finally {
    await browser.close();
  }
});

test('shows the hidden rows for the address bar, the find bar, the keys of the menu and the star, and gives the page the keys again', async () => {
  const browser = await launch([], { settings: { ...zen, 'contentBlocker.enabled': false } });
  try {
    await useRealFocus(browser);
    await open(browser, `${server.origin}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    const shown = async (): Promise<boolean | undefined> =>
      (await shellState(browser.shell)).layout.hiding?.shown;
    await expect.poll(shown, { timeout: 10_000 }).toBe(false);
    await focusPage(browser, page);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    // The address bar shows the rows while it has the focus, from each of its shortcuts.
    const shortcuts: [string, ('primary' | 'alt')[]][] = mac
      ? [['L', ['primary']]]
      : [
          ['L', ['primary']],
          ['D', ['alt']],
          ['F6', []],
        ];
    for (const [key, modifiers] of shortcuts) {
      await pressNative(browser, key, modifiers, page.url());
      await expect.poll(shown).toBe(true);
      await expect(address).toBeFocused();
      // Escape brings back the address of the page, and once more gives the page the keys,
      // which hides the rows.
      await address.press('Escape');
      await expect.poll(shown).toBe(true);
      await address.press('Escape');
      await expect.poll(shown).toBe(false);
      await expect.poll(() => viewFocused(browser, page.url())).toBe(true);
    }
    // The find bar shows the rows while it is open.
    await pressNative(browser, 'F', ['primary'], page.url());
    const find = browser.shell.getByRole('searchbox', { name: 'Find in page' });
    await expect(find).toBeFocused();
    await expect.poll(shown).toBe(true);
    await find.press('Escape');
    await expect(find).toHaveCount(0);
    await expect.poll(shown).toBe(false);
    await expect.poll(() => viewFocused(browser, page.url())).toBe(true);
    // The menu that F10 or Alt alone opens, and the popover of the star that the shortcut of
    // a bookmark opens, show the rows with their button, and Escape gives the page the keys.
    const popovers: [string, ('primary' | 'alt')[], string][] = [
      ...(mac
        ? []
        : ([
            ['F10', [], 'menu'],
            ['Alt', [], 'menu'],
          ] as [string, ('primary' | 'alt')[], string][])),
      ['D', ['primary'], 'bookmark'],
    ];
    for (const [key, modifiers, kind] of popovers) {
      await pressNative(browser, key, modifiers, page.url());
      await expect.poll(async () => (await shellState(browser.shell)).popover?.kind).toBe(kind);
      await expect.poll(shown).toBe(true);
      // Escape goes to the popover once it shows in the overlay, which has the keys.
      const overlay = await overlayPage(browser);
      await expect(overlay.getByRole(kind === 'menu' ? 'menu' : 'dialog').first()).toBeVisible();
      await expect.poll(() => viewFocused(browser, 'app://overlay')).toBe(true);
      await pressNative(browser, 'Escape', [], 'app://overlay');
      await expect.poll(async () => (await shellState(browser.shell)).popover).toBe(null);
      await expect.poll(shown).toBe(false);
      await expect.poll(() => viewFocused(browser, page.url())).toBe(true);
    }
  } finally {
    await browser.close();
  }
});

test('shows the hidden rows for popovers, native menus and a new site, and turns the hiding off with its command', async () => {
  const browser = await launch(
    ['--host-resolver-rules=MAP *.test 127.0.0.1', '--no-proxy-server'],
    {
      settings: {
        ...zen,
        'contentBlocker.enabled': true,
        'keys.shortcuts': { 'toolbar.toggleAutoHide': ['F8'] },
      },
    },
  );
  try {
    await useRealFocus(browser);
    const port = new URL(server.origin).port;
    await open(browser, `http://one.test:${port}/rows.html`);
    const page = await waitForPage(browser, (url) => url.endsWith('/rows.html'));
    await page.waitForLoadState('load');
    const shown = async (): Promise<boolean | undefined> =>
      (await shellState(browser.shell)).layout.hiding?.shown;
    await expect.poll(shown, { timeout: 10_000 }).toBe(false);
    // The pointer shows the rows, and the popover of the shield keeps them while it is open,
    // also after the pointer left them.
    await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
    await expect.poll(shown).toBe(true);
    await browser.shell.getByRole('button', { name: /^Content blocker:/ }).click();
    await expect.poll(async () => (await shellState(browser.shell)).popover?.kind).toBe('shield');
    await pointShell(browser, { type: 'mouseLeave', x: 300, y: 300 });
    await new Promise((done) => setTimeout(done, 1000));
    expect(await shown()).toBe(true);
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect.poll(async () => (await shellState(browser.shell)).popover).toBe(null);
    await expect.poll(shown).toBe(false);
    // The menu of a tab keeps the rows while it is open.
    await recordMenus(browser);
    await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
    await expect.poll(shown).toBe(true);
    await browser.shell.getByRole('tab').first().click({ button: 'right' });
    await expect.poll(() => menuCount(browser)).toBe(1);
    await pointShell(browser, { type: 'mouseLeave', x: 300, y: 300 });
    await new Promise((done) => setTimeout(done, 1000));
    expect(await shown()).toBe(true);
    await closeRecordedMenu(browser);
    await expect.poll(shown).toBe(false);
    // The popover of a group keeps the rows while it is open, so that its chip stays: the one
    // of a new group, and the one that a right click on the chip opens.
    const popover = async (): Promise<string | undefined> =>
      (await shellState(browser.shell)).popover?.kind;
    const chip = browser.shell.locator('.tabs > button.group');
    for (const opening of ['new group', 'chip'] as const) {
      await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
      await expect.poll(shown).toBe(true);
      if (opening === 'new group') {
        await browser.shell.getByRole('tab').first().click({ button: 'right' });
        await expect.poll(() => menuCount(browser)).toBe(2);
        await chooseMenuItem(browser, [mac ? 'Add to New Group' : 'Add to new group']);
        await closeRecordedMenu(browser);
      } else {
        await chip.click({ button: 'right' });
      }
      await expect.poll(popover).toBe('group');
      await expect(chip).toHaveCount(1);
      await pointShell(browser, { type: 'mouseLeave', x: 300, y: 300 });
      await new Promise((done) => setTimeout(done, 1000));
      expect(await shown()).toBe(true);
      await pressNative(browser, 'Escape', [], 'app://overlay');
      await expect.poll(popover).toBe(undefined);
      await expect.poll(shown).toBe(false);
    }
    // The menu of the address bar keeps the rows while it is open; the field that the right
    // click focused gives the focus up, so that only the menu holds them.
    await pointShell(browser, { type: 'mouseMove', x: 300, y: 1 });
    await expect.poll(shown).toBe(true);
    const field = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await field.click({ button: 'right' });
    await expect.poll(() => menuCount(browser)).toBe(3);
    await field.evaluate((element) => {
      (element as HTMLInputElement).blur();
    });
    await pointShell(browser, { type: 'mouseLeave', x: 300, y: 300 });
    await new Promise((done) => setTimeout(done, 1000));
    expect(await shown()).toBe(true);
    await closeRecordedMenu(browser);
    await expect.poll(shown).toBe(false);
    // Another site in the tab shows the rows for a moment.
    const start = Date.now();
    await browser.main.evaluate(({ webContents }, address) => {
      void webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith('/rows.html'))
        ?.loadURL(address);
    }, `http://two.test:${port}/rows.html`);
    await expect.poll(shown).toBe(true);
    await expect.poll(shown, { timeout: 5000 }).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(1500);
    // The key that people gave the command turns the hiding off: the rows show for good.
    await focusPage(browser, page);
    await pressNative(browser, 'F8', [], page.url());
    await expect.poll(() => rowsOf(browser.shell)).toEqual({ toolbar: 'tab-row', hiding: null });
  } finally {
    await browser.close();
  }
});

test('applies a layout preset from the settings and shows which one is in use', async () => {
  const browser = await launch();
  try {
    const page = await openSetting(browser, 'layout');
    const cards = page.getByRole('radiogroup', { name: 'Layout' });
    await expect(cards.getByRole('radio')).toHaveCount(4);
    await expect(cards.getByRole('radio', { name: 'Classic' })).toBeChecked();
    await expect(cards.getByRole('radio', { name: 'Classic' })).toBeFocused();
    // A preset sets its settings in one step, which the page hears of once.
    await page.evaluate(() => {
      const changes: string[][] = [];
      Object.assign(window, { changes });
      window.bridge.on('settings.changed', (payload) => {
        const settings = Reflect.get(payload as object, 'settings') as { key: string }[];
        changes.push(settings.map((setting) => setting.key).toSorted());
      });
    });
    await cards.getByRole('radio', { name: 'Compact' }).check();
    await expect(cards.getByRole('radio', { name: 'Compact' })).toBeChecked();
    const changes = (): Promise<unknown> => page.evaluate(() => Reflect.get(window, 'changes'));
    const once = [['appearance.density', 'tabs.position', 'toolbar.autoHide', 'toolbar.placement']];
    await expect.poll(changes).toEqual(once);
    const host = browser.shell.locator('app-shell');
    await expect(host).toHaveAttribute('data-toolbar', 'tab-row');
    expect(await changes()).toEqual(once);
    await expect(
      page.getByRole('radiogroup', { name: 'Density' }).getByRole('radio', { name: 'Compact' }),
    ).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Your own arrangement' })).toHaveCount(
      0,
    );
    // Another density is an arrangement of one's own: no card is checked.
    await page
      .getByRole('radiogroup', { name: 'Density' })
      .getByRole('radio', { name: 'Normal' })
      .check();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your own arrangement' }),
    ).toBeVisible();
    for (const radio of await cards.getByRole('radio').all()) await expect(radio).not.toBeChecked();
    // Zen hides the rows, Vertical puts the tabs at the left with the toolbar in its row.
    await cards.getByRole('radio', { name: 'Zen' }).check();
    await expect
      .poll(async () => ((await shellState(browser.shell)).layout.hiding ?? null) !== null)
      .toBe(true);
    await cards.getByRole('radio', { name: 'Vertical' }).check();
    await expect(cards.getByRole('radio', { name: 'Vertical' })).toBeChecked();
    await expect(browser.shell.getByRole('tablist')).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    await expect.poll(() => rowsOf(browser.shell)).toEqual({ toolbar: 'own-row', hiding: null });
    // The search finds the row by the words of every language.
    const search = page.getByRole('searchbox', { name: 'Search settings' });
    for (const words of ['kompakt', 'zen', 'anordnung']) {
      await search.fill(words);
      await expect(page.locator('[data-row="layout"]')).toBeVisible();
    }
  } finally {
    await browser.close();
  }
});
