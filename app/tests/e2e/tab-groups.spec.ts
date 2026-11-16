import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

/** The texts of the items of groups in the tab menu, as they show without access keys. */
const items = mac
  ? {
      addToNewGroup: 'Add to New Group',
      addToGroup: 'Add to Group',
      newGroup: 'New Group',
      remove: 'Remove from Group',
      pin: 'Pin',
    }
  : {
      addToNewGroup: 'Add to new group',
      addToGroup: 'Add to group',
      newGroup: 'New group',
      remove: 'Remove from group',
      pin: 'Pin',
    };

/** The address bar of the shell. */
function addressBar(browser: Browser): Locator {
  return browser.shell.getByRole('textbox', { name: 'Address and search bar' });
}

/** Loads an address in the active tab and gives its page. */
async function open(browser: Browser, url: string): Promise<Page> {
  await addressBar(browser).fill(url);
  await addressBar(browser).press('Enter');
  return waitForPage(browser, (current) => current === url);
}

/** Opens a page in a new tab, once the new tab is the active one. */
async function openInNewTab(browser: Browser, url: string, count: number): Promise<Page> {
  await browser.shell.getByRole('button', { name: 'New tab' }).click();
  await expect(browser.shell.getByRole('tab')).toHaveCount(count);
  await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
    'title',
    'New tab',
  );
  return open(browser, url);
}

/** A window with the fixture pages home, second and opened, in this order, the last one active. */
async function threeTabs(browser: Browser): Promise<void> {
  await open(browser, fixture('index.html'));
  await openInNewTab(browser, fixture('second.html'), 2);
  await openInNewTab(browser, fixture('opened.html'), 3);
  await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
}

/** A tab of the strip by its title. */
function tab(browser: Browser, title: string): Locator {
  return browser.shell.getByRole('tab', { name: title, exact: true });
}

/** Opens the menu of a tab, which the harness records, and waits for it. */
async function menuOf(browser: Browser, title: string): Promise<void> {
  const before = await menuCount(browser);
  await tab(browser, title).click({ button: 'right' });
  await expect.poll(() => menuCount(browser)).toBe(before + 1);
}

/** The items of the tab strip in their order: chips by their names, tabs by their titles. */
function stripOrder(browser: Browser): Promise<string[]> {
  return browser.shell.evaluate(() =>
    [
      ...(document.querySelector('app-shell')?.shadowRoot?.querySelectorAll('.tabs > [data-id]') ??
        []),
    ].map((element) =>
      element.getAttribute('role') === 'tab'
        ? (element.getAttribute('title') ?? '')
        : `chip ${element.getAttribute('aria-label') ?? ''}`,
    ),
  );
}

/** The titles of the tabs of the window with the id of each one's group, or `-`. */
async function groupsOfTabs(browser: Browser): Promise<string[]> {
  const state = await shellState(browser.shell);
  const names = new Map<string, string>();
  return state.tabs.map((one) => {
    const id = one.group?.id;
    if (id !== undefined && !names.has(id)) names.set(id, `g${String(names.size + 1)}`);
    return `${one.title} ${id === undefined ? '-' : (names.get(id) ?? '')}`;
  });
}

/** The color that a token of the shell gives, as the shell computes colors. */
function tokenColor(browser: Browser, token: string): Promise<string> {
  return browser.shell.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
}

/** The width and color of each border of a tab of the strip. */
function bordersOf(
  browser: Browser,
  title: string,
): Promise<{ top: string; bottom: string; start: string; margin: string }> {
  return browser.shell.evaluate((name) => {
    const element = [
      ...(document.querySelector('app-shell')?.shadowRoot?.querySelectorAll('[role="tab"]') ?? []),
    ].find((candidate) => candidate.getAttribute('title') === name);
    if (element === undefined) throw new Error(`No tab ${name}`);
    const style = getComputedStyle(element);
    return {
      top: `${style.borderTopWidth} ${style.borderTopColor}`,
      bottom: `${style.borderBottomWidth} ${style.borderBottomColor}`,
      start: `${style.borderLeftWidth} ${style.borderLeftColor}`,
      margin: style.marginLeft,
    };
  }, title);
}

/** Closes the popover of a group with Escape, and waits until the overlay left the window. */
async function closePopover(browser: Browser): Promise<void> {
  const overlay = await overlayPage(browser);
  await expect(overlay.getByRole('dialog', { name: 'Tab group' })).toBeVisible();
  await overlay.keyboard.press('Escape');
  await expect.poll(() => overlayAttached(browser)).toBe(false);
}

/** Puts a tab in a new group from its menu, and closes the popover that opens for it. */
async function groupNew(browser: Browser, title: string): Promise<void> {
  await menuOf(browser, title);
  await chooseMenuItem(browser, [items.addToNewGroup]);
  await closePopover(browser);
}

/**
 * The texts of the items of a submenu of the last menu that the browser built, as the browser
 * wrote them, `-` for a separator.
 * @param label - The text of the item of the submenu, without the marks of access keys.
 */
function submenuOf(browser: Browser, label: string): Promise<string[]> {
  return browser.main.evaluate((_electron, wanted) => {
    const menus = (globalThis as unknown as { recordedMenus?: { menu: Electron.Menu }[] })
      .recordedMenus;
    const item = menus
      ?.at(-1)
      ?.menu.items.find((each) => each.label.replace(/&(&?)/g, '$1') === wanted);
    return (item?.submenu?.items ?? []).map((each) =>
      each.type === 'separator' ? '-' : each.label,
    );
  }, label);
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

/** The name of the element that has the focus in the shell, such as a chip or a tab. */
function focusInShell(browser: Browser): Promise<string> {
  return browser.shell.evaluate(() => {
    const element = document.querySelector('app-shell')?.shadowRoot?.activeElement;
    return element?.getAttribute('aria-label') ?? element?.tagName ?? '';
  });
}

/** Opens the command palette with its shortcut in a view, once its field has the focus. */
async function openPalette(
  browser: Browser,
  target: string,
): Promise<{ readonly dialog: Locator; readonly field: Locator }> {
  await pressNative(browser, 'K', ['primary'], target);
  const overlay = await overlayPage(browser);
  const dialog = overlay.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  const field = dialog.getByRole('combobox');
  await expect(field).toBeFocused();
  return { dialog, field };
}

/** Changes where the tab strip is on the settings page, in a tab of its own. */
async function stripAt(browser: Browser, settings: Page, position: string): Promise<void> {
  await settings.getByRole('radio', { name: position }).check();
  await expect
    .poll(async () => (await shellState(browser.shell)).tabStrip)
    .toBe(position.toLowerCase());
}

test('puts a tab in a new group from its menu and shows the group at the top, the bottom and both sides', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    // A new group keeps the tab in its place, behind a chip in the first color.
    await menuOf(browser, 'Fixture second');
    await chooseMenuItem(browser, [items.addToNewGroup]);
    await closePopover(browser);
    const chip = browser.shell.getByRole('button', { name: 'Group without a name' });
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(await stripOrder(browser)).toEqual([
      'Fixture home',
      'chip Group without a name',
      'Fixture second',
      'Fixture opened',
    ]);
    const blue = await tokenColor(browser, '--swatch-blue');
    await expect(tab(browser, 'Fixture second')).toHaveAttribute('data-group', /^g/);
    await expect(tab(browser, 'Fixture second')).toHaveAttribute(
      'aria-description',
      'In a group without a name',
    );
    expect((await bordersOf(browser, 'Fixture second')).bottom).toBe(`2px ${blue}`);
    expect((await bordersOf(browser, 'Fixture home')).bottom).not.toContain(blue);
    // Another tab joins the group at its end, from the submenu that names the group by its tab.
    await menuOf(browser, 'Fixture home');
    expect(await lastMenu(browser)).toContain(items.addToGroup);
    await chooseMenuItem(browser, [items.addToGroup, 'Group with “Fixture second”']);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture second g1', 'Fixture home g1', 'Fixture opened -']);
    // A tab that leaves its group goes right after it.
    await menuOf(browser, 'Fixture second');
    await chooseMenuItem(browser, [items.remove]);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home g1', 'Fixture second -', 'Fixture opened -']);
    // A pinned tab is never in a group.
    await menuOf(browser, 'Fixture opened');
    await chooseMenuItem(browser, [items.pin]);
    await menuOf(browser, 'Fixture opened');
    const pinnedMenu = await lastMenu(browser);
    expect(pinnedMenu).not.toContain(items.addToNewGroup);
    expect(pinnedMenu).not.toContain(items.addToGroup);
    expect(pinnedMenu).not.toContain(items.remove);
    // The line follows the strip: the top edge at the bottom of the window.
    const settings = await openInNewTab(browser, 'app://settings/', 4);
    await stripAt(browser, settings, 'Bottom');
    await expect
      .poll(async () => (await bordersOf(browser, 'Fixture home')).top)
      .toBe(`2px ${blue}`);
    expect((await bordersOf(browser, 'Fixture home')).bottom).not.toContain(blue);
    // At either side, the chip is a row before its tabs, which are indented with the line at
    // their start.
    for (const side of ['Left', 'Right']) {
      await stripAt(browser, settings, side);
      await expect
        .poll(async () => (await bordersOf(browser, 'Fixture home')).start)
        .toBe(`2px ${blue}`);
      const borders = await bordersOf(browser, 'Fixture home');
      expect(borders.bottom).not.toContain(blue);
      expect(Number.parseFloat(borders.margin)).toBeGreaterThan(0);
      const row = await chip.boundingBox();
      const first = await tab(browser, 'Fixture home').boundingBox();
      const plain = await tab(browser, 'Fixture second').boundingBox();
      if (row === null || first === null || plain === null) throw new Error('Nothing shows');
      // A full row above the tabs of the group, as wide as a tab outside the group.
      expect(row.y + row.height).toBeLessThanOrEqual(first.y + 1);
      expect(Math.round(row.width)).toBe(Math.round(plain.width));
      expect(first.x).toBeGreaterThan(plain.x);
      await expect(chip.locator('.chevron')).toBeVisible();
    }
  } finally {
    await browser.close();
  }
});

/** How many pages of the fixture server have a view, loaded or loading. */
function loaded(browser: Browser): Promise<number> {
  return browser.main.evaluate(
    ({ webContents }, origin) =>
      webContents.getAllWebContents().filter((contents) => contents.getURL().startsWith(origin))
        .length,
    server.origin,
  );
}

test('brings tab groups back after a restart and loads only the active tab', async () => {
  // A session that this version writes: each tab of a group keeps its group.
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  mkdirSync(join(profile, 'data'), { recursive: true });
  const work = { id: 'g7', name: 'Work', color: 'blue', collapsed: true };
  writeFileSync(
    join(profile, 'data', 'session.json'),
    JSON.stringify({
      version: 1,
      windows: [
        {
          tabs: [
            { url: fixture('index.html'), title: 'Fixture home' },
            { url: fixture('second.html'), title: 'Fixture second', group: work },
            { url: fixture('opened.html'), title: 'Fixture opened', group: work },
          ],
          active: 0,
        },
      ],
    }),
  );
  const first = await launch([], { profile });
  let closed = false;
  try {
    const chip = first.shell.getByRole('button', { name: 'Group Work' });
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(chip).toHaveAttribute('aria-description', 'Tabs: 2');
    expect(await stripOrder(first)).toEqual(['Fixture home', 'chip Group Work']);
    const state = await shellState(first.shell);
    expect(state.tabs.map((one) => [one.title, one.group?.name, one.group?.color])).toEqual([
      ['Fixture home', undefined, undefined],
      ['Fixture second', 'Work', 'blue'],
      ['Fixture opened', 'Work', 'blue'],
    ]);
    // The id of the group is the window's own, and both tabs share it.
    expect(state.tabs[1]?.group?.id).toBe(state.tabs[2]?.group?.id);
    // Only the active tab loads, until a tab of the group shows.
    await expect.poll(() => loaded(first)).toBe(1);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => loaded(first)).toBe(1);
    await tab(first, 'Fixture second').click();
    await expect.poll(() => loaded(first)).toBe(2);
    // The group comes back as the browser left it: open now, with the tab that showed.
    closed = true;
    await first.close({ keepProfile: true });
    const second = await launch([], { profile });
    try {
      const again = second.shell.getByRole('button', { name: 'Group Work' });
      await expect(again).toHaveAttribute('aria-expanded', 'true');
      expect(await stripOrder(second)).toEqual([
        'Fixture home',
        'chip Group Work',
        'Fixture second',
        'Fixture opened',
      ]);
      await expect(tab(second, 'Fixture second')).toHaveAttribute('aria-selected', 'true');
      await expect.poll(() => loaded(second)).toBe(1);
    } finally {
      await second.close();
    }
  } finally {
    if (!closed) await first.close();
  }
});

test('names and colors a group in its popover, and ungroups or closes the group there', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    // The popover of a new group opens at its chip, with its empty name field focused.
    await menuOf(browser, 'Fixture second');
    await chooseMenuItem(browser, [items.addToNewGroup]);
    const overlay = await overlayPage(browser);
    const dialog = overlay.getByRole('dialog', { name: 'Tab group' });
    await expect(dialog).toBeVisible();
    const name = dialog.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await expect(name).toHaveValue('');
    await expect(name).toHaveAttribute('placeholder', 'Name this group');
    // The chip takes the name while it is typed, and the line takes the color at once.
    await name.pressSequentially('Wo');
    await expect(browser.shell.getByRole('button', { name: 'Group Wo' })).toBeVisible();
    await name.pressSequentially('rk');
    const chip = browser.shell.getByRole('button', { name: 'Group Work' });
    await expect(chip).toBeVisible();
    await expect(name).toHaveValue('Work');
    await dialog.getByRole('radio', { name: 'Green' }).check();
    const green = await tokenColor(browser, '--swatch-green');
    await expect
      .poll(async () => (await bordersOf(browser, 'Fixture second')).bottom)
      .toBe(`2px ${green}`);
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // A right click on the chip opens it again, with the group as it is now.
    await chip.click({ button: 'right' });
    await expect(dialog).toBeVisible();
    await expect(name).toHaveValue('Work');
    await expect(dialog.getByRole('radio', { name: 'Green' })).toBeChecked();
    await dialog.getByRole('button', { name: 'New tab in group' }).click();
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    await expect(browser.shell.getByRole('tab')).toHaveCount(4);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home -', 'Fixture second g1', 'New tab g1', 'Fixture opened -']);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    // Ungroup ends the group and keeps the tabs where they are.
    await chip.click({ button: 'right' });
    await dialog.getByRole('button', { name: 'Ungroup' }).click();
    await expect(chip).toBeHidden();
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home -', 'Fixture second -', 'New tab -', 'Fixture opened -']);
    // Close group closes its tabs, which open again as the group they were.
    await menuOf(browser, 'Fixture opened');
    await chooseMenuItem(browser, [items.addToNewGroup]);
    await expect(name).toBeFocused();
    await name.pressSequentially('Later');
    await expect(browser.shell.getByRole('button', { name: 'Group Later' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close group' }).click();
    await expect(browser.shell.getByRole('button', { name: 'Group Later' })).toBeHidden();
    await expect(browser.shell.getByRole('tab')).toHaveCount(3);
    await pressNative(browser, 'T', ['primary', 'shift']);
    await expect(browser.shell.getByRole('button', { name: 'Group Later' })).toBeVisible();
    await expect(browser.shell.getByRole('tab')).toHaveCount(4);
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('data-group', /^g/);
    const reopened = (await shellState(browser.shell)).tabs.find(
      (one) => one.title === 'Fixture opened',
    )?.group;
    expect(reopened?.name).toBe('Later');
    // With the tab strip at the bottom, the popover opens above its chip, inside the window.
    const settings = await openInNewTab(browser, 'app://settings/', 5);
    await stripAt(browser, settings, 'Bottom');
    const later = browser.shell.getByRole('button', { name: 'Group Later' });
    await later.click({ button: 'right' });
    await expect(dialog).toBeVisible();
    // The popover moves 4 px into its place as it opens.
    await expect.poll(() => dialog.evaluate((form) => form.getAnimations().length)).toBe(0);
    const box = await dialog.boundingBox();
    const anchor = await later.boundingBox();
    const height = await overlay.evaluate(() => window.innerHeight);
    if (box === null || anchor === null) throw new Error('Nothing shows');
    expect(box.y + box.height).toBeLessThanOrEqual(anchor.y);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
  } finally {
    await browser.close();
  }
});

test('collapses a group with a click, moves the active tab out of it and opens the group again for a tab inside it', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    await openInNewTab(browser, fixture('opener.html'), 4);
    // The group of second and opened, with opened active.
    await groupNew(browser, 'Fixture second');
    await menuOf(browser, 'Fixture opened');
    await chooseMenuItem(browser, [items.addToGroup, 'Group with “Fixture second”']);
    await tab(browser, 'Fixture opened').click();
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    // A click hides the tabs, shows how many there are, and the next tab becomes active.
    const chip = browser.shell.getByRole('button', { name: 'Group without a name' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(chip).toHaveText('2');
    await expect(tab(browser, 'Fixture second')).toHaveCount(0);
    await expect(tab(browser, 'Fixture opened')).toHaveCount(0);
    await expect(tab(browser, 'Fixture opener')).toHaveAttribute('aria-selected', 'true');
    // The shortcuts that pick a tab by its place skip the hidden tabs.
    await tab(browser, 'Fixture home').click();
    await pressNative(browser, '9', ['primary']);
    await expect(tab(browser, 'Fixture opener')).toHaveAttribute('aria-selected', 'true');
    await pressNative(browser, '1', ['primary']);
    await expect(tab(browser, 'Fixture home')).toHaveAttribute('aria-selected', 'true');
    await pressNative(browser, '2', ['primary']);
    await expect(tab(browser, 'Fixture opener')).toHaveAttribute('aria-selected', 'true');
    // Switching to a hidden tab from the address bar opens its group.
    await addressBar(browser).click();
    await addressBar(browser).pressSequentially('fixture second');
    const overlay = await overlayPage(browser);
    await overlay
      .getByRole('listbox', { name: 'Suggestions' })
      .getByRole('option', { name: /Fixture second.*Switch to this tab/ })
      .click();
    await expect(tab(browser, 'Fixture second')).toHaveAttribute('aria-selected', 'true');
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    // A page of a tab in the group opens its tabs in the group; a new tab goes after it.
    await menuOf(browser, 'Fixture opener');
    await chooseMenuItem(browser, [items.addToGroup, 'Group with “Fixture second”']);
    await tab(browser, 'Fixture opener').click();
    const opener = await waitForPage(browser, (url) => url.endsWith('/opener.html'));
    await opener.locator('#tab').click();
    await expect(tab(browser, 'Fixture opened by a page')).toBeVisible();
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual([
        'Fixture home -',
        'Fixture second g1',
        'Fixture opened g1',
        'Fixture opener g1',
        'Fixture opened by a page g1',
      ]);
    // So does the menu of the page: a link opens in the background, right after the page, and
    // a search for the selected text in front, right after the page too.
    await tab(browser, 'Fixture opener').click();
    await expect(tab(browser, 'Fixture opener')).toHaveAttribute('aria-selected', 'true');
    let menus = await menuCount(browser);
    await opener.click('#link', { button: 'right' });
    await expect.poll(() => menuCount(browser)).toBe(menus + 1);
    await chooseMenuItem(browser, [mac ? 'Open Link in New Tab' : 'Open link in new tab']);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual([
        'Fixture home -',
        'Fixture second g1',
        'Fixture opened g1',
        'Fixture opener g1',
        'Fixture second g1',
        'Fixture opened by a page g1',
      ]);
    await expect(tab(browser, 'Fixture opener')).toHaveAttribute('aria-selected', 'true');
    // Nothing leaves the machine: requests to anything but the fixture server fail.
    await browser.main.evaluate(({ session }) => {
      session.fromPartition('persist:default').webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !details.url.startsWith('http://127.0.0.1:') });
      });
    });
    await opener.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('link') as HTMLElement);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    });
    menus = await menuCount(browser);
    await opener.click('#link', { button: 'right' });
    await expect.poll(() => menuCount(browser)).toBe(menus + 1);
    await chooseMenuItem(browser, ['Search duckduckgo.com for “A link”']);
    // The active tab, the one before it, and whether both are in the same group.
    const searched = async (): Promise<unknown[]> => {
      const state = await shellState(browser.shell);
      const at = state.tabs.findIndex((one) => one.id === state.activeTabId);
      const [before, found] = [state.tabs[at - 1], state.tabs[at]];
      return [found?.url, before?.title, found?.group?.id === before?.group?.id];
    };
    await expect
      .poll(searched)
      .toEqual(['https://duckduckgo.com/?q=A%20link', 'Fixture opener', true]);
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(8);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    await expect.poll(async () => (await groupsOfTabs(browser)).at(-1)).toBe('New tab -');
    // Enter and Space on the focused chip hide and show the tabs.
    await chip.focus();
    await chip.press('Enter');
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await chip.press(' ');
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    // Nothing moves when the system asks for reduced motion.
    await expect
      .poll(async () => (await shellState(browser.shell)).tabs.some((one) => one.loading))
      .toBe(false);
    await browser.shell.emulateMedia({ reducedMotion: 'reduce' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(
      await browser.shell.evaluate(() => [
        document.getAnimations().length,
        document.querySelector('app-shell')?.shadowRoot?.getAnimations().length,
      ]),
    ).toEqual([0, 0]);
  } finally {
    await browser.close();
  }
});

/** Drags a tab of the strip by an offset along the strip, in steps, and drops it. */
async function drag(browser: Browser, title: string, dx: number, dy: number): Promise<void> {
  const box = await tab(browser, title).boundingBox();
  if (box === null) throw new Error(`The tab ${title} does not show`);
  const { mouse } = browser.shell;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await mouse.move(x, y);
  await mouse.down();
  await mouse.move(x + dx, y + dy, { steps: 12 });
  await mouse.up();
  await expect(browser.shell.locator('.tabs')).not.toHaveAttribute('data-dragging', '');
}

test('drags a tab into a group and out of it again, at the top and at a side, and moves it out with the keyboard', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    await openInNewTab(browser, fixture('opener.html'), 4);
    // home, then second and opened in a group, then opener.
    await groupNew(browser, 'Fixture second');
    await menuOf(browser, 'Fixture opened');
    await chooseMenuItem(browser, [items.addToGroup, 'Group with “Fixture second”']);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home -', 'Fixture second g1', 'Fixture opened g1', 'Fixture opener -']);
    // Dropped between two tabs of the group, a tab joins it.
    const width = (await tab(browser, 'Fixture home').boundingBox())?.width ?? 0;
    const second = await tab(browser, 'Fixture second').boundingBox();
    const opened = await tab(browser, 'Fixture opened').boundingBox();
    const home = await tab(browser, 'Fixture home').boundingBox();
    if (second === null || opened === null || home === null) throw new Error('Nothing shows');
    const between = (second.x + second.width + opened.x) / 2;
    await drag(browser, 'Fixture home', between - (home.x + home.width / 2), 0);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture second g1', 'Fixture home g1', 'Fixture opened g1', 'Fixture opener -']);
    // Dragged more than half its width past the end of its group, a tab leaves it in place.
    await drag(browser, 'Fixture opened', width * 0.75, 0);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture second g1', 'Fixture home g1', 'Fixture opened -', 'Fixture opener -']);
    // Not as far, it stays in the group.
    await drag(browser, 'Fixture home', width * 0.3, 0);
    expect(await groupsOfTabs(browser)).toEqual([
      'Fixture second g1',
      'Fixture home g1',
      'Fixture opened -',
      'Fixture opener -',
    ]);
    // At a side, the same along the strip from top to bottom.
    const settings = await openInNewTab(browser, 'app://settings/', 5);
    await stripAt(browser, settings, 'Left');
    await tab(browser, 'Fixture opener').click();
    const height = (await tab(browser, 'Fixture home').boundingBox())?.height ?? 0;
    const row = await tab(browser, 'Fixture opened').boundingBox();
    const last = await tab(browser, 'Fixture home').boundingBox();
    if (row === null || last === null) throw new Error('Nothing shows');
    // Into the group from below, onto its last tab, short of its middle.
    await drag(
      browser,
      'Fixture opened',
      0,
      last.y + last.height / 2 + 6 - (row.y + row.height / 2),
    );
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual([
        'Fixture second g1',
        'Fixture home g1',
        'Fixture opened g1',
        'Fixture opener -',
        'Settings -',
      ]);
    await drag(browser, 'Fixture opened', 0, height * 0.75);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual([
        'Fixture second g1',
        'Fixture home g1',
        'Fixture opened -',
        'Fixture opener -',
        'Settings -',
      ]);
    // On Windows and Linux, the keyboard moves the active tab: the last tab of a group first
    // leaves it in place, then moves on.
    if (!mac) {
      await tab(browser, 'Fixture home').click();
      await pressNative(browser, 'PageDown', ['primary', 'shift']);
      await expect
        .poll(() => groupsOfTabs(browser))
        .toEqual([
          'Fixture second g1',
          'Fixture home -',
          'Fixture opened -',
          'Fixture opener -',
          'Settings -',
        ]);
      await pressNative(browser, 'PageDown', ['primary', 'shift']);
      await expect
        .poll(() => groupsOfTabs(browser))
        .toEqual([
          'Fixture second g1',
          'Fixture opened -',
          'Fixture home -',
          'Fixture opener -',
          'Settings -',
        ]);
      // Back toward the group, it joins the group at its edge first.
      await pressNative(browser, 'PageUp', ['primary', 'shift']);
      await pressNative(browser, 'PageUp', ['primary', 'shift']);
      await expect
        .poll(() => groupsOfTabs(browser))
        .toEqual([
          'Fixture second g1',
          'Fixture home g1',
          'Fixture opened -',
          'Fixture opener -',
          'Settings -',
        ]);
    }
  } finally {
    await browser.close();
  }
});

test('names the groups in the menu of a tab as they are, & included, and by the cut title of their first tab', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    // A group named R&D.
    await menuOf(browser, 'Fixture home');
    await chooseMenuItem(browser, [items.addToNewGroup]);
    const overlay = await overlayPage(browser);
    const name = overlay
      .getByRole('dialog', { name: 'Tab group' })
      .getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await name.pressSequentially('R&D');
    await expect(browser.shell.getByRole('button', { name: 'Group R&D' })).toBeVisible();
    await overlay.keyboard.press('Escape');
    await expect.poll(() => overlayAttached(browser)).toBe(false);
    // A group without a name, whose first tab has a very long title.
    const long = `Long ${'x'.repeat(2000)}`;
    const second = await waitForPage(browser, (url) => url === fixture('second.html'));
    await second.evaluate((title) => {
      document.title = title;
    }, long);
    await expect(tab(browser, long)).toHaveCount(1);
    await menuOf(browser, long);
    await chooseMenuItem(browser, [items.addToGroup, items.newGroup]);
    await closePopover(browser);
    // Each & of a name shows as one on every system, also on macOS, whose menus hide an & as
    // Windows and Linux do; a title shows with its first 300 characters.
    await menuOf(browser, 'Fixture opened');
    expect(await submenuOf(browser, items.addToGroup)).toEqual([
      mac ? 'New Group' : '&New group',
      '-',
      'R&&D',
      `Group with “Long ${'x'.repeat(295)}…”`,
    ]);
    await chooseMenuItem(browser, [items.addToGroup, 'R&D']);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home g1', 'Fixture opened g1', `${long} g2`]);
  } finally {
    await browser.close();
  }
});

test('keeps the keyboard on a chip that hides the active tab, and in the tab strip after the popover that the keyboard asked for in the menu of a tab', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    await focusPage(browser, browser.shell);
    if (mac) {
      // macOS has no context menu key.
      await groupNew(browser, 'Fixture opened');
    } else {
      // The context menu key on the active tab opens its menu, where the keyboard makes a group.
      const before = await menuCount(browser);
      await tab(browser, 'Fixture opened').press('ContextMenu');
      await expect.poll(() => menuCount(browser)).toBe(before + 1);
      await chooseMenuItem(browser, [items.addToNewGroup]);
      const overlay = await overlayPage(browser);
      const name = overlay
        .getByRole('dialog', { name: 'Tab group' })
        .getByRole('textbox', { name: 'Name' });
      await expect(name).toBeFocused();
      await name.pressSequentially('Keys');
      await overlay.keyboard.press('Escape');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      // The focus goes back to the tab in the tab strip, not to its page.
      await expect.poll(() => focused(browser, 'app://shell')).toBe(true);
      expect(await focused(browser, fixture('opened.html'))).toBe(false);
      expect(await focusInShell(browser)).toBe('Fixture opened');
      // So does the popover that the context menu key opens on the chip, back to the chip.
      await browser.shell.getByRole('button', { name: 'Group Keys' }).press('ContextMenu');
      await expect(name).toBeFocused();
      await expect(name).toHaveValue('Keys');
      await overlay.keyboard.press('Escape');
      await expect.poll(() => overlayAttached(browser)).toBe(false);
      await expect.poll(() => focused(browser, 'app://shell')).toBe(true);
      expect(await focused(browser, fixture('opened.html'))).toBe(false);
      expect(await focusInShell(browser)).toBe('Group Keys');
    }
    // Enter on the chip of the group of the active tab hides it, and the tab before the group
    // becomes active; the chip keeps the focus, so that Enter shows the tabs again.
    const chip = browser.shell.locator('.tabs > button.group');
    await expect(chip).toHaveCount(1);
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    await focusPage(browser, browser.shell);
    await chip.focus();
    await chip.press('Enter');
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(browser, 'Fixture second')).toHaveAttribute('aria-selected', 'true');
    expect(await focused(browser, fixture('second.html'))).toBe(false);
    expect(await focused(browser, 'app://shell')).toBe(true);
    expect(await focusInShell(browser)).toBe(await chip.getAttribute('aria-label'));
    await browser.shell.keyboard.press('Enter');
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    // So does Space when the tab after the group, which becomes active, is a new tab page.
    await tab(browser, 'Fixture opened').click();
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    await pressNative(browser, 'T', ['primary']);
    await expect(browser.shell.getByRole('tab')).toHaveCount(4);
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    await expect.poll(async () => (await groupsOfTabs(browser)).at(-1)).toBe('New tab -');
    await tab(browser, 'Fixture opened').click();
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    await focusPage(browser, browser.shell);
    await chip.focus();
    await chip.press(' ');
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    expect(await focused(browser, 'app://shell')).toBe(true);
    expect(await focusInShell(browser)).toBe(await chip.getAttribute('aria-label'));
    await browser.shell.keyboard.press(' ');
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    // A click is no key: the tab that becomes active takes the focus, as after a click on a
    // tab; a new tab page gives it to the address bar.
    await tab(browser, 'Fixture opened').click();
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(browser.shell.getByRole('tab', { selected: true })).toHaveAttribute(
      'title',
      'New tab',
    );
    await expect.poll(() => focusInShell(browser)).toBe('Address and search bar');
  } finally {
    await browser.close();
  }
});

test('offers the commands that go to a tab or move it in the command palette only where they act on groups', async () => {
  const browser = await launch();
  try {
    await recordMenus(browser);
    await threeTabs(browser);
    // second and opened in a group, opened active as the last tab of the strip.
    await groupNew(browser, 'Fixture second');
    await menuOf(browser, 'Fixture opened');
    await chooseMenuItem(browser, [items.addToGroup, 'Group with “Fixture second”']);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home -', 'Fixture second g1', 'Fixture opened g1']);
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    // The last tab of the strip moves to the right out of its group, as its shortcut does.
    const page = await waitForPage(browser, (url) => url === fixture('opened.html'));
    await focusPage(browser, page);
    const right = /^Move the tab to the right/;
    const moving = await openPalette(browser, fixture('opened.html'));
    await moving.field.fill('move the tab');
    await expect(moving.dialog.getByRole('option', { name: right })).toBeVisible();
    await moving.dialog.getByRole('option', { name: right }).click();
    await expect(moving.dialog).toBeHidden();
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture home -', 'Fixture second g1', 'Fixture opened -']);
    // With every other tab in a collapsed group, no command goes to another tab.
    await menuOf(browser, 'Fixture home');
    await chooseMenuItem(browser, [items.addToGroup, 'Group with “Fixture second”']);
    await expect
      .poll(() => groupsOfTabs(browser))
      .toEqual(['Fixture second g1', 'Fixture home g1', 'Fixture opened -']);
    const chip = browser.shell.getByRole('button', { name: 'Group without a name' });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(tab(browser, 'Fixture opened')).toHaveAttribute('aria-selected', 'true');
    await focusPage(browser, page);
    const alone = await openPalette(browser, fixture('opened.html'));
    const web = alone.dialog.getByRole('group', { name: 'Web' }).getByRole('option');
    for (const [typed, command] of [
      ['next tab', /^Next tab/],
      ['previous tab', /^Previous tab/],
      ['second tab', /^Second tab/],
      ['last tab', /^Last tab/],
    ] as const) {
      await alone.field.fill(typed);
      // The results for what was typed show, without the command.
      await expect(web).toHaveAccessibleName(new RegExp(`^Search for “${typed}”`));
      await expect(alone.dialog.getByRole('option', { name: command })).toHaveCount(0);
    }
    await alone.field.fill('first tab');
    await expect(alone.dialog.getByRole('option', { name: /^First tab/ })).toBeVisible();
    await pressNative(browser, 'Escape', [], 'app://overlay');
    await expect(alone.dialog).toBeHidden();
    // Shown again, the group counts its tabs.
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');
    await focusPage(browser, page);
    const again = await openPalette(browser, fixture('opened.html'));
    await again.field.fill('next tab');
    await expect(again.dialog.getByRole('option', { name: /^Next tab/ })).toBeVisible();
  } finally {
    await browser.close();
  }
});
