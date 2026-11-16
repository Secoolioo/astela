import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  chooseFromMenu,
  chooseMenuItem,
  FixtureServer,
  focusPage,
  launch,
  menuEntries,
  openBrowserMenu,
  overlayAttached,
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

/** The address of a page of the fixture server. */
const fixture = (name: string): string => `${server.origin}/${name}`;

/** Opens a page of the fixture server in the active tab of a window, through its address bar. */
async function open(browser: Browser, name: string, shell = browser.shell): Promise<Page> {
  const address = shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(fixture(name));
  await address.press('Enter');
  const page = await waitForPage(browser, (url) => url === fixture(name));
  await page.waitForLoadState('load');
  // Chromium drops the key presses for a new page until it has painted its first content,
  // which on a slow machine can come after the load event.
  await page.waitForFunction(
    () => performance.getEntriesByName('first-contentful-paint').length > 0,
  );
  return page;
}

/** The command palette of an overlay, with its page and its field. */
interface Palette {
  readonly overlay: Page;
  readonly dialog: Locator;
  readonly field: Locator;
}

/**
 * Opens the palette with its shortcut, or tab search with its own, as pressed in a view, and
 * returns it once its field has the focus. Each window has an overlay of its own, and another
 * window may have one already that shows nothing, such as one that its address bar made for
 * its suggestions; the palette is in the overlay that shows it.
 * @param target - Start of the address of the view that gets the keys; the shell by default.
 * @param except - Pages of overlays of other windows.
 */
async function openPalette(
  browser: Browser,
  target = 'app://shell',
  tabs = false,
  except: readonly Page[] = [],
): Promise<Palette> {
  await pressNative(browser, tabs ? 'A' : 'K', tabs ? ['primary', 'shift'] : ['primary'], target);
  // A window's first popover makes its overlay first, so wait for an overlay before the dialog.
  await overlayPage(browser, except);
  const name = tabs ? 'Search tabs' : 'Command palette';
  let overlay: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const page of browser.cdp.contexts().flatMap((context) => context.pages())) {
          if (!page.url().startsWith('app://overlay') || except.includes(page)) continue;
          const shows = await page
            .getByRole('dialog', { name })
            .isVisible()
            .catch(() => false);
          if (shows) {
            overlay = page;
            break;
          }
        }
        return overlay !== undefined;
      },
      { message: `An overlay shows ${name}` },
    )
    .toBe(true);
  if (overlay === undefined) throw new Error(`No overlay shows ${name}`);
  const dialog = overlay.getByRole('dialog', { name });
  const field = dialog.getByRole('combobox');
  await expect(field).toBeFocused();
  return { overlay, dialog, field };
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

/** How many windows are open. */
function windowCount(browser: Browser): Promise<number> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
}

/** The id of the window that has the focus. */
function focusedWindow(browser: Browser): Promise<number | null> {
  return browser.main.evaluate(({ BaseWindow }) => BaseWindow.getFocusedWindow()?.id ?? null);
}

/** Gives a window the focus and waits until it has it. */
async function focusWindow(browser: Browser, id: number | null): Promise<void> {
  await browser.main.evaluate(
    ({ BaseWindow }, window) => BaseWindow.fromId(window ?? 0)?.focus(),
    id,
  );
  await expect.poll(() => focusedWindow(browser)).toBe(id);
}

/** The shell of the window that the test opened after the first one. */
async function otherShell(browser: Browser): Promise<Page> {
  const find = (): Page | undefined =>
    browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url().startsWith('app://shell') && page !== browser.shell);
  await expect.poll(() => find() !== undefined).toBe(true);
  const shell = find();
  if (shell === undefined) throw new Error('The other window has no shell');
  return shell;
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

/** The key presses with Ctrl or Command that reached the page of `keys.html`. */
function seen(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, 'seen') as unknown);
}

/**
 * Types keys into a view as a person does, all at once, so that none of them waits for the
 * palette: into the view that has the focus, or into the view whose address starts with a
 * prefix, after the shortcut of the palette if asked.
 */
function typeKeys(
  browser: Browser,
  keys: readonly string[],
  shortcut: boolean,
  target?: string,
): Promise<void> {
  return browser.main.evaluate(
    ({ webContents }, { keys: typed, shortcut: first, primary, target: prefix }) => {
      const contents =
        prefix === null
          ? webContents.getFocusedWebContents()
          : (webContents.getAllWebContents().find((view) => view.getURL().startsWith(prefix)) ??
            null);
      if (contents === null) throw new Error('No view gets the keys');
      if (first) {
        contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: [primary] });
        contents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: [primary] });
      }
      for (const key of typed) {
        contents.sendInputEvent({ type: 'keyDown', keyCode: key });
        contents.sendInputEvent({ type: 'char', keyCode: key });
        contents.sendInputEvent({ type: 'keyUp', keyCode: key });
      }
    },
    {
      keys,
      shortcut,
      primary: mac ? ('meta' as const) : ('control' as const),
      target: target ?? null,
    },
  );
}

/**
 * Notes from now on whether the overlay joins the first window, also for a moment only.
 * @returns Stops and tells whether it joined.
 */
async function watchOverlay(browser: Browser): Promise<() => Promise<boolean>> {
  await browser.main.evaluate(({ BaseWindow }) => {
    const window = BaseWindow.getAllWindows()[0];
    const watch = {
      seen: false,
      timer: setInterval(() => {
        const views = window?.contentView.children ?? [];
        if (
          views.some(
            (child) =>
              'webContents' in child &&
              (child as Electron.WebContentsView).webContents.getURL().startsWith('app://overlay'),
          )
        ) {
          watch.seen = true;
        }
      }, 2),
    };
    Reflect.set(globalThis, 'overlayWatch', watch);
  });
  return () =>
    browser.main.evaluate(() => {
      const watch = Reflect.get(globalThis, 'overlayWatch') as {
        seen: boolean;
        timer: NodeJS.Timeout;
      };
      clearInterval(watch.timer);
      return watch.seen;
    });
}

/** Windows has no signal that pauses a process, which some tests use to hold an answer back. */
const pauses = process.platform !== 'win32';

/**
 * Pauses a process of the browser until the returned function lets it go on, so that what
 * it would answer waits, such as the history of the data service.
 */
function pause(pid: number): () => void {
  process.kill(pid, 'SIGSTOP');
  let paused = true;
  return () => {
    if (paused) process.kill(pid, 'SIGCONT');
    paused = false;
  };
}

/** The process of the data service, which keeps the history and the bookmarks, once it runs. */
function dataService(browser: Browser): Promise<number | null> {
  return browser.main.evaluate(
    ({ app }) =>
      app
        .getAppMetrics()
        .find((metric) => metric.type === 'Utility' && metric.name === 'data-service')?.pid ?? null,
  );
}

/** The process of the renderer of the view whose address starts with a prefix. */
function rendererOf(browser: Browser, prefix: string): Promise<number | null> {
  return browser.main.evaluate(
    ({ webContents }, start) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith(start))
        ?.getOSProcessId() ?? null,
    prefix,
  );
}

/**
 * Holds back the code of the command palette, which the browser process imports with the
 * shortcut, so that the next palette opens only once {@link letPaletteGo} lets it, as on a
 * busy computer; the browser holds the keys typed meanwhile.
 */
async function holdBackPalette(browser: Browser): Promise<void> {
  await browser.main.evaluate(() => {
    type Then = (this: Promise<unknown>, fulfilled?: unknown, rejected?: unknown) => unknown;
    const then = Reflect.get(Promise.prototype, 'then') as Then;
    const waiting: (() => void)[] = [];
    Reflect.set(globalThis, 'heldPalette', waiting);
    let held = false;
    const holding: Then = function (fulfilled, rejected) {
      if (typeof fulfilled !== 'function') return then.call(this, fulfilled, rejected);
      const run = fulfilled as (value: unknown) => unknown;
      const wait = (value: unknown): unknown => {
        // The first to get the module of the palette is the import itself, which waits; what
        // waits for the import then gets the module as it comes.
        if (held || typeof value !== 'object' || value === null || !('openPalette' in value)) {
          return run(value);
        }
        held = true;
        Reflect.set(Promise.prototype, 'then', then);
        return new Promise((done) => waiting.push(() => done(run(value))));
      };
      return then.call(this, wait, rejected);
    };
    Reflect.set(Promise.prototype, 'then', holding);
  });
}

/** Whether a palette waits for {@link letPaletteGo}. */
function paletteHeldBack(browser: Browser): Promise<boolean> {
  return browser.main.evaluate(
    () => ((Reflect.get(globalThis, 'heldPalette') as unknown[] | undefined)?.length ?? 0) > 0,
  );
}

/** Whether the page of an overlay shows the command palette or tab search. */
async function paletteShows(browser: Browser): Promise<boolean> {
  const overlays = browser.cdp
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => page.url().startsWith('app://overlay'));
  const shown = await Promise.all(
    overlays.map((overlay) =>
      overlay.getByRole('dialog', { name: /^(?:Command palette|Search tabs)$/ }).count(),
    ),
  );
  return shown.some((count) => count > 0);
}

/** Lets the palette that {@link holdBackPalette} held back go on. */
async function letPaletteGo(browser: Browser): Promise<void> {
  await browser.main.evaluate(() => {
    const waiting = (Reflect.get(globalThis, 'heldPalette') as (() => void)[] | undefined) ?? [];
    for (const go of waiting.splice(0)) go();
  });
}

/**
 * Lets the shell ask for a new tab only some time after a click on New tab, as a busy shell
 * does, while its address bar is the new tab's from the click on.
 */
async function delayNewTabRequest(browser: Browser, delay: number): Promise<void> {
  await browser.shell.evaluate((wait) => {
    const shell = document.querySelector('app-shell') as unknown as {
      bridge: { invoke(channel: string, request: unknown): Promise<unknown> };
    };
    const bridge = shell.bridge;
    const invoke = bridge.invoke.bind(bridge);
    bridge.invoke = (channel, request) =>
      channel === 'tabs.open'
        ? new Promise((done) => setTimeout(done, wait)).then(() => invoke(channel, request))
        : invoke(channel, request);
  }, delay);
}

/** Clicks an element of the shell of the first window through the browser's own input. */
async function clickNative(browser: Browser, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (box === null) throw new Error('The element does not show');
  await browser.main.evaluate(
    ({ webContents }, { x, y }) => {
      const shell = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().startsWith('app://shell'));
      if (shell === undefined) throw new Error('The shell was not found');
      shell.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      shell.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    },
    { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
  );
}

/** The addresses of the tabs of the first window, and the place of the active one. */
async function tabsOf(browser: Browser): Promise<[string[], number]> {
  const state = await shellState(browser.shell);
  return [
    state.tabs.map((tab) => tab.url),
    state.tabs.findIndex((tab) => tab.id === state.activeTabId),
  ];
}

test('opens the command palette from a page, finds a command by English and German words and runs it', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, 'index.html');
    await focusPage(browser, page);
    const palette = await openPalette(browser, server.origin);
    await palette.field.fill('zoom in');
    const first = palette.dialog.getByRole('option').first();
    await expect(first).toHaveAccessibleName(/^Zoom in/);
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(first).toContainText(mac ? '⌘+' : 'Ctrl+Plus');
    await palette.field.press('Enter');
    await expect(palette.dialog).toBeHidden();
    await expect.poll(() => focused(browser, fixture('index.html'))).toBe(true);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.zoom ?? 0)
      .toBeCloseTo(1.1, 3);
    // With the field empty, the command that ran comes first, among those used recently.
    const again = await openPalette(browser, server.origin);
    const groups = again.dialog.getByRole('group');
    await expect(groups.first()).toHaveAccessibleName('Recently used');
    await expect(groups.first().getByRole('option')).toHaveCount(1);
    await expect(groups.first().getByRole('option')).toHaveAccessibleName(/^Zoom in/);
    // A German word finds the command on the English page too.
    await again.field.fill('vergrößern');
    await expect(again.dialog.getByRole('group', { name: 'Recently used' })).toHaveCount(0);
    await expect(again.dialog.getByRole('option').first()).toHaveAccessibleName(/^Zoom in/);
    await again.field.press('Escape');
    await expect(again.dialog).toBeHidden();
    await expect.poll(() => focused(browser, fixture('index.html'))).toBe(true);
    expect((await shellState(browser.shell)).tabs[0]?.zoom ?? 0).toBeCloseTo(1.1, 3);
    // The command Search the open tabs switches the palette to the tabs, and it stays open.
    const third = await openPalette(browser, server.origin);
    await third.field.fill('search the open');
    await expect(third.dialog.getByRole('option').first()).toHaveAccessibleName(
      /^Search the open tabs/,
    );
    await third.field.press('Enter');
    const tabs = third.overlay.getByRole('dialog', { name: 'Search tabs' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Tabs', exact: true })).toBeVisible();
    await expect(tabs.getByRole('combobox')).toHaveValue('');
    await expect(tabs.getByRole('combobox')).toBeFocused();
    await expect(tabs.getByRole('option', { name: /^Fixture home/ })).toBeVisible();
    await new Promise((done) => setTimeout(done, 500));
    await expect(tabs).toBeVisible();
    // The switch ran no command of the browser, so the commands used recently stay as they were.
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(tabs).toBeHidden();
    const fourth = await openPalette(browser, server.origin);
    const recent = fourth.dialog.getByRole('group', { name: 'Recently used' });
    await expect(recent.getByRole('option')).toHaveCount(1);
    await expect(recent.getByRole('option')).toHaveAccessibleName(/^Zoom in/);
  } finally {
    await browser.close();
  }
});

test('closes with its own shortcut, Escape or a click next to it, and closes and runs any other shortcut', async () => {
  const browser = await launch();
  try {
    const first = await openPalette(browser);
    await pressNative(browser, 'K', ['primary'], 'app://overlay');
    await expect(first.dialog).toBeHidden();
    // It stays closed: the shortcut opens no palette again.
    await new Promise((done) => setTimeout(done, 500));
    await expect(first.dialog).toBeHidden();
    expect(await overlayAttached(browser)).toBe(false);
    const second = await openPalette(browser);
    await second.overlay.mouse.click(5, 5);
    await expect(second.dialog).toBeHidden();
    // Escape closes it, and the shell has the focus again for the new tab page.
    const third = await openPalette(browser);
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(third.dialog).toBeHidden();
    await expect.poll(() => focused(browser, 'app://shell')).toBe(true);
    // Any other shortcut closes it and runs.
    const fourth = await openPalette(browser);
    await pressNative(browser, 'T', ['primary'], 'app://overlay');
    await expect(fourth.dialog).toBeHidden();
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    // The shortcut of tab search switches to the tabs and keeps the text; again, it closes.
    const fifth = await openPalette(browser);
    await fifth.field.fill('fixture');
    await pressNative(browser, 'A', ['primary', 'shift'], 'app://overlay');
    const tabs = fifth.overlay.getByRole('dialog', { name: 'Search tabs' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Tabs', exact: true })).toBeVisible();
    await expect(tabs.getByRole('combobox')).toHaveValue('fixture');
    await expect(tabs.getByRole('combobox')).toBeFocused();
    // The shortcut of the palette switches back.
    await pressNative(browser, 'K', ['primary'], 'app://overlay');
    await expect(fifth.dialog).toBeVisible();
    await expect(fifth.field).toHaveValue('fixture');
    await pressNative(browser, 'A', ['primary', 'shift'], 'app://overlay');
    await expect(tabs).toBeVisible();
    await pressNative(browser, 'A', ['primary', 'shift'], 'app://overlay');
    await expect(tabs).toBeHidden();
    await expect(fifth.dialog).toBeHidden();
  } finally {
    await browser.close();
  }
});

test('closes when its window loses the focus, and gives the focus back to the page with the window', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, 'index.html');
    await focusPage(browser, page);
    const first = await focusedWindow(browser);
    await pressNative(browser, 'N', ['primary']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    await expect.poll(() => focusedWindow(browser)).not.toBe(first);
    const second = await focusedWindow(browser);
    await focusWindow(browser, first);
    await expect.poll(() => focused(browser, fixture('index.html'))).toBe(true);
    const palette = await openPalette(browser, fixture('index.html'));
    await palette.field.fill('zoom');
    await focusWindow(browser, second);
    await expect(palette.dialog).toBeHidden();
    await expect.poll(() => overlayAttached(browser, first ?? undefined)).toBe(false);
    await focusWindow(browser, first);
    await expect.poll(() => focused(browser, fixture('index.html'))).toBe(true);
  } finally {
    await browser.close();
  }
});

test('lists only the commands that can run now, also those of the menus, and runs them on the active tab', async () => {
  const browser = await launch();
  try {
    const source = /^View the source/;
    const back = /^Back( |$)/;
    // The new tab page is one of the browser's own pages, without history.
    const blank = await openPalette(browser);
    await blank.field.fill('source');
    await expect(blank.dialog.getByRole('option', { name: source })).toHaveCount(0);
    await blank.field.fill('back');
    await expect(blank.dialog.getByRole('option', { name: back })).toHaveCount(0);
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(blank.dialog).toBeHidden();
    await open(browser, 'index.html');
    const page = await open(browser, 'second.html');
    await focusPage(browser, page);
    const web = await openPalette(browser, fixture('second.html'));
    await web.field.fill('source');
    await expect(web.dialog.getByRole('option', { name: source })).toBeVisible();
    await web.field.fill('back');
    await expect(web.dialog.getByRole('option', { name: back })).toBeVisible();
    // A command that only the menu of a tab had before.
    await web.field.fill('duplicate');
    await expect(web.dialog.getByRole('option').first()).toHaveAccessibleName(/^Duplicate the tab/);
    await web.field.press('Enter');
    await expect(web.dialog).toBeHidden();
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('second.html'), fixture('second.html')], 1]);
    const other = await openPalette(browser, fixture('second.html'));
    await other.field.fill('close the other');
    await expect(other.dialog.getByRole('option').first()).toHaveAccessibleName(
      /^Close the other tabs/,
    );
    await other.field.press('Enter');
    await expect.poll(() => tabsOf(browser)).toEqual([[fixture('second.html')], 0]);
  } finally {
    await browser.close();
  }
});

test('is a dialog with a combobox and a grouped listbox that the keyboard drives, and does not move when the system asks for reduced motion', async () => {
  const browser = await launch();
  try {
    const { overlay, dialog, field } = await openPalette(browser);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(field).toHaveAttribute('aria-expanded', 'true');
    await expect(field).toHaveAttribute('aria-autocomplete', 'list');
    const listbox = dialog.getByRole('listbox', { name: 'Results' });
    await expect(listbox).toBeVisible();
    await expect(field).toHaveAttribute('aria-controls', (await listbox.getAttribute('id')) ?? '-');
    await expect(dialog.getByRole('group', { name: 'Commands' })).toBeVisible();
    const marked = dialog.locator('[role="option"][aria-selected="true"]');
    await expect(marked).toHaveCount(1);
    const ids = await dialog
      .getByRole('option')
      .evaluateAll((all) => all.map((option) => option.id));
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
    const active = async (id: string | undefined): Promise<void> => {
      await expect(field).toHaveAttribute('aria-activedescendant', id ?? '-');
      await expect(marked).toHaveAttribute('id', id ?? '-');
    };
    await active(ids[0]);
    await field.press('ArrowDown');
    await active(ids[1]);
    await field.press('ArrowUp');
    await active(ids[0]);
    // The arrows go round at the ends; Page Down moves by eight rows.
    await field.press('ArrowUp');
    await active(ids.at(-1));
    await field.press('ArrowDown');
    await active(ids[0]);
    await field.press('PageDown');
    await active(ids[8]);
    await field.press('Tab');
    await expect(field).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText(/^Results: \d+$/);
    // A prefix narrows the search to the commands, and Backspace in the empty field widens it.
    const chip = dialog.getByRole('button', { name: 'Commands', exact: true });
    await field.fill('> ');
    await expect(chip).toBeVisible();
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Search commands');
    await field.press('Backspace');
    await expect(chip).toBeHidden();
    await expect(field).toHaveAttribute('placeholder', 'Search commands, tabs, pages and settings');
    // Forced colors keep the marked row visible with the system's outline.
    await overlay.emulateMedia({ forcedColors: 'active' });
    await expect(marked).toHaveCSS('outline-style', 'solid');
    await overlay.emulateMedia({ forcedColors: 'none' });
    const motion = (): Promise<string> =>
      dialog.evaluate((panel) => getComputedStyle(panel).getPropertyValue('--motion-enter').trim());
    expect(await motion()).not.toBe('0ms');
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(dialog).toBeHidden();
    // With reduced motion, the palette enters without any animation.
    await overlay.emulateMedia({ reducedMotion: 'reduce' });
    const still = await openPalette(browser);
    expect(await motion()).toBe('0ms');
    expect(await still.dialog.evaluate((panel) => panel.getAnimations().length)).toBe(0);
  } finally {
    await browser.close();
  }
});

test('keeps the keys typed right after the shortcut and gives none of them to the page', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, 'keys.html');
    await focusPage(browser, page);
    await expect(page.locator('#field')).toBeFocused();
    // The palette loads with its first shortcut, so these keys still go to the page's view.
    await typeKeys(browser, ['z', 'o', 'o', 'm'], true);
    await expect
      .poll(() =>
        browser.main.evaluate(
          ({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? '',
        ),
      )
      .toMatch(/^app:\/\/overlay/);
    await typeKeys(browser, ['Space', 'i', 'n'], false);
    const overlay = await overlayPage(browser);
    const dialog = overlay.getByRole('dialog', { name: 'Command palette' });
    const field = dialog.getByRole('combobox');
    await expect(field).toHaveValue('zoom in');
    await expect(page.locator('#field')).toHaveValue('');
    expect(await seen(page)).toEqual([]);
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(dialog).toBeHidden();
    await expect.poll(() => focused(browser, fixture('keys.html'))).toBe(true);
    // An Enter typed right after the shortcut and the words chooses the first result.
    await typeKeys(browser, ['z', 'o', 'o', 'm', 'Space', 'i', 'n', 'Enter'], true);
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.zoom ?? 0)
      .toBeCloseTo(1.1, 3);
    await expect(dialog).toBeHidden();
    await expect.poll(() => focused(browser, fixture('keys.html'))).toBe(true);
    await expect(page.locator('#field')).toHaveValue('');
    // An Escape typed right after the shortcut opens nothing, not even for a moment, and the
    // page keeps the focus.
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    const shown = await watchOverlay(browser);
    await typeKeys(browser, ['Escape'], true);
    await new Promise((done) => setTimeout(done, 500));
    expect(await shown()).toBe(false);
    await expect(dialog).toBeHidden();
    expect(await focused(browser, fixture('keys.html'))).toBe(true);
    await expect(page.locator('#field')).toHaveValue('');
    expect(await seen(page)).toEqual([]);
    expect((await shellState(browser.shell)).tabs[0]?.zoom ?? 0).toBeCloseTo(1.1, 3);
  } finally {
    await browser.close();
  }
});

test('puts the keys typed right after the shortcut into the field, also when a later search answers first', async () => {
  test.skip(!pauses, 'Windows has no signal that pauses a process');
  const browser = await launch();
  let resume: (() => void) | undefined;
  try {
    const page = await open(browser, 'keys.html');
    await focusPage(browser, page);
    // The data service runs since the new tab page, and the visit of the page reached it.
    await expect.poll(() => dataService(browser)).not.toBeNull();
    const pid = await dataService(browser);
    if (pid === null) throw new Error('The data service does not run');
    // While the data service waits, so does the first search, which reads the history.
    resume = pause(pid);
    await typeKeys(browser, ['z', 'z', 'z'], true);
    const overlay = await overlayPage(browser);
    const field = overlay.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox');
    await expect(field).toBeFocused();
    // Tab search reads no history, so its answer comes first, for the text without the keys.
    await field.fill('% ');
    const tabs = overlay.getByRole('dialog', { name: 'Search tabs' });
    await expect(tabs.getByRole('option', { name: /^Fixture keys/ })).toBeVisible();
    resume?.();
    await expect(tabs.getByRole('combobox')).toHaveValue('zzz');
    // The list asks again for the text with the keys, which no tab matches.
    await expect(tabs.getByRole('option')).toHaveCount(0);
    await expect(tabs).toContainText('Nothing matches zzz.');
    await expect(page.locator('#field')).toHaveValue('');
  } finally {
    resume?.();
    await browser.close();
  }
});

test('closes the palette for an Escape that its page did not get yet, and gives the focus back to the page', async () => {
  test.skip(!pauses, 'Windows has no signal that pauses a process');
  const browser = await launch();
  let resume: (() => void) | undefined;
  try {
    const page = await open(browser, 'keys.html');
    await focusPage(browser, page);
    // The pointer on the menu button loads the overlay's page before any popover.
    await browser.shell.getByRole('button', { name: 'Menu', exact: true }).hover();
    const overlay = await overlayPage(browser);
    await overlay.waitForLoadState('load');
    await focusPage(browser, page);
    const pid = await rendererOf(browser, 'app://overlay');
    if (pid === null) throw new Error('The overlay has no renderer');
    // Only the overlay's page waits: the shell and the page have renderers of their own.
    expect(pid).not.toBe(await rendererOf(browser, 'app://shell'));
    expect(pid).not.toBe(await rendererOf(browser, fixture('keys.html')));
    resume = pause(pid);
    await typeKeys(browser, [], true);
    // The palette shows in the overlay, whose page cannot ask for the keys yet.
    await expect.poll(() => overlayAttached(browser)).toBe(true);
    await typeKeys(browser, ['Escape'], false, fixture('keys.html'));
    resume?.();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(overlay.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect.poll(() => focused(browser, fixture('keys.html'))).toBe(true);
    await expect(page.locator('#field')).toHaveValue('');
    expect(await seen(page)).toEqual([]);
  } finally {
    resume?.();
    await browser.close();
  }
});

test('opens nothing for a click on New tab that follows the shortcut while the palette loads, and gives what is typed after the click to the new tab', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    const page = await open(browser, 'keys.html');
    await focusPage(browser, page);
    await holdBackPalette(browser);
    await typeKeys(browser, ['x'], true);
    await expect.poll(() => paletteHeldBack(browser)).toBe(true);
    // The palette is not ready yet when New tab is clicked.
    await clickNative(browser, shell.getByRole('button', { name: 'New tab' }));
    await expect.poll(async () => (await shellState(shell)).tabs.length).toBe(2);
    await expect(address).toBeFocused();
    await typeKeys(browser, ['a', 'b', 'c'], false, 'app://shell');
    await expect(address).toHaveValue('abc');
    await letPaletteGo(browser);
    await new Promise((done) => setTimeout(done, 500));
    // The overlay may show the suggestions for what was typed, but no palette, and the focus
    // stays in the address bar.
    expect(await paletteShows(browser)).toBe(false);
    expect(await focused(browser, 'app://shell')).toBe(true);
    await expect(address).toHaveValue('abc');
    const state = await shellState(shell);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
    // What was typed for the palette before the click went nowhere, and none of it to the page.
    await expect(page.locator('#field')).toHaveValue('');
    expect(await seen(page)).toEqual([]);
    await typeKeys(browser, ['d'], false, 'app://shell');
    await expect(address).toHaveValue('abcd');
    // The next shortcut opens the palette, with nothing typed.
    const { field } = await openPalette(browser);
    await expect(field).toHaveValue('');
  } finally {
    await browser.close();
  }
});

test('opens the palette over the new tab after a click on New tab before the shortcut, also when the request of the click comes late', async () => {
  const browser = await launch();
  try {
    const shell = browser.shell;
    const address = shell.getByRole('textbox', { name: 'Address and search bar' });
    await open(browser, 'index.html');
    await delayNewTabRequest(browser, 800);
    await holdBackPalette(browser);
    await clickNative(browser, shell.getByRole('button', { name: 'New tab' }));
    await expect(address).toBeFocused();
    // The shortcut and the keys come before the browser hears of the click.
    await typeKeys(browser, ['z', 'o', 'o', 'm'], true, 'app://shell');
    await expect.poll(() => paletteHeldBack(browser)).toBe(true);
    await expect.poll(async () => (await shellState(shell)).tabs.length).toBe(2);
    await letPaletteGo(browser);
    const overlay = await overlayPage(browser);
    const dialog = overlay.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog.getByRole('combobox')).toHaveValue('zoom');
    await expect(address).toHaveValue('');
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(dialog).toBeHidden();
    await expect.poll(() => focused(browser, 'app://shell')).toBe(true);
    const state = await shellState(shell);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
  } finally {
    await browser.close();
  }
});

test('never takes the place of a question of a site, whose shortcuts of the palette do nothing', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, 'permissions.html');
    const asked = page.evaluate(() => Notification.requestPermission());
    const overlay = await overlayPage(browser);
    const question = overlay.getByRole('dialog', {
      name: `${new URL(server.origin).host} wants to`,
    });
    await expect(question).toBeFocused();
    await pressNative(browser, 'K', ['primary'], 'app://overlay');
    await pressNative(browser, 'A', ['primary', 'shift'], 'app://overlay');
    await new Promise((done) => setTimeout(done, 500));
    await expect(question).toBeVisible();
    await expect(question).toBeFocused();
    await expect(overlay.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect(overlay.getByRole('dialog', { name: 'Search tabs' })).toHaveCount(0);
    await question.getByRole('button', { name: 'Allow' }).click();
    expect(await asked).toBe('granted');
    await expect(question).toBeHidden();
    // Once the question has its answer, the shortcut opens the palette.
    await openPalette(browser, server.origin);
  } finally {
    await browser.close();
  }
});

test('switches to an open tab of another window from tab search', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html');
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const first = await focusedWindow(browser);
    await pressNative(browser, 'N', ['primary']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    const second = await otherShell(browser);
    await open(browser, 'second.html', second);
    await expect.poll(() => focusedWindow(browser)).not.toBe(first);
    const search = await openPalette(browser, fixture('second.html'), true);
    const here = search.dialog.getByRole('group', { name: 'This window' });
    await expect(here.getByRole('option')).toHaveCount(1);
    await expect(here.getByRole('option')).toHaveAccessibleName(/^Fixture second.*Current tab$/);
    await expect(search.dialog.getByRole('group', { name: 'Other windows' })).toBeVisible();
    await search.field.fill('fixture home');
    const option = search.dialog.getByRole('option', { name: /Fixture home.*Other window/ });
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await search.field.press('Enter');
    await expect(search.dialog).toBeHidden();
    await expect.poll(() => focusedWindow(browser)).toBe(first);
    await expect.poll(() => tabsOf(browser)).toEqual([[fixture('index.html'), 'app://newtab/'], 0]);
  } finally {
    await browser.close();
  }
});

test('shows a tab that sleeps in tab search with the icon of its page, says that it sleeps and wakes it when chosen', async () => {
  const browser = await launch();
  try {
    await open(browser, 'icon.html');
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await recordMenus(browser);
    const tab = browser.shell.getByRole('tab', { name: 'Page with an icon' });
    await tab.click({ button: 'right' });
    await chooseMenuItem(browser, [mac ? 'Put Tab to Sleep' : 'Put tab to sleep']);
    await expect(tab).toHaveAttribute('data-sleeping', '');
    const search = await openPalette(browser, 'app://shell', true);
    const option = search.dialog.getByRole('option', { name: /^Page with an icon/ });
    await expect(option).toHaveAttribute(
      'aria-description',
      'Sleeping, loads again when you open it',
    );
    await expect(option.locator('.tag', { hasText: 'Sleeping' })).toBeVisible();
    // The page is gone, and the icon comes from the store of the window's web pages.
    await expect(option.locator('.icon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect
      .poll(() => option.locator('.icon').evaluate((icon) => getComputedStyle(icon).opacity))
      .toBe('0.7');
    const awake = search.dialog.getByRole('option', { name: /^New tab/ });
    await expect(awake).not.toHaveAttribute('aria-description');
    await expect(awake.locator('.tag', { hasText: 'Sleeping' })).toHaveCount(0);
    await option.click();
    await expect(search.dialog).toBeHidden();
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0])
      .toMatchObject({ sleeping: false, loading: false, title: 'Page with an icon' });
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'Page with an icon',
    );
  } finally {
    await browser.close();
  }
});

test('searches only the tabs of private windows in a private window, and never shows them in a regular one', async () => {
  const browser = await launch();
  try {
    await open(browser, 'icon.html');
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs[0]?.favicon ?? null)
      .not.toBeNull();
    const icon = (await shellState(browser.shell)).tabs[0]?.favicon ?? null;
    const regularWindow = await focusedWindow(browser);
    await pressNative(browser, 'N', ['primary', 'shift']);
    await expect.poll(() => windowCount(browser)).toBe(2);
    const privateShell = await otherShell(browser);
    expect((await shellState(privateShell)).private).toBe(true);
    await open(browser, 'second.html', privateShell);
    const inPrivate = await openPalette(browser, fixture('second.html'), true);
    await expect(inPrivate.dialog.getByRole('option', { name: /^Fixture second/ })).toBeVisible();
    await expect(inPrivate.dialog.getByRole('option')).toHaveCount(1);
    await inPrivate.field.fill('page');
    await expect(inPrivate.dialog.getByRole('option')).toHaveCount(0);
    // The icon of the regular window's page is none of the private window's.
    const favicon = (overlay: Page): Promise<unknown> =>
      overlay.evaluate((key) => window.bridge.invoke('overlay.favicon', { key }), icon);
    expect(await favicon(inPrivate.overlay)).toBeNull();
    // Escape goes to the palette's own overlay, as the regular window may have one too.
    await inPrivate.field.press('Escape');
    await expect(inPrivate.dialog).toBeHidden();
    await focusWindow(browser, regularWindow);
    const regular = await openPalette(browser, fixture('icon.html'), true, [inPrivate.overlay]);
    await expect(regular.dialog.getByRole('option', { name: /^Page with an icon/ })).toBeVisible();
    await expect(regular.dialog.getByRole('option')).toHaveCount(1);
    await regular.field.fill('fixture');
    await expect(regular.dialog.getByRole('option')).toHaveCount(0);
    expect(await favicon(regular.overlay)).toMatch(/^data:image\//);
  } finally {
    await browser.close();
  }
});

test('finds bookmarks and visited pages, narrows the search with a prefix and opens pages in a new tab or in the tab of the new tab page', async () => {
  const browser = await launch();
  try {
    await open(browser, 'index.html');
    // The star's shortcut adds the bookmark, and its popover closes with Escape.
    await pressNative(browser, 'D', ['primary'], fixture('index.html'));
    await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.bookmarked).toBe(true);
    // Escape goes to the popover once it shows, with its name focused: the overlay's page, once
    // loaded, gets Escape itself, and the popover closes for it only once it is there.
    const title = (await overlayPage(browser))
      .getByRole('dialog', { name: 'Bookmark added' })
      .getByRole('textbox', { name: 'Name' });
    await expect(title).toBeFocused();
    await title.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await open(browser, 'find.html');
    await open(browser, 'second.html');
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('second.html'), 'app://newtab/'], 1]);
    const palette = await openPalette(browser);
    const group = (name: string): Locator => palette.dialog.getByRole('group', { name });
    // The visits reach the history a moment after the pages loaded.
    await expect(async () => {
      await palette.field.fill('');
      await palette.field.fill('fixture');
      await expect(group('History')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(group('Open tabs').getByRole('option')).toHaveCount(1);
    await expect(group('Open tabs').getByRole('option')).toHaveAccessibleName(/^Fixture second/);
    await expect(group('Bookmarks').getByRole('option')).toHaveCount(1);
    await expect(group('Bookmarks').getByRole('option')).toHaveAccessibleName(/^Fixture home/);
    await expect(group('History').getByRole('option')).toHaveCount(1);
    await expect(group('History').getByRole('option')).toHaveAccessibleName(/^Fixture find/);
    await expect(group('Web').getByRole('option')).toHaveCount(1);
    await expect(group('Web').getByRole('option')).toHaveAccessibleName(/^Search for “fixture”/);
    // A visited page opens in the tab of the new tab page.
    await group('History').getByRole('option').click();
    await expect(palette.dialog).toBeHidden();
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('second.html'), fixture('find.html')], 1]);
    const found = await waitForPage(browser, (url) => url === fixture('find.html'));
    await found.waitForLoadState('load');
    await focusPage(browser, found);
    // From a web page, a bookmark opens in a new tab after the active one.
    const marks = await openPalette(browser, fixture('find.html'));
    await marks.field.fill('* fixture');
    await expect(
      marks.dialog.getByRole('button', { name: 'Bookmarks', exact: true }),
    ).toBeVisible();
    await expect(marks.field).toHaveValue('fixture');
    await expect(marks.dialog.getByRole('option')).toHaveCount(1);
    await expect(marks.dialog.getByRole('option')).toHaveAccessibleName(/^Fixture home/);
    await marks.field.press('Enter');
    await expect(marks.dialog).toBeHidden();
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('second.html'), fixture('find.html'), fixture('index.html')], 2]);
  } finally {
    await browser.close();
  }
});

test('finds a setting by its English or German name and opens the settings at its row, also a second time', async () => {
  const browser = await launch();
  try {
    const page = await open(browser, 'index.html');
    await focusPage(browser, page);
    const palette = await openPalette(browser, fixture('index.html'));
    await palette.field.fill('dichte');
    const option = palette.dialog.getByRole('option', { name: /^Density.*Settings › Appearance/ });
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await palette.field.press('Enter');
    const settings = await waitForPage(
      browser,
      (url) => url === 'app://settings/#appearance.density',
    );
    /** The row of the settings page whose control has the focus, and how far the page scrolled. */
    const focusedRow = (): Promise<[string | null, number]> =>
      settings.evaluate(() => {
        const root = document.querySelector('settings-page')?.shadowRoot;
        const row = root?.activeElement?.closest('[data-row]')?.getAttribute('data-row') ?? null;
        return [row, scrollY];
      });
    await expect.poll(async () => (await focusedRow())[0]).toBe('appearance.density');
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('index.html'), 'app://settings/#appearance.density'], 1]);
    // The settings page scrolls away and its search takes the focus; the first tab shows.
    await settings.evaluate(() => scrollTo(0, 0));
    await settings.getByRole('searchbox', { name: 'Search settings' }).focus();
    expect(await focusedRow()).toEqual([null, 0]);
    await pressNative(browser, '1', ['primary'], 'app://settings');
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('index.html'), 'app://settings/#appearance.density'], 0]);
    await expect.poll(() => focused(browser, fixture('index.html'))).toBe(true);
    const again = await openPalette(browser, fixture('index.html'));
    await again.field.fill('dichte');
    await again.field.press('Enter');
    await expect
      .poll(() => tabsOf(browser))
      .toEqual([[fixture('index.html'), 'app://settings/#appearance.density'], 1]);
    await expect.poll(async () => (await focusedRow())[0]).toBe('appearance.density');
    expect((await focusedRow())[1]).toBeGreaterThan(0);
  } finally {
    await browser.close();
  }
});

test('leaves Ctrl+K to web pages while the palette is off, and takes it again once it is on', async () => {
  const browser = await launch([], { settings: { 'commandPalette.enabled': false } });
  try {
    const page = await open(browser, 'keys.html');
    await focusPage(browser, page);
    await pressNative(browser, 'K', ['primary'], server.origin);
    await pressNative(browser, 'A', ['primary', 'shift'], server.origin);
    const keys = mac ? ['Cmd+K', 'Cmd+A'] : ['Ctrl+K', 'Ctrl+A'];
    await expect.poll(() => seen(page)).toEqual(keys);
    await new Promise((done) => setTimeout(done, 500));
    expect(await overlayViews(browser)).toBe(0);
    // The browser menu has no items of the palette while it is off.
    const menu = await openBrowserMenu(browser);
    const entries = await menuEntries(menu);
    expect(entries.filter((entry) => /^(?:Command palette|Search tabs)/i.test(entry))).toEqual([]);
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(menu).toBeHidden();
    // The switch in the settings turns it on at once.
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(2);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await expect(address).toBeFocused();
    await address.fill('app://settings/#commandPalette.enabled');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const toggle = settings.getByRole('switch', { name: 'Command palette and tab search' });
    await expect(toggle).not.toBeChecked();
    // The shortcuts below the switch follow it: the palette's have none while it is off.
    const keysOf = (command: string): Promise<string[]> =>
      settings.locator(`[data-command="${command}"]`).locator('kbd').allTextContents();
    await expect.poll(() => keysOf('tab.new')).toEqual([mac ? '⌘T' : 'Ctrl+T']);
    const row = settings.locator('[data-command="palette.open"]');
    await expect(row).toContainText('No shortcut');
    expect(await keysOf('palette.open')).toEqual([]);
    await toggle.check();
    await expect(toggle).toBeChecked();
    await expect.poll(() => keysOf('palette.open')).toEqual([mac ? '⌘K' : 'Ctrl+K']);
    await expect.poll(() => keysOf('tabs.search')).toEqual([mac ? '⇧⌘A' : 'Ctrl+Shift+A']);
    await expect(row).not.toContainText('No shortcut');
    await pressNative(browser, '1', ['primary'], 'app://settings');
    await expect.poll(() => focused(browser, fixture('keys.html'))).toBe(true);
    const palette = await openPalette(browser, server.origin);
    await expect(palette.dialog).toBeVisible();
    expect(await seen(page)).toEqual(keys);
  } finally {
    await browser.close();
  }
});

test('opens the palette and tab search from the browser menu, which shows their shortcuts', async () => {
  const browser = await launch();
  try {
    const [paletteItem, tabsItem] = mac
      ? ['Command Palette…', 'Search Tabs…']
      : ['Command palette…', 'Search tabs…'];
    const menu = await openBrowserMenu(browser);
    expect(await menuEntries(menu)).toEqual(
      expect.arrayContaining(
        mac
          ? [`${paletteItem} ⌘K`, `${tabsItem} ⇧⌘A`]
          : [`${paletteItem} Ctrl+K`, `${tabsItem} Ctrl+Shift+A`],
      ),
    );
    await chooseFromMenu(menu, [paletteItem]);
    const overlay = await overlayPage(browser);
    const palette = overlay.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toBeFocused();
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(palette).toBeHidden();
    await chooseFromMenu(await openBrowserMenu(browser), [tabsItem]);
    const tabs = overlay.getByRole('dialog', { name: 'Search tabs' });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('combobox')).toBeFocused();
    // The palette stays, as nothing took the focus from it.
    await new Promise((done) => setTimeout(done, 500));
    await expect(tabs).toBeVisible();
  } finally {
    await browser.close();
  }
});

/** Clicks an item of the View menu of the menu bar of macOS, as a person does. */
function clickView(browser: Browser, label: string): Promise<void> {
  return browser.main.evaluate(({ Menu }, name) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View');
    const item = view?.submenu?.items.find((candidate) => candidate.label === name);
    if (item === undefined) throw new Error(`The View menu has no item ${name}`);
    item.click();
  }, label);
}

test.describe('with the menu bar of macOS', () => {
  test.skip(!mac, 'Only macOS has a menu bar of its own');

  test('toggles the palette and tab search from the View menu, and leaves a question of a site in its place', async () => {
    const browser = await launch();
    try {
      await clickView(browser, 'Command Palette…');
      const overlay = await overlayPage(browser);
      const dialog = overlay.getByRole('dialog', { name: 'Command palette' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('combobox')).toBeFocused();
      await dialog.getByRole('combobox').fill('fixture');
      // The menu bar offers its command to the palette first, which switches to the tabs.
      await clickView(browser, 'Search Tabs…');
      const tabs = overlay.getByRole('dialog', { name: 'Search tabs' });
      await expect(tabs).toBeVisible();
      await expect(tabs.getByRole('combobox')).toHaveValue('fixture');
      await expect(tabs.getByRole('combobox')).toBeFocused();
      // The command of the scope that shows closes it.
      await clickView(browser, 'Search Tabs…');
      await expect(tabs).toBeHidden();
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      // A site's question keeps its place.
      const page = await open(browser, 'permissions.html');
      const asked = page.evaluate(() => Notification.requestPermission());
      const question = overlay.getByRole('dialog', {
        name: `${new URL(server.origin).host} wants to`,
      });
      await expect(question).toBeFocused();
      await clickView(browser, 'Command Palette…');
      await new Promise((done) => setTimeout(done, 500));
      await expect(question).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await question.getByRole('button', { name: 'Allow' }).click();
      expect(await asked).toBe('granted');
    } finally {
      await browser.close();
    }
  });
});
