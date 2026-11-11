import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, pressNative, shellState, waitForPage, type Browser } from './harness.ts';

let browser: Browser;

test.beforeEach(async () => {
  browser = await launch();
});
test.afterEach(async () => {
  await browser.close();
});

async function openSettings(): Promise<Page> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill('app://settings');
  await address.press('Enter');
  return waitForPage(browser, (url) => url.startsWith('app://settings'));
}

/** A design token as a page computes it. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

test('changes the appearance at once in every view', async () => {
  const page = await openSettings();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect
    .poll(() => browser.main.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
    .toBe('dark');
  await page.getByRole('radio', { name: 'Green' }).check();
  await expect
    .poll(() => browser.shell.evaluate(token, '--accent-light'))
    .toBe('oklch(54.8% 0.150 150.0)');
  await page.getByRole('radio', { name: 'Compact' }).check();
  await expect.poll(() => browser.shell.evaluate(token, '--tab-height')).toBe('28px');
  expect(await page.evaluate(token, '--tab-height')).toBe('28px');
  // The page only reaches its own channels.
  const shellCall = await page.evaluate(() =>
    window.bridge.invoke('shell.getState', {}).then(
      () => 'answered',
      () => 'refused',
    ),
  );
  expect(shellCall).toBe('refused');
});

test('tells whether the browser is the default browser and offers to make it one', async () => {
  const page = await openSettings();
  await expect(page.getByText('Links from other apps open in another browser.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make default' })).toBeVisible();
  expect(await page.evaluate(() => window.bridge.invoke('settings.getDefaultBrowser', {}))).toEqual(
    {
      isDefault: false,
      allowed: true,
      supported: true,
    },
  );
});

test('chooses the search engine of the new tab page and the address bar', async () => {
  const page = await openSettings();
  const engine = page.getByRole('combobox', { name: 'Search engine' });
  await engine.selectOption('google');
  await pressNative(browser, 'T', ['primary']);
  const newTab = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
  await expect(
    newTab.getByRole('searchbox', { name: 'Search with Google or enter address' }),
  ).toBeVisible();
  await engine.selectOption('custom');
  const address = page.getByRole('textbox', { name: /Search address/ });
  await address.fill('http://search.example/?q=%s');
  await address.blur();
  await expect(page.getByRole('alert')).toHaveText('Enter an https address that contains %s.');
  await address.fill('https://search.example/?q=%s');
  await address.blur();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.bridge.invoke('settings.getAll', {}))).toMatchObject({
    settings: expect.arrayContaining([
      {
        key: 'search.urlTemplate',
        value: 'https://search.example/?q=%s',
        locked: false,
        changed: true,
        recommended: false,
        restart: false,
      },
    ]),
  });
});

test('opens the settings from the browser menu in place of a new tab page', async () => {
  await browser.main.evaluate(({ Menu }) => {
    const recorded: Electron.Menu[] = [];
    Object.assign(globalThis, { recordedMenus: recorded });
    Menu.prototype.popup = function popup(this: Electron.Menu) {
      recorded.push(this);
    };
  });
  await browser.shell.getByRole('button', { name: 'Menu' }).click();
  await expect
    .poll(() =>
      browser.main.evaluate(() =>
        (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus
          .at(-1)
          ?.items.map((item) => (item.type === 'separator' ? '-' : item.label)),
      ),
    )
    .toEqual(
      process.platform === 'darwin'
        ? [
            'New Tab',
            'New Window',
            'New Private Window',
            '-',
            'History',
            'Downloads',
            'Bookmarks',
            '-',
            'Zoom',
            'Find…',
            'Print…',
            'Save Page As…',
            'More Tools',
            '-',
            'Settings…',
            'About Astela',
            'Quit Astela',
          ]
        : [
            'New &tab',
            'New &window',
            'New pr&ivate window',
            '-',
            '&History',
            '&Downloads',
            '&Bookmarks',
            '-',
            '&Zoom',
            '&Find…',
            '&Print…',
            'Sa&ve page as…',
            'More t&ools',
            '-',
            '&Settings',
            '&About Astela',
            process.platform === 'win32' ? 'E&xit' : '&Quit',
          ],
    );
  await browser.main.evaluate(
    (_electron, label) => {
      const menu = (globalThis as unknown as { recordedMenus: Electron.Menu[] }).recordedMenus.at(
        -1,
      );
      menu?.items.find((item) => item.label === label)?.click();
    },
    process.platform === 'darwin' ? 'Settings…' : '&Settings',
  );
  await waitForPage(browser, (url) => url.startsWith('app://settings'));
  await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  await expect(browser.shell.getByRole('tab', { name: 'Settings' })).toBeVisible();
});

test('finds settings by their words in English and German, and says when none matches', async () => {
  const page = await openSettings();
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  await search.fill('vertical');
  await expect(page.getByRole('radiogroup', { name: 'Tabs' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Color mode' })).toBeHidden();
  // A German word finds the setting on the English page too.
  await search.fill('Seitenleiste');
  await expect(page.getByRole('radiogroup', { name: 'Tabs' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Density' })).toBeHidden();
  await search.fill('zzzz');
  await expect(page.getByRole('status')).toHaveText('No setting matches zzzz.');
  await search.fill('');
  await expect(page.getByRole('radiogroup', { name: 'Color mode' })).toBeVisible();
});

test('opens a setting from its link and marks the section of the page in the navigation', async () => {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill('app://settings/#tabs.position');
  await address.press('Enter');
  const page = await waitForPage(browser, (url) => url.startsWith('app://settings'));
  await expect(page.getByRole('radio', { name: 'Top' })).toBeFocused();
  const sections = page.getByRole('navigation', { name: 'Sections' });
  await sections.getByRole('button', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeInViewport();
  await expect(sections.getByRole('button', { name: 'Privacy' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  // A link to another setting in the same tab goes there, too.
  await page.evaluate(() => {
    location.hash = '#appearance.density';
  });
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeFocused();
});

test('shows the changed settings and resets one or all of them', async () => {
  await browser.close();
  browser = await launch([], {
    settings: { 'tabs.position': 'left', 'appearance.density': 'compact' },
  });
  const page = await openSettings();
  await page.getByRole('button', { name: 'Show changed settings' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Tabs' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Density' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Color mode' })).toBeHidden();
  await page.getByRole('button', { name: 'Reset Tabs' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Tabs' })).toBeHidden();
  await page.getByRole('button', { name: 'Reset all settings…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset all' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No setting differs' })).toHaveText(
    'No setting differs from its default.',
  );
  await page.getByRole('button', { name: 'Show changed settings' }).click();
  await expect(page.getByRole('radio', { name: 'Top' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Normal' })).toBeChecked();
});

test('exports the settings to a file and imports them again', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'settings-file-'));
  const file = join(folder, 'settings.json');
  try {
    await browser.main.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, file);
    const page = await openSettings();
    await page.getByRole('radio', { name: 'Left' }).check();
    await page.getByRole('button', { name: 'Export settings…' }).click();
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(file, 'utf8')) as unknown;
        } catch {
          return undefined;
        }
      })
      .toEqual({ $schemaVersion: 1, settings: { 'tabs.position': 'left' } });
    await page.getByRole('radio', { name: 'Top' }).check();
    await page.getByRole('button', { name: 'Import settings…' }).click();
    await expect(page.getByRole('radio', { name: 'Left' })).toBeChecked();
    await expect(page.getByRole('status').filter({ hasText: 'Imported settings' })).toHaveText(
      'Imported settings: 1',
    );
    // A file that is not a settings file changes nothing.
    writeFileSync(file, '{"tabs.position": "right"}');
    await page.getByRole('button', { name: 'Import settings…' }).click();
    await expect(page.getByRole('alert')).toHaveText('This file holds no settings of Astela.');
    await expect(page.getByRole('radio', { name: 'Left' })).toBeChecked();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('switches the language of the browser with a restart that brings the tabs back', async () => {
  await browser.close();
  // A link that this start opened does not open again after the restart.
  browser = await launch(['--', 'http://127.0.0.1:9/link']);
  const page = await openSettings();
  const language = page.getByRole('combobox', { name: 'Language of the browser' });
  const hint = page.getByRole('status').filter({ hasText: 'after a restart' });
  await language.selectOption('de');
  await expect(hint).toBeVisible();
  await language.selectOption('system');
  await expect(hint).toBeHidden();
  await language.selectOption('de');
  await page.getByRole('radio', { name: 'New tab page' }).check();
  await browser.main.evaluate(({ app }) => {
    const calls: unknown[] = [];
    Reflect.set(globalThis, 'restartCalls', calls);
    const quit = app.quit.bind(app);
    app.relaunch = (options) => {
      calls.push(options?.args);
    };
    app.quit = () => {
      calls.push('quit');
      app.quit = quit;
    };
  });
  await page.getByRole('button', { name: 'Restart now' }).click();
  const calls = (): Promise<unknown> =>
    browser.main.evaluate(() => Reflect.get(globalThis, 'restartCalls') as unknown);
  await expect
    .poll(calls)
    .toEqual([expect.arrayContaining(['--lang=en-US', '--restore-last-session']), 'quit']);
  expect(await calls()).not.toEqual([expect.arrayContaining(['http://127.0.0.1:9/link']), 'quit']);
  expect(await calls()).not.toEqual([expect.arrayContaining(['--']), 'quit']);

  // The browser starts again as the restart starts it: in German, and with the tabs of
  // before, although it starts with a new tab page otherwise.
  const { profile } = browser;
  await browser.close({ keepProfile: true });
  browser = await launch(['--restore-last-session'], { profile });
  await expect(
    browser.shell.getByRole('textbox', { name: 'Adress- und Suchleiste' }),
  ).toBeVisible();
  expect((await shellState(browser.shell)).tabs.map((tab) => tab.url)).toEqual(['app://settings/']);
  const restored = await waitForPage(browser, (url) => url.startsWith('app://settings'));
  await expect(restored.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();
  await expect(restored.getByRole('status').filter({ hasText: 'Neustart' })).toHaveCount(0);
  // The dialogs of the browser speak German too.
  await browser.main.evaluate(({ dialog }) => {
    dialog.showSaveDialog = (...args: unknown[]) => {
      Reflect.set(globalThis, 'dialogTitle', Reflect.get(Object(args.at(-1)), 'title'));
      return Promise.resolve({ canceled: true, filePath: '' });
    };
  });
  await restored.getByRole('button', { name: 'Einstellungen exportieren…' }).click();
  await expect
    .poll(() => browser.main.evaluate(() => Reflect.get(globalThis, 'dialogTitle') as unknown))
    .toBe('Einstellungen exportieren');
});

test('scales the controls with the density, and the text with the text size and the font', async () => {
  const page = await openSettings();
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  const height = (): Promise<string> => address.evaluate((input) => getComputedStyle(input).height);
  expect(await height()).toBe('28px');
  await page.getByRole('radio', { name: 'Compact' }).check();
  await expect.poll(height).toBe('24px');
  await page.getByRole('radio', { name: 'Comfortable' }).check();
  await expect.poll(height).toBe('32px');
  const body = (property: 'fontSize' | 'fontFamily') => () =>
    page.evaluate((name) => getComputedStyle(document.body)[name], property);
  expect(await body('fontSize')()).toBe('13px');
  await page.getByRole('radio', { name: 'Larger' }).check();
  await expect.poll(body('fontSize')).toBe('16px');
  await expect.poll(() => browser.shell.evaluate(token, '--font-size-ui')).toBe('16px');
  const font = page.getByRole('textbox', { name: 'Font of the browser' });
  await font.fill('Inter Display');
  await font.blur();
  await expect.poll(body('fontFamily')).toMatch(/^"Inter Display", /);
  await font.fill('x";} body{color:red');
  await font.blur();
  await expect(page.getByRole('alert')).toHaveText(
    'Use letters, digits, spaces, dots, hyphens and underscores only.',
  );
  await expect.poll(body('fontFamily')).toMatch(/^"Inter Display", /);
});
