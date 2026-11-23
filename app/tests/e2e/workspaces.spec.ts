import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  chooseMenuItem,
  FixtureServer,
  focusPage,
  launch,
  lastMenu,
  menuCount,
  overlayAttached,
  overlayPage,
  pressNative,
  recordMenus,
  shellState,
  startAgain,
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

/** The address of a fixture page. */
const fixture = (name: string): string => `${server.origin}/${name}`;

/** The item of the tab menu that moves a tab into another workspace, without access keys. */
const moveItem = mac ? 'Move to Workspace' : 'Move to workspace';
/** The end of the item of a workspace where a moved tab loads again. */
const reloads = mac ? '(Loads Again)' : '(loads again)';

/** The address bar of the shell. */
function addressBar(browser: Browser, shell = browser.shell): Locator {
  return shell.getByRole('textbox', { name: 'Address and search bar' });
}

/** Loads an address in the active tab and gives its page. */
async function open(browser: Browser, url: string, shell = browser.shell): Promise<Page> {
  await addressBar(browser, shell).fill(url);
  await addressBar(browser, shell).press('Enter');
  return waitForPage(browser, (current) => current === url);
}

/** Opens a page in a new tab, once the new tab is the active one. */
async function openInNewTab(browser: Browser, url: string, count: number): Promise<Page> {
  await browser.shell.getByRole('button', { name: 'New tab' }).click();
  await newTabShown(browser, count);
  return open(browser, url);
}

/** Waits until the window shows a number of tabs, a new tab page the active one. */
async function newTabShown(browser: Browser, count: number, shell = browser.shell): Promise<void> {
  await expect(shell.getByRole('tab')).toHaveCount(count);
  await expect(shell.getByRole('tab', { selected: true })).toHaveAttribute('title', 'New tab');
}

/** A tab of the strip by its title. */
function tab(browser: Browser, title: string): Locator {
  return browser.shell.getByRole('tab', { name: title, exact: true });
}

/** The titles of the tabs that the window shows, in their order. */
async function titles(shell: Page): Promise<string[]> {
  return (await shellState(shell)).tabs.map((one) => one.title);
}

/** The button of the workspaces while it names a workspace. */
function workspaceButton(shell: Page, name: string): Locator {
  return shell.getByRole('button', { name: `Workspace ${name}`, exact: true });
}

/** The id of a workspace of the profile, by its name. */
async function workspaceId(browser: Browser, name: string): Promise<string> {
  const id = (await shellState(browser.shell)).workspaces.find((one) => one.name === name)?.id;
  if (id === undefined) throw new Error(`No workspace ${name}`);
  return id;
}

/** Opens the list of the workspaces with a click on its button. */
async function openList(browser: Browser): Promise<Locator> {
  const button = browser.shell.getByRole('button', { name: /^Workspace / });
  await expect(button).toBeVisible();
  await button.click();
  const overlay = await overlayPage(browser);
  const dialog = overlay.getByRole('dialog', { name: 'Workspaces' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A workspace of the list, by its name. */
function row(dialog: Locator, name: string): Locator {
  return dialog.getByRole('button', { name: new RegExp(`^${name} `) });
}

/**
 * Makes a workspace in the list, which the window then shows with a new tab page.
 * @param look - Its icon and its color, and whether it keeps its cookies apart.
 */
async function createWorkspace(
  browser: Browser,
  name: string,
  look: { readonly icon?: string; readonly color?: string; readonly isolated?: boolean } = {},
): Promise<void> {
  const dialog = await openList(browser);
  await dialog.getByRole('button', { name: 'New workspace' }).click();
  const field = dialog.getByRole('textbox', { name: 'Name' });
  await expect(field).toBeFocused();
  await field.fill(name);
  if (look.icon !== undefined) await dialog.getByRole('radio', { name: look.icon }).check();
  if (look.color !== undefined) await dialog.getByRole('radio', { name: look.color }).check();
  if (look.isolated === true) {
    await dialog.getByRole('checkbox', { name: 'Keep its cookies and sign-ins apart' }).check();
  }
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect.poll(() => overlayAttached(browser)).toBe(false);
  await expect(workspaceButton(browser.shell, name)).toBeVisible();
  await newTabShown(browser, 1);
}

/** Presses the shortcut of the workspace at a place: Alt and its digit, Control on macOS. */
function pressWorkspace(browser: Browser, place: number, target = 'app://shell'): Promise<void> {
  return pressNative(browser, String(place), [mac ? 'control' : 'alt'], target);
}

/** Opens the menu of a tab, which the harness records, and waits for it. */
async function menuOf(browser: Browser, title: string): Promise<void> {
  const before = await menuCount(browser);
  await tab(browser, title).click({ button: 'right' });
  await expect.poll(() => menuCount(browser)).toBe(before + 1);
}

/** The texts of the items of a submenu of the last menu, without the marks of access keys. */
function submenuOf(browser: Browser, label: string): Promise<string[]> {
  return browser.main.evaluate((_electron, wanted) => {
    const menus = (globalThis as unknown as { recordedMenus?: { menu: Electron.Menu }[] })
      .recordedMenus;
    const item = menus
      ?.at(-1)
      ?.menu.items.find((each) => each.label.replace(/&(&?)/g, '$1') === wanted);
    return (item?.submenu?.items ?? []).map((each) => each.label.replace(/&(&?)/g, '$1'));
  }, label);
}

/** A value that a test keeps in the page of a tab, to tell that its page never loaded again. */
function kept(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, 'kept'));
}

/** The pages of the fixture server that the browser has loaded now. */
function fixturePages(browser: Browser): Promise<string[]> {
  return browser.main.evaluate(
    ({ webContents }, origin) =>
      webContents
        .getAllWebContents()
        .map((contents) => contents.getURL())
        .filter((url) => url.startsWith(origin)),
    server.origin,
  );
}

/** The number of buttons of the workspaces in the private window, or -1 before it shows. */
async function privateButtons(browser: Browser): Promise<number> {
  const shells = browser.cdp
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed() && page.url().startsWith('app://shell'));
  for (const shell of shells) {
    try {
      if ((await shellState(shell)).private) {
        return await shell.getByRole('button', { name: /^Workspace / }).count();
      }
    } catch {
      // A shell that loads or closes tells nothing yet.
    }
  }
  return -1;
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

/** The color that a token of the shell gives, as the shell computes colors. */
function tokenColor(shell: Page, token: string): Promise<string> {
  return shell.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

/**
 * Which of some functions the browser process has loaded, as its inspector finds them in the
 * scripts of the browser process that it parsed; the bundles keep the names of functions.
 */
function loadedFunctions(browser: Browser, names: readonly string[]): Promise<string[]> {
  return browser.main.evaluate(async (_electron, wanted) => {
    const { Session } = process.getBuiltinModule('node:inspector');
    const inspector = new Session();
    const scripts: string[] = [];
    inspector.on('Debugger.scriptParsed', ({ params }) => {
      if (params.url.includes('/out/main/')) scripts.push(params.scriptId);
    });
    inspector.connect();
    const post = (method: string, params?: object): Promise<object | undefined> =>
      new Promise((done, fail) => {
        inspector.post(method, params, (error, result) => {
          if (error === null) done(result);
          else fail(error);
        });
      });
    try {
      await post('Debugger.enable');
      const sources = await Promise.all(
        scripts.map(async (scriptId) =>
          String(
            Reflect.get(
              (await post('Debugger.getScriptSource', { scriptId })) ?? {},
              'scriptSource',
            ),
          ),
        ),
      );
      return wanted.filter((name) =>
        sources.some((source) => source.includes(`function ${name}(`)),
      );
    } finally {
      await post('Debugger.disable');
      inspector.disconnect();
    }
  }, names);
}

/** Notes in a page the keys that reach it, by their place on the keyboard, without modifiers. */
async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    Reflect.set(window, 'keys', seen);
    addEventListener(
      'keydown',
      (event) => {
        if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) seen.push(event.code);
      },
      true,
    );
  });
}

/** The keys that reached a page since {@link recordKeys}. */
function keysOf(page: Page): Promise<unknown> {
  return page.evaluate(() => Reflect.get(window, 'keys'));
}

/** The folder of the partition of a workspace in a profile, as the session of a page names it. */
function partitionPath(id: string): RegExp {
  return new RegExp(`[\\\\/]Partitions[\\\\/]ws-${id}$`);
}

/** Where the session of the page at an address keeps its data, or `null` for none on disk. */
function storageOf(browser: Browser, url: string): Promise<string | null | undefined> {
  return browser.main.evaluate(
    ({ webContents }, address) =>
      webContents.getAllWebContents().find((contents) => contents.getURL() === address)?.session
        .storagePath,
    url,
  );
}

test('creates a workspace, switches between workspaces with the list and the shortcuts, and keeps every page alive', async () => {
  const browser = await launch();
  try {
    const home = await open(browser, fixture('index.html'));
    await home.evaluate(() => Reflect.set(window, 'kept', 'home'));
    // The button at the start of the tabs names the workspace that shows.
    await expect(workspaceButton(browser.shell, 'Default')).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    let dialog = await openList(browser);
    await expect(row(dialog, 'Default')).toHaveAttribute('aria-current', 'true');
    await expect(row(dialog, 'Default')).toContainText('Tabs: 1');
    await expect(row(dialog, 'Default')).toContainText(mac ? '⌃1' : 'Alt+1');
    // The list opens at the start of its button, below it, once it moved into its place.
    await expect.poll(() => dialog.evaluate((element) => element.getAnimations().length)).toBe(0);
    const button = await workspaceButton(browser.shell, 'Default').boundingBox();
    const list = await dialog.boundingBox();
    if (button === null || list === null) throw new Error('Nothing shows');
    expect(Math.abs(list.x - button.x)).toBeLessThan(12);
    expect(list.y).toBeGreaterThanOrEqual(button.y + button.height - 1);
    // A new workspace gets a name, an icon and a color, and the window shows it at once.
    await dialog.getByRole('button', { name: 'New workspace' }).click();
    const field = dialog.getByRole('textbox', { name: 'Name' });
    await expect(field).toBeFocused();
    await field.fill('Work');
    await dialog.getByRole('radio', { name: 'Briefcase' }).check();
    await dialog.getByRole('radio', { name: 'Teal' }).check();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(workspaceButton(browser.shell, 'Work')).toHaveAttribute('data-color', 'teal');
    // The button shows the briefcase in teal.
    const icon = workspaceButton(browser.shell, 'Work').locator('svg');
    await expect(icon.locator('rect[width="20"][height="14"]')).toHaveCount(1);
    expect(await icon.evaluate((svg) => getComputedStyle(svg).color)).toBe(
      await tokenColor(browser.shell, '--swatch-teal'),
    );
    await expect(
      browser.shell.getByRole('status').filter({ hasText: 'Workspace Work' }),
    ).toHaveCount(1);
    await newTabShown(browser, 1);
    const second = await open(browser, fixture('second.html'));
    await second.evaluate(() => Reflect.set(window, 'kept', 'second'));
    // The shortcut of the first workspace shows it again, also from a page.
    await pressWorkspace(browser, 1, fixture('second.html'));
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home']);
    await expect
      .poll(async () => (await tabViews(browser)).map((view) => view.url))
      .toEqual([fixture('index.html')]);
    await pressWorkspace(browser, 2);
    await expect(workspaceButton(browser.shell, 'Work')).toBeVisible();
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture second']);
    // A workspace that is not there does nothing.
    await pressWorkspace(browser, 3);
    // The list shows the tabs of each workspace and switches too.
    dialog = await openList(browser);
    await expect(row(dialog, 'Work')).toHaveAttribute('aria-current', 'true');
    await expect(row(dialog, 'Default')).toContainText('Tabs: 1');
    await expect(row(dialog, 'Work')).toContainText(mac ? '⌃2' : 'Alt+2');
    await row(dialog, 'Default').click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home']);
    // Every page stayed alive the whole time: none of them loaded again.
    expect(await kept(home)).toBe('home');
    expect(await kept(second)).toBe('second');
    expect((await fixturePages(browser)).toSorted()).toEqual(
      [fixture('index.html'), fixture('second.html')].toSorted(),
    );
  } finally {
    await browser.close();
  }
});

test('takes the problem off a tab of a hidden workspace once its page goes on there', async () => {
  const browser = await launch();
  const url = fixture('index.html');
  const next = fixture('second.html');
  /** Ends the page that shows an address, or loads another address in it. */
  const onPage = (address: string, load?: string): Promise<void> =>
    browser.main.evaluate(
      ({ webContents }, { shown, target }) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) => candidate.getURL() === shown);
        if (contents === undefined) throw new Error(`No page shows ${shown}`);
        if (target !== null) {
          void contents.loadURL(target);
          return;
        }
        contents.once('render-process-gone', () => {
          Object.assign(globalThis, { hiddenPageGone: true });
        });
        // As in problems.spec.ts, the test ends the process of the page at once.
        process.kill(contents.getOSProcessId(), 'SIGKILL');
      },
      { shown: address, target: load ?? null },
    );
  try {
    await open(browser, url);
    await createWorkspace(browser, 'Work');
    // The page of the tab of the default workspace, which no longer shows, crashes, and then
    // loads another page while its workspace stays hidden, as a page that goes on by itself.
    await onPage(url);
    await expect
      .poll(() => browser.main.evaluate(() => Reflect.get(globalThis, 'hiddenPageGone')))
      .toBe(true);
    await onPage(url, next);
    await waitForPage(browser, (current) => current === next);
    // Back in its workspace, the tab shows that page, not the problem of the page before.
    await pressWorkspace(browser, 1);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture second']);
    expect((await shellState(browser.shell)).tabs[0]?.problem).toBe(null);
    await expect(browser.shell.getByRole('region', { name: 'This page crashed' })).toBeHidden();
    await expect
      .poll(async () => (await tabViews(browser)).find((view) => view.url === next)?.visible)
      .toBe(true);
  } finally {
    await browser.close();
  }
});

test('opens new windows and links in the workspace of their window, and brings every workspace back after a restart', async () => {
  const first = await launch();
  let closed = false;
  try {
    await open(first, fixture('index.html'));
    await createWorkspace(first, 'Work');
    await open(first, fixture('second.html'));
    // A link from another app opens in the workspace that the window shows.
    expect(await startAgain(first, ['--', fixture('opened.html')])).toBe(0);
    await expect.poll(() => titles(first.shell)).toEqual(['Fixture second', 'Fixture opened']);
    // A new window shows the workspace of the window that it came from.
    await pressNative(first, 'N', ['primary']);
    const other = await otherShell(first);
    await expect(workspaceButton(other, 'Work')).toBeVisible();
    await newTabShown(first, 1, other);
    // A private window has no workspaces.
    await pressNative(first, 'N', ['primary', 'shift']);
    await expect.poll(() => privateButtons(first)).toBe(0);
    await first.main.evaluate(({ BaseWindow }) => {
      for (const window of BaseWindow.getAllWindows()) if (window.id !== 1) window.close();
    });
    await expect
      .poll(() => first.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length))
      .toBe(1);
    // The session keeps the tabs workspace by workspace, and the window comes back with the one
    // that it showed; only its active tab loads.
    closed = true;
    await first.close({ keepProfile: true });
    const second = await launch([], { profile: first.profile });
    try {
      await expect(workspaceButton(second.shell, 'Work')).toBeVisible();
      await expect.poll(() => titles(second.shell)).toEqual(['Fixture second', 'Fixture opened']);
      await expect.poll(() => fixturePages(second)).toEqual([fixture('opened.html')]);
      await pressWorkspace(second, 1);
      await expect(workspaceButton(second.shell, 'Default')).toBeVisible();
      await expect.poll(() => titles(second.shell)).toEqual(['Fixture home']);
      await expect.poll(async () => (await fixturePages(second)).length).toBe(2);
    } finally {
      await second.close();
    }
  } finally {
    if (!closed) await first.close();
  }
});

test('moves a tab to another workspace from its menu, and renames, reorders and deletes workspaces', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await open(browser, fixture('index.html'));
    await createWorkspace(browser, 'Work');
    await pressWorkspace(browser, 1);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    const second = await openInNewTab(browser, fixture('second.html'), 2);
    await second.evaluate(() => Reflect.set(window, 'kept', 'second'));
    // The menu of a tab moves it into another workspace, where it keeps its page.
    await menuOf(browser, 'Fixture second');
    expect(await lastMenu(browser)).toContain(moveItem);
    expect(await submenuOf(browser, moveItem)).toEqual(['Work']);
    await chooseMenuItem(browser, [moveItem, 'Work']);
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home']);
    await pressWorkspace(browser, 2);
    await expect.poll(() => titles(browser.shell)).toEqual(['New tab', 'Fixture second']);
    expect(await kept(second)).toBe('second');
    // Renamed in its form, a workspace keeps its tabs.
    let dialog = await openList(browser);
    await dialog.getByRole('button', { name: 'Edit Work' }).click();
    const field = dialog.getByRole('textbox', { name: 'Name' });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue('Work');
    await field.fill('Projects');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(row(dialog, 'Projects')).toBeVisible();
    await expect(workspaceButton(browser.shell, 'Projects')).toBeVisible();
    // Moved up, it takes the first shortcut.
    await dialog.getByRole('button', { name: 'Edit Projects' }).click();
    await expect(dialog.getByRole('button', { name: 'Move up' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Move down' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Move up' }).click();
    await expect(dialog.getByRole('button', { name: 'Move up' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog.locator('.row .name')).toHaveText(['Projects', 'Default']);
    await overlayPage(browser).then((overlay) => overlay.keyboard.press('Escape'));
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await pressWorkspace(browser, 2);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await pressWorkspace(browser, 1);
    await expect(workspaceButton(browser.shell, 'Projects')).toBeVisible();
    await pressWorkspace(browser, 2);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    // A second window shows Projects with a page, and this one the default workspace.
    await pressWorkspace(browser, 1);
    await expect(workspaceButton(browser.shell, 'Projects')).toBeVisible();
    await pressNative(browser, 'N', ['primary']);
    const other = await otherShell(browser);
    await expect(workspaceButton(other, 'Projects')).toBeVisible();
    await newTabShown(browser, 1, other);
    await open(browser, fixture('opened.html'), other);
    dialog = await openList(browser);
    await row(dialog, 'Default').click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    // Deleted after a question, its tabs close in every window, and a window that showed it
    // shows the default workspace; the list stays for the other workspaces.
    dialog = await openList(browser);
    await dialog.getByRole('button', { name: 'Edit Projects' }).click();
    await dialog.getByRole('button', { name: 'Delete workspace…' }).click();
    await expect(dialog).toContainText('Delete “Projects”? Its tabs close in every window.');
    // The question starts at Cancel, which goes back to the form.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog.locator('.row .name')).toHaveText(['Default']);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await expect(workspaceButton(other, 'Default')).toBeVisible();
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home']);
    await expect.poll(() => titles(other)).toEqual(['New tab']);
    await expect.poll(() => fixturePages(browser)).toEqual([fixture('index.html')]);
    // Without another workspace, the menu of a tab has no item to move it.
    await overlayPage(browser).then((overlay) => overlay.keyboard.press('Escape'));
    await menuOf(browser, 'Fixture home');
    expect((await lastMenu(browser)).map((item) => item.replaceAll('&', ''))).not.toContain(
      moveItem,
    );
  } finally {
    await browser.close();
  }
});

test('keeps the cookies of an isolated workspace apart, also after a restart, moves a tab into it as a new page and deletes its data with it', async () => {
  const first = await launch();
  let closed = false;
  try {
    await recordMenus(first);
    const home = await open(first, fixture('index.html'));
    await home.evaluate(() => {
      document.cookie = 'shared=1; max-age=3600';
    });
    await createWorkspace(first, 'Bank', { icon: 'Heart', color: 'Red', isolated: true });
    const id = await workspaceId(first, 'Bank');
    const bank = await open(first, fixture('second.html'));
    // The sites of the workspace see none of the cookies of the others, and the other way round.
    expect(await bank.evaluate(() => document.cookie)).toBe('');
    await bank.evaluate(() => {
      document.cookie = 'bank=1; max-age=3600';
    });
    const folder = join(first.profile, 'data', 'Partitions', `ws-${id}`);
    await expect.poll(() => existsSync(folder)).toBe(true);
    const dialog = await openList(first);
    await expect(row(dialog, 'Bank')).toContainText('Own cookies');
    await row(dialog, 'Default').click();
    await expect(workspaceButton(first.shell, 'Default')).toBeVisible();
    expect(await home.evaluate(() => document.cookie)).toBe('shared=1');
    // Moved into the workspace, a tab loads its page again in the partition of the workspace.
    const opened = await openInNewTab(first, fixture('opened.html'), 2);
    await opened.evaluate(() => Reflect.set(window, 'kept', 'opened'));
    await menuOf(first, 'Fixture opened');
    expect(await submenuOf(first, moveItem)).toEqual([`Bank ${reloads}`]);
    await chooseMenuItem(first, [moveItem, `Bank ${reloads}`]);
    await expect.poll(() => titles(first.shell)).toEqual(['Fixture home']);
    await pressWorkspace(first, 2);
    await expect(workspaceButton(first.shell, 'Bank')).toBeVisible();
    await expect.poll(() => titles(first.shell)).toEqual(['Fixture second', 'Fixture opened']);
    await tab(first, 'Fixture opened').click();
    const moved = await waitForPage(first, (url) => url === fixture('opened.html'));
    await expect.poll(() => moved.evaluate(() => document.cookie)).toBe('bank=1');
    expect(await moved.evaluate(() => Reflect.get(window, 'kept'))).toBeUndefined();
    expect(await storageOf(first, fixture('opened.html'))).toMatch(partitionPath(id));
    // It keeps the entries of its back and forward history, such as the new tab page before.
    const back = async (): Promise<boolean | undefined> =>
      (await shellState(first.shell)).tabs.find((one) => one.title === 'Fixture opened')?.canGoBack;
    await expect.poll(back).toBe(true);
    // After a restart, the tabs of the workspace load in its partition again.
    closed = true;
    await first.close({ keepProfile: true });
    const second = await launch([], { profile: first.profile });
    try {
      await expect(workspaceButton(second.shell, 'Bank')).toBeVisible();
      const again = await waitForPage(second, (url) => url === fixture('opened.html'));
      await expect.poll(() => again.evaluate(() => document.cookie)).toBe('bank=1');
      // Deleted, the workspace takes its cookies along, and the window shows the default one.
      const list = await openList(second);
      await list.getByRole('button', { name: 'Edit Bank' }).click();
      await expect(list).toContainText('Keeps its cookies and sign-ins apart.');
      await list.getByRole('button', { name: 'Delete workspace…' }).click();
      await expect(list).toContainText('Its cookies, site data and sign-ins are deleted too.');
      await list.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(workspaceButton(second.shell, 'Default')).toBeVisible();
      await expect.poll(() => titles(second.shell)).toEqual(['Fixture home']);
      await expect
        .poll(() =>
          second.main.evaluate(
            async ({ session }, partition) =>
              (await session.fromPartition(partition).cookies.get({})).length,
            `persist:ws-${id}`,
          ),
        )
        .toBe(0);
      const shared = await waitForPage(second, (url) => url === fixture('index.html'));
      await expect.poll(() => shared.evaluate(() => document.cookie)).toBe('shared=1');
    } finally {
      await second.close({ keepProfile: true });
    }
    // Its folder goes once the browser starts again.
    const third = await launch([], { profile: first.profile });
    try {
      await expect.poll(() => existsSync(folder)).toBe(false);
      expect(existsSync(join(first.profile, 'data', 'Partitions'))).toBe(true);
    } finally {
      await third.close();
    }
  } finally {
    if (!closed) await first.close();
  }
});

test('moves a dragged tab to the workspace on whose target it is dropped', async () => {
  const browser = await launch();
  try {
    await open(browser, fixture('index.html'));
    await createWorkspace(browser, 'Work');
    await createWorkspace(browser, 'Bank', { isolated: true });
    await pressWorkspace(browser, 1);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await openInNewTab(browser, fixture('second.html'), 2);
    const box = await tab(browser, 'Fixture second').boundingBox();
    const button = await workspaceButton(browser.shell, 'Default').boundingBox();
    if (box === null || button === null) throw new Error('Nothing shows');
    const { mouse } = browser.shell;
    await mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await mouse.down();
    await mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2, { steps: 4 });
    // Pointing at the button of the workspaces shows a target for each other workspace, with a
    // hint where the tab loads again.
    await mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 8 });
    const drops = browser.shell.locator('.drops');
    await expect(drops).toBeVisible();
    await expect(drops).toHaveCSS('animation-name', 'drops-in');
    await expect(drops.locator('.drop')).toHaveText([
      'Move to “Work”',
      'Move to “Bank”. The tab loads again.',
    ]);
    const target = await drops.locator('.drop').first().boundingBox();
    if (target === null) throw new Error('The target does not show');
    await mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await expect(drops.locator('.drop').first()).toHaveAttribute('data-over', '');
    await mouse.up();
    await expect(drops).toHaveCount(0);
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home']);
    await pressWorkspace(browser, 2);
    await expect(workspaceButton(browser.shell, 'Work')).toBeVisible();
    await expect.poll(() => titles(browser.shell)).toEqual(['New tab', 'Fixture second']);
    // A drag that leaves the button hides the targets, and the tab stays where it was dropped.
    await tab(browser, 'Fixture second').click();
    const again = await tab(browser, 'Fixture second').boundingBox();
    const work = await workspaceButton(browser.shell, 'Work').boundingBox();
    if (again === null || work === null) throw new Error('Nothing shows');
    await mouse.move(again.x + again.width / 2, again.y + again.height / 2);
    await mouse.down();
    await mouse.move(work.x + work.width / 2, work.y + work.height / 2, { steps: 8 });
    await expect(drops).toBeVisible();
    // The targets lie over the start of the tabs; below the strip, the pointer leaves them.
    await mouse.move(again.x + again.width / 2, again.y + again.height + 120, { steps: 8 });
    await expect(drops).toHaveCount(0);
    await mouse.up();
    await expect.poll(() => titles(browser.shell)).toEqual(['New tab', 'Fixture second']);
  } finally {
    await browser.close();
  }
});

test('shows the tabs of every workspace together when workspaces are off', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await open(browser, fixture('index.html'));
    await createWorkspace(browser, 'Work');
    await open(browser, fixture('second.html'));
    await pressWorkspace(browser, 1);
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await newTabShown(browser, 2);
    const settings = await open(browser, 'app://settings/#workspaces.enabled');
    const toggle = settings.getByRole('switch', { name: /^Workspaces/ });
    await expect(toggle).toBeChecked();
    // Off, the window shows the tabs of every workspace together, those of the default first.
    await toggle.uncheck();
    await expect
      .poll(() => titles(browser.shell))
      .toEqual(['Fixture home', 'Settings', 'Fixture second']);
    await expect(browser.shell.getByRole('button', { name: /^Workspace / })).toHaveCount(0);
    expect((await shellState(browser.shell)).workspace).toBeNull();
    // The shortcuts of the workspaces do nothing, and the tab menu has no item to move a tab.
    await pressWorkspace(browser, 2);
    await menuOf(browser, 'Fixture second');
    expect((await lastMenu(browser)).map((item) => item.replaceAll('&', ''))).not.toContain(
      moveItem,
    );
    await expect
      .poll(() => titles(browser.shell))
      .toEqual(['Fixture home', 'Settings', 'Fixture second']);
    // On again, every tab stays in the default workspace, and the other one comes back empty.
    await toggle.check();
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    expect(await titles(browser.shell)).toEqual(['Fixture home', 'Settings', 'Fixture second']);
    const dialog = await openList(browser);
    await expect(row(dialog, 'Work')).toContainText('Tabs: 0');
  } finally {
    await browser.close();
  }
});

test('shows the tabs of every workspace together once workspaces are turned off after a restart', async () => {
  const first = await launch();
  let closed = false;
  try {
    await open(first, fixture('index.html'));
    await createWorkspace(first, 'Work');
    await open(first, fixture('second.html'));
    closed = true;
    await first.close({ keepProfile: true });
    // The window comes back with the workspace that it showed, and nothing has used the code of
    // the workspaces since the start.
    const second = await launch([], { profile: first.profile });
    try {
      await expect(workspaceButton(second.shell, 'Work')).toBeVisible();
      await expect.poll(() => titles(second.shell)).toEqual(['Fixture second']);
      await second.shell.getByRole('button', { name: 'New tab' }).click();
      await newTabShown(second, 2);
      const settings = await open(second, 'app://settings/#workspaces.enabled');
      expect(await loadedFunctions(second, ['applyWorkspaces'])).toEqual([]);
      // Turned off, the window shows the tabs of all its workspaces at once, those of the
      // default workspace first.
      await settings.getByRole('switch', { name: /^Workspaces/ }).uncheck();
      await expect
        .poll(() => titles(second.shell))
        .toEqual(['Fixture home', 'Fixture second', 'Settings']);
      await expect(second.shell.getByRole('button', { name: /^Workspace / })).toHaveCount(0);
      await expect(tab(second, 'Settings')).toHaveAttribute('aria-selected', 'true');
    } finally {
      await second.close();
    }
  } finally {
    if (!closed) await first.close();
  }
});

test('opens the partition of an isolated workspace only on the way to its tabs, not for icons', async () => {
  const first = await launch();
  let closed = false;
  try {
    await open(first, fixture('index.html'));
    await createWorkspace(first, 'Bank', { isolated: true });
    const id = await workspaceId(first, 'Bank');
    const bank = await open(first, fixture('second.html'));
    await bank.evaluate(() => {
      document.cookie = 'bank=1; max-age=3600';
    });
    await pressWorkspace(first, 1);
    await expect(workspaceButton(first.shell, 'Default')).toBeVisible();
    closed = true;
    await first.close({ keepProfile: true });
    const second = await launch([], { profile: first.profile });
    try {
      await expect(workspaceButton(second.shell, 'Default')).toBeVisible();
      // From here on, the test notes the sessions that the browser opens.
      await second.main.evaluate(({ app }) => {
        const opened: (string | null)[] = [];
        Reflect.set(globalThis, 'openedSessions', opened);
        app.on('session-created', (created) => opened.push(created.storagePath));
      });
      const opened = (): Promise<string[]> =>
        second.main.evaluate(() =>
          (Reflect.get(globalThis, 'openedSessions') as (string | null)[]).map(String),
        );
      // A page with an icon shows it in its tab, from the session of its own workspace.
      await second.shell.getByRole('button', { name: 'New tab' }).click();
      await newTabShown(second, 2);
      await open(second, fixture('icon.html'));
      await expect(tab(second, 'Page with an icon').locator('.favicon img')).toHaveAttribute(
        'src',
        /^data:image\/png;base64,/,
      );
      expect(await opened()).toEqual([]);
      // The partition of the workspace opens with its first tab that shows.
      await pressWorkspace(second, 2);
      const again = await waitForPage(second, (url) => url === fixture('second.html'));
      await expect.poll(() => again.evaluate(() => document.cookie)).toBe('bank=1');
      expect((await opened()).filter((path) => partitionPath(id).test(path))).toHaveLength(1);
    } finally {
      await second.close();
    }
  } finally {
    if (!closed) await first.close();
  }
});

test('leaves the keys of the workspaces to the pages of private windows and popups', async () => {
  const browser = await launch();
  try {
    // A regular window takes the shortcut of the first workspace: its page gets only the key
    // that follows.
    const opener = await open(browser, fixture('opener.html'));
    await focusPage(browser, opener);
    await recordKeys(opener);
    await pressWorkspace(browser, 1, fixture('opener.html'));
    await pressNative(browser, 'X', [], fixture('opener.html'));
    await expect.poll(() => keysOf(opener)).toEqual(['KeyX']);
    // A private window has no workspaces, so its page gets the shortcut.
    await pressNative(browser, 'N', ['primary', 'shift']);
    const shell = await otherShell(browser);
    await expect.poll(async () => (await shellState(shell)).private).toBe(true);
    const page = await open(browser, fixture('keys.html'), shell);
    await recordKeys(page);
    await pressWorkspace(browser, 1, fixture('keys.html'));
    await expect.poll(() => keysOf(page)).toEqual(['Digit1']);
    // Neither has a popup.
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    const popup = await waitForPage(browser, (url) => url === fixture('opened.html'));
    await recordKeys(popup);
    await pressWorkspace(browser, 2, fixture('opened.html'));
    await expect.poll(() => keysOf(popup)).toEqual(['Digit2']);
  } finally {
    await browser.close();
  }
});

test('goes back and forward with Alt and the arrows of the number pad while Num Lock is off', async () => {
  test.skip(mac, 'macOS goes back and forward with Command and the brackets');
  const browser = await launch();
  try {
    const home = await open(browser, fixture('index.html'));
    await home.click('#second');
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture second']);
    // Without Num Lock, the 4 and the 6 of the number pad are arrows. No input event of a test
    // has such a key, so the test hands the page's view the key as the system reports it.
    const pad = (url: string, key: string, code: string): Promise<void> =>
      browser.main.evaluate(
        ({ webContents }, sent) => {
          const view = webContents.getAllWebContents().find((one) => one.getURL() === sent.url);
          if (view === undefined) throw new Error(`No page at ${sent.url}`);
          view.emit(
            'before-input-event',
            { preventDefault: () => undefined },
            {
              type: 'keyDown',
              key: sent.key,
              code: sent.code,
              isAutoRepeat: false,
              isComposing: false,
              location: 3,
              modifiers: ['alt'],
              shift: false,
              control: false,
              alt: true,
              meta: false,
            },
          );
        },
        { url, key, code },
      );
    await pad(fixture('second.html'), 'ArrowLeft', 'Numpad4');
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home']);
    await waitForPage(browser, (url) => url === fixture('index.html'));
    await pad(fixture('index.html'), 'ArrowRight', 'Numpad6');
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture second']);
  } finally {
    await browser.close();
  }
});

test('loads the code of workspaces only for a window with another workspace, and shows a tab of one that a suggestion names', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await open(browser, fixture('index.html'));
    const code = ['applyWorkspaces', 'mergeWorkspaces', 'editGroups'];
    // A suggestion of an open tab, tab search and the menu of a tab need none of it, and the
    // menu needs only the code of groups.
    await browser.shell.getByRole('button', { name: 'New tab' }).click();
    await newTabShown(browser, 2);
    await addressBar(browser).pressSequentially('fixture home');
    const suggestions = (await overlayPage(browser)).getByRole('listbox', { name: 'Suggestions' });
    await suggestions.getByRole('option', { name: /Fixture home.*Switch to this tab/ }).click();
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'Fixture home',
    );
    await pressNative(browser, 'A', ['primary', 'shift']);
    const search = (await overlayPage(browser)).getByRole('dialog', { name: 'Search tabs' });
    await expect(search.getByRole('combobox')).toBeFocused();
    await search.getByRole('combobox').fill('new tab');
    await expect(search.getByRole('option', { name: /^New tab/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await search.getByRole('combobox').press('Enter');
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    expect(await loadedFunctions(browser, code)).toEqual([]);
    await menuOf(browser, 'Fixture home');
    expect(await loadedFunctions(browser, code)).toEqual(['editGroups']);
    // The list of the workspaces loads it.
    await createWorkspace(browser, 'Work');
    expect(await loadedFunctions(browser, code)).toEqual(code);
    // A suggestion of a tab of another workspace shows that workspace with the tab.
    await addressBar(browser).pressSequentially('fixture home');
    await suggestions.getByRole('option', { name: /Fixture home.*Switch to this tab/ }).click();
    await expect(workspaceButton(browser.shell, 'Default')).toBeVisible();
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'Fixture home',
    );
    await expect.poll(() => titles(browser.shell)).toEqual(['Fixture home', 'New tab']);
  } finally {
    await browser.close();
  }
});

test('keeps what pages of an isolated workspace open in its partition, guards it as the others, and clears its data with theirs', async () => {
  const browser = await launch();
  try {
    await open(browser, fixture('index.html'));
    await createWorkspace(browser, 'Bank', { isolated: true });
    const id = await workspaceId(browser, 'Bank');
    const opener = await open(browser, fixture('opener.html'));
    await opener.evaluate(() => {
      document.cookie = 'bank=1; max-age=3600';
    });
    expect(await storageOf(browser, fixture('opener.html'))).toMatch(partitionPath(id));
    // A popup of a page of the workspace uses its partition, and so does the next tab of the
    // popup, which opens in the window of the workspace, as a popup shows only its page.
    await opener.getByRole('button', { name: 'Open a popup' }).click();
    const popup = await waitForPage(browser, (url) => url === fixture('opened.html'));
    expect(await popup.evaluate(() => document.cookie)).toBe('bank=1');
    expect(await storageOf(browser, fixture('opened.html'))).toMatch(partitionPath(id));
    const popupShell = await otherShell(browser);
    await pressNative(browser, 'T', ['primary'], fixture('opened.html'));
    await newTabShown(browser, 2);
    await expect(popupShell.getByRole('tab')).toHaveCount(0);
    const next = await open(browser, fixture('second.html'));
    expect(await next.evaluate(() => document.cookie)).toBe('bank=1');
    expect(await storageOf(browser, fixture('second.html'))).toMatch(partitionPath(id));
    // The pages below load in the tab of the opener, which leaves that tab as it is.
    await tab(browser, 'Fixture opener').click();
    await expect(tab(browser, 'Fixture opener')).toHaveAttribute('aria-selected', 'true');
    // Its pages are guarded as all others: the content blocker counts what it blocks there, and
    // its pages reach none of the browser's own pages.
    await open(browser, fixture('blocker.html'));
    await expect(
      browser.shell.getByRole('button', { name: 'Content blocker: 2 blocked' }),
    ).toBeVisible();
    const probe = await open(browser, fixture('probe.html'));
    const status = await probe.evaluate(() =>
      fetch('app://settings/').then(
        (response) => response.status,
        () => 'blocked',
      ),
    );
    expect(status).not.toBe(200);
    await probe.evaluate(() => document.getElementById('internal')?.click());
    await probe.waitForTimeout(500);
    expect(probe.url()).toBe(fixture('probe.html'));
    // Clearing the browsing data clears that of the workspace too.
    const settings = await open(browser, 'app://settings/');
    await settings.getByRole('button', { name: 'Clear…' }).click();
    const dialog = settings.getByRole('dialog', { name: 'Clear browsing data' });
    await dialog.getByRole('combobox', { name: 'Time range' }).selectOption('all');
    await dialog.getByRole('button', { name: 'Clear data' }).click();
    await expect(settings.getByRole('status').filter({ hasText: 'cleared' })).toHaveText(
      'The browsing data is cleared.',
    );
    expect(await next.evaluate(() => document.cookie)).toBe('');
    expect(
      await browser.main.evaluate(
        async ({ session }, partition) =>
          (await session.fromPartition(partition).cookies.get({})).length,
        `persist:ws-${id}`,
      ),
    ).toBe(0);
  } finally {
    await browser.close();
  }
});

test('downloads in the partition of an isolated workspace, and tries a download again there', async () => {
  // The download comes in parts with a pause between them, so the test can cancel it.
  const cookies: (string | undefined)[] = [];
  const downloads = createServer((request, response) => {
    if (request.url !== '/large.bin') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Fixture download</title><a href="/large.bin">Large</a>');
      return;
    }
    cookies.push(request.headers.cookie);
    const part = Buffer.alloc(64 * 1024, 7);
    response.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-disposition': 'attachment; filename="large.bin"',
      'content-length': String(part.length * 40),
    });
    let sent = 0;
    const timer = setInterval(() => {
      response.write(part);
      sent += 1;
      if (sent === 40) {
        clearInterval(timer);
        response.end();
      }
    }, 150);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise<void>((done) => downloads.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${String((downloads.address() as AddressInfo).port)}`;
  const folder = mkdtempSync(join(tmpdir(), 'downloads-'));
  const browser = await launch();
  try {
    await browser.main.evaluate(({ app }, path) => app.setPath('downloads', path), folder);
    await createWorkspace(browser, 'Bank', { isolated: true });
    const page = await open(browser, `${origin}/`);
    await page.evaluate(() => {
      document.cookie = 'bank=1; max-age=3600';
    });
    await page.getByRole('link', { name: 'Large' }).click();
    await expect(
      browser.shell.getByRole('button', { name: 'Downloads (1 running)' }),
    ).toBeVisible();
    await pressNative(browser, mac ? 'L' : 'J', mac ? ['primary', 'alt'] : ['primary'], origin);
    const list = (await overlayPage(browser)).getByRole('dialog', { name: 'Downloads' });
    const item = list.getByRole('listitem').first();
    await item.getByRole('button', { name: 'Cancel: large.bin' }).click();
    await expect(item).toContainText('Canceled');
    // Trying again asks with the cookies of the workspace, as the first time.
    await item.getByRole('button', { name: 'Try again: large.bin' }).click();
    await expect.poll(() => cookies).toEqual(['bank=1', 'bank=1']);
    await item.getByRole('button', { name: 'Cancel: large.bin' }).click();
    await expect(item).toContainText('Canceled');
  } finally {
    await browser.close();
    downloads.closeAllConnections();
    await new Promise((done) => downloads.close(done));
    rmSync(folder, { recursive: true, force: true });
  }
});
