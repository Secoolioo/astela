import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FixtureServer,
  launch,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

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

/**
 * Makes the search for other browsers answer late, as the data service often does on Windows:
 * with two profiles, when the page gets its first wheel turn or after 2 seconds. Until then the
 * import section is empty, so the page ends higher.
 */
function answerImportLate(): Promise<void> {
  return browser.main.evaluate(({ app }) => {
    app.on('web-contents-created', (_event, contents) => {
      let answer: (() => void) | undefined;
      const answered = new Promise<void>((done) => {
        answer = done;
      });
      contents.on('input-event', (_input, input) => {
        if (input.type === 'mouseWheel') answer?.();
      });
      contents.ipc.handle('settings.findBrowsers', async () => {
        setTimeout(() => answer?.(), 2000);
        await answered;
        return {
          enabled: true,
          profiles: [
            { id: 'chromium:a', browser: 'Google Chrome', profile: 'Default', tabs: false },
            { id: 'firefox:b', browser: 'Firefox', profile: 'default-release', tabs: true },
          ],
        };
      });
    });
  });
}

/** A design token as a page computes it. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

test('changes the appearance at once in every view', async () => {
  const page = await openSettings();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
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

test('marks the section in view, also below its heading and at the end of the page', async () => {
  await answerImportLate();
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill('app://settings/#privacy.httpsFirst');
  await address.press('Enter');
  const page = await waitForPage(browser, (url) => url.startsWith('app://settings'));
  await expect(page.getByRole('switch', { name: 'Always use secure connections' })).toBeFocused();
  // The link scrolled past the heading of the section, which is still the one in view.
  await expect(page.getByRole('heading', { name: 'Privacy' })).not.toBeInViewport();
  const sections = page.getByRole('navigation', { name: 'Sections' });
  const marked = (name: string) =>
    expect(sections.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-current',
      'true',
    );
  await marked('Privacy');
  // The import section gets its content only when the search for other browsers answers, so
  // the page ends where it does only from then on; the frames after it carry the new layout.
  await expect(page.getByRole('button', { name: 'Import from Google Chrome' })).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      }),
  );
  // The last section is short; at the end of the page it is the one in view.
  await page.mouse.wheel(0, 50_000);
  await marked('Setup');
  await page.mouse.wheel(0, -50_000);
  await marked('Appearance');
  // A section that the navigation shows stays marked, also when it cannot reach the top.
  await sections.getByRole('button', { name: 'Default browser' }).click();
  await marked('Default browser');
});

test('shows the changed settings and resets one or all of them', async () => {
  await browser.close();
  const mac = process.platform === 'darwin';
  browser = await launch([], {
    settings: {
      'tabs.position': 'left',
      'appearance.density': 'compact',
      'keys.shortcuts': { 'tab.new': [mac ? 'Shift+Cmd+K' : 'Ctrl+Shift+K'] },
      'network.secureDns': 'secure',
      'network.secureDnsTemplates': 'https://dns.quad9.net/dns-query',
      // Pages to open at start stay changed while the browser restores its last session.
      'startup.urls': ['https://example.com/'],
    },
  });
  const page = await openSettings();
  await page.getByRole('button', { name: 'Show changed settings' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Tabs' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Density' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Color mode' })).toBeHidden();
  // A shortcut of one's own is a changed setting too.
  await expect(page.getByRole('button', { name: 'Change the shortcut of New tab' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Change the shortcut of New window' }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Reset Tabs' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Tabs' })).toBeHidden();
  // Secure DNS resets with the address of its service.
  const dns = page.getByRole('combobox', { name: 'Use secure DNS' });
  await expect(dns).toHaveValue('https://dns.quad9.net/dns-query');
  await page.getByRole('button', { name: 'Reset Use secure DNS' }).click();
  await expect(dns).toBeHidden();
  // A section of the navigation shows also while only changed settings show.
  const sections = page.getByRole('navigation', { name: 'Sections' });
  await sections.getByRole('button', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy' })).toBeInViewport();
  await expect(dns).toHaveValue('automatic');
  await page.getByRole('button', { name: 'Show changed settings' }).click();
  await page.getByRole('button', { name: 'Reset all settings…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset all' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No setting differs' })).toHaveText(
    'No setting differs from its default.',
  );
  await page.getByRole('button', { name: 'Show changed settings' }).click();
  await expect(page.getByRole('radio', { name: 'Top' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Normal' })).toBeChecked();
  await expect(page.locator('[data-command="tab.new"] kbd')).toHaveText([mac ? '⌘T' : 'Ctrl+T']);
  // The pages to open, which no row showed, are back to none.
  await page.getByRole('radio', { name: 'Specific pages' }).check();
  await expect(page.getByText('None yet. Without pages, the browser starts')).toBeVisible();
});

test('exports the settings to a file and imports them again', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'settings-file-'));
  const file = join(folder, 'settings.json');
  try {
    const page = await openSettings();
    // The folder of downloads belongs to this computer, so the file leaves it out.
    await browser.main.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, folder);
    await page.getByRole('button', { name: 'Change…' }).click();
    await expect(page.getByText(folder, { exact: true })).toBeVisible();
    await browser.main.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, file);
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
      .toEqual({
        $schemaVersion: 1,
        system: process.platform === 'darwin' ? 'macos' : 'pc',
        settings: { 'tabs.position': 'left' },
      });
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
    // The background image of another profile is not in this one, and the shortcuts of
    // another system would mean other keys, so both stay out.
    const mac = process.platform === 'darwin';
    writeFileSync(
      file,
      JSON.stringify({
        $schemaVersion: 1,
        system: mac ? 'pc' : 'macos',
        settings: {
          'tabs.position': 'right',
          'newtab.background': { kind: 'image', file: 'background-0123456789abcdef.png' },
          'keys.shortcuts': { 'tab.new': [mac ? 'Ctrl+Shift+K' : 'Shift+Cmd+K'] },
        },
      }),
    );
    // The page imports at most twice a second.
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Import settings…' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Imported settings' })).toHaveText(
      'Imported settings: 1. Skipped, as your organization manages them or they are not valid here: 2',
    );
    await expect(page.getByRole('radio', { name: 'Right' })).toBeChecked();
    await expect(
      page
        .getByRole('radiogroup', { name: 'Background', exact: true })
        .getByRole('radio', { name: 'None' }),
    ).toBeChecked();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('shows English for a language without a translation, also on a German system', async () => {
  await browser.close();
  browser = await launch(['--lang=de'], { settings: { 'i18n.language': 'fr' } });
  const page = await openSettings();
  // The menus and dialogs are English for French; the pages are too, not German.
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Language of the browser' })).toHaveValue('fr');
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
  // The hint depends on the settings, which the page shows once it has them.
  await expect(restored.locator('html')).toHaveAttribute('data-ready', 'true');
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
  // The address bar has the height of a large control at each density.
  expect(await height()).toBe('32px');
  await page.getByRole('radio', { name: 'Compact' }).check();
  await expect.poll(height).toBe('28px');
  await page.getByRole('radio', { name: 'Comfortable' }).check();
  await expect.poll(height).toBe('40px');
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

test('gives web pages that open after a change the text size and the fonts of the settings', async () => {
  const server = new FixtureServer();
  await server.start();
  try {
    const page = await openSettings();
    await page.getByRole('combobox', { name: 'Text size of web pages' }).selectOption('Very large');
    const standard = page.getByRole('textbox', { name: 'Standard' });
    await standard.fill('DejaVu Serif');
    await standard.blur();
    await expect
      .poll(() => page.evaluate(() => window.bridge.invoke('settings.getAll', {})))
      .toMatchObject({
        settings: expect.arrayContaining([
          expect.objectContaining({ key: 'fonts.size', value: 24 }),
          expect.objectContaining({
            key: 'fonts.web',
            value: { standard: 'DejaVu Serif', serif: '', sansSerif: '', fixed: '' },
          }),
        ]),
      });
    await pressNative(browser, 'T', ['primary']);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    const web = await waitForPage(browser, (url) => url.endsWith('/index.html'));
    const style = await web.evaluate(() => {
      const body = getComputedStyle(document.body);
      return { size: body.fontSize, family: body.fontFamily };
    });
    expect(style).toEqual({ size: '24px', family: '"DejaVu Serif"' });
    // A name that is not one is refused.
    await standard.fill('x";}');
    await standard.blur();
    await expect(page.getByRole('alert')).toHaveText(
      'Use letters, digits, spaces, dots, hyphens and underscores only.',
    );
  } finally {
    await server.stop();
  }
});

test('chooses the pages to open at start and the home page', async () => {
  const page = await openSettings();
  await expect(page.getByRole('textbox', { name: 'Page to add' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Specific pages' }).check();
  const add = page.getByRole('textbox', { name: 'Page to add' });
  await add.fill('example.com');
  await add.press('Enter');
  const list = page.getByRole('list', { name: 'Pages to open' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('https://example.com/');
  await add.fill('not a page');
  await add.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'Enter a web address, such as example.com or https://example.com/page.',
  );
  const home = page.getByRole('textbox', { name: 'Home page' });
  await home.fill('example.org');
  await home.blur();
  await expect
    .poll(() => page.evaluate(() => window.bridge.invoke('settings.getAll', {})))
    .toMatchObject({
      settings: expect.arrayContaining([
        expect.objectContaining({ key: 'startup.page', value: 'pages' }),
        expect.objectContaining({ key: 'startup.urls', value: ['https://example.com/'] }),
        expect.objectContaining({ key: 'home.page', value: 'https://example.org/' }),
      ]),
    });
});

test('chooses the folder of downloads only in the dialog of the system', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'settings-downloads-'));
  try {
    const page = await openSettings();
    await expect(page.getByText('The downloads folder of the system')).toBeVisible();
    await browser.main.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
    }, folder);
    await page.getByRole('button', { name: 'Change…' }).click();
    await expect(page.getByText(folder)).toBeVisible();
    // The page cannot name a folder itself.
    expect(
      await page.evaluate(() =>
        window.bridge.invoke('settings.set', { key: 'downloads.folder', value: '/' }),
      ),
    ).toEqual({ ok: false, error: 'invalid' });
    await page.getByRole('switch', { name: /Ask where to save each file/ }).check();
    await expect
      .poll(() => page.evaluate(() => window.bridge.invoke('settings.getAll', {})))
      .toMatchObject({
        settings: expect.arrayContaining([
          expect.objectContaining({ key: 'downloads.folder', value: folder }),
          expect.objectContaining({ key: 'downloads.ask', value: true }),
        ]),
      });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('adds a search engine with a keyword and makes it the default', async () => {
  const page = await openSettings();
  const field = (name: string) => page.getByRole('textbox', { name, exact: true });
  await field('Name').fill('Example');
  await field('Keyword').fill('@ex');
  await field('Address with %s').fill('https://search.example/?q=%s');
  await page.locator('form.add-engine').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('starts with neither ! nor @');
  await field('Keyword').fill('ex');
  await field('Address with %s').press('Enter');
  const engines = page.getByRole('list', { name: 'Search engines and keywords' });
  await expect(engines.getByRole('listitem').filter({ hasText: 'Example' })).toContainText('ex');
  await page
    .getByRole('combobox', { name: 'Search engine', exact: true })
    .selectOption({ label: 'Example' });
  await expect
    .poll(() => page.evaluate(() => window.bridge.invoke('settings.getAll', {})))
    .toMatchObject({
      settings: expect.arrayContaining([
        expect.objectContaining({
          key: 'search.urlTemplate',
          value: 'https://search.example/?q=%s',
        }),
        expect.objectContaining({
          key: 'search.engines',
          value: [{ name: 'Example', keyword: 'ex', url: 'https://search.example/?q=%s' }],
        }),
      ]),
    });
  await engines.getByRole('button', { name: 'Remove Example' }).click();
  await expect(engines.getByRole('listitem').filter({ hasText: 'Example' })).toHaveCount(0);
});

test('shows, hides and moves the buttons of the toolbar', async () => {
  const page = await openSettings();
  const buttons = (): Promise<string[]> =>
    browser.shell.evaluate(() =>
      [...(document.querySelector('app-shell')?.shadowRoot?.querySelectorAll('nav .icon') ?? [])]
        .map((button) => [...button.classList].find((name) => name !== 'icon') ?? '')
        .filter((name) => name === 'bookmark' || name === 'blocker' || name === 'downloads'),
    );
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await pressNative(browser, 'T', ['primary']);
  await address.fill('http://127.0.0.1:9/');
  await address.press('Enter');
  await expect.poll(buttons).toEqual(['bookmark', 'blocker']);
  await browser.shell.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Move Content blocker to the left' }).click();
  await page.getByRole('checkbox', { name: 'Bookmark star' }).uncheck();
  await expect
    .poll(() => page.evaluate(() => window.bridge.invoke('settings.getAll', {})))
    .toMatchObject({
      settings: expect.arrayContaining([
        expect.objectContaining({ key: 'toolbar.items', value: ['shield', 'downloads'] }),
      ]),
    });
  await page.getByRole('checkbox', { name: 'Bookmark star' }).check();
  await page.getByRole('checkbox', { name: 'Downloads' }).uncheck();
  await browser.shell.getByRole('tab', { name: /127\.0\.0\.1/ }).click();
  await expect.poll(buttons).toEqual(['blocker', 'bookmark']);
  // Without its button, the shortcut opens the list of downloads at the menu.
  await pressNative(
    browser,
    process.platform === 'darwin' ? 'L' : 'J',
    process.platform === 'darwin' ? ['primary', 'alt'] : ['primary'],
  );
  const overlay = await waitForPage(browser, (url) => url.startsWith('app://overlay'));
  await expect(overlay.getByRole('dialog', { name: 'Downloads' })).toBeVisible();
});

test('keeps the focus on a toolbar button while it moves', async () => {
  const page = await openSettings();
  const items = (): Promise<unknown> =>
    page.evaluate(async () => {
      const result = await window.bridge.invoke('settings.getAll', {});
      const settings: unknown[] =
        typeof result === 'object' && result !== null && 'settings' in result
          ? [result.settings].flat()
          : [];
      return settings.find(
        (setting) =>
          typeof setting === 'object' &&
          setting !== null &&
          'key' in setting &&
          setting.key === 'toolbar.items',
      );
    });
  await page.evaluate(() => window.bridge.invoke('settings.reset', { keys: ['toolbar.items'] }));
  await expect.poll(items).toMatchObject({ value: ['bookmark', 'shield', 'downloads'] });
  const rows = page.getByRole('list', { name: 'Toolbar' }).getByRole('listitem');
  const right = page.getByRole('button', { name: 'Move Bookmark star to the right' });
  await right.focus();
  await page.keyboard.press('Enter');
  await expect.poll(items).toMatchObject({ value: ['shield', 'bookmark', 'downloads'] });
  await expect(rows).toHaveText([/Content blocker/, /Bookmark star/, /Downloads/]);
  await expect(right).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(items).toMatchObject({ value: ['shield', 'downloads', 'bookmark'] });
  await expect(rows).toHaveText([/Content blocker/, /Downloads/, /Bookmark star/]);
  // At the end of the list, the focus moves to the other button of the same item.
  await expect(right).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Bookmark star to the left' })).toBeFocused();
});

test('adds and removes shortcuts of the new tab page', async () => {
  const page = await openSettings();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Example');
  const shortcut = page.getByRole('textbox', { name: 'Address of the shortcut' });
  await shortcut.fill('example.com');
  await shortcut.press('Enter');
  const list = page.getByRole('list', { name: 'Shortcuts' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await shortcut.fill('javascript:alert(1)');
  await shortcut.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'Enter a web address, such as example.com or https://example.com/page.',
  );
  await expect
    .poll(() => page.evaluate(() => window.bridge.invoke('settings.getAll', {})))
    .toMatchObject({
      settings: expect.arrayContaining([
        expect.objectContaining({
          key: 'newtab.tiles',
          value: [{ title: 'Example', url: 'https://example.com/' }],
        }),
      ]),
    });
  await list.getByRole('button', { name: 'Remove Example' }).click();
  await expect(list).toHaveCount(0);
});

test('clears the history, the cookies and the cache of web pages', async () => {
  const server = new FixtureServer();
  await server.start();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    const web = await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await web.evaluate(() => {
      document.cookie = 'kept=yes; max-age=3600';
    });
    const stored = (): Promise<{ cookies: number; cache: number }> =>
      browser.main.evaluate(async ({ session }) => {
        const pages = session.fromPartition('persist:default');
        return { cookies: (await pages.cookies.get({})).length, cache: await pages.getCacheSize() };
      });
    await expect.poll(async () => (await stored()).cookies).toBe(1);
    // The visit is in the history and the page in the cache before they are cleared.
    await expect.poll(async () => (await stored()).cache).toBeGreaterThan(0);
    const visited = async (): Promise<number> => {
      await address.fill('app://history');
      await address.press('Enter');
      const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
      await expect(history.locator('html')).toHaveAttribute('data-ready', 'true');
      return history.getByRole('button', { name: /^Fixture home/ }).count();
    };
    expect(await visited()).toBeGreaterThan(0);
    const page = await openSettings();
    await page.getByRole('button', { name: 'Clear…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clear browsing data' });
    await dialog.getByRole('combobox', { name: 'Time range' }).selectOption('all');
    await dialog.getByRole('button', { name: 'Clear data' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'cleared' })).toHaveText(
      'The browsing data is cleared.',
    );
    expect(await stored()).toEqual({ cookies: 0, cache: 0 });
    expect(await visited()).toBe(0);
  } finally {
    await server.stop();
  }
});

test('keeps the data when the question is cancelled', async () => {
  const server = new FixtureServer();
  await server.start();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    const web = await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await web.evaluate(() => {
      document.cookie = 'kept=yes; max-age=3600';
    });
    const cookies = (): Promise<number> =>
      browser.main.evaluate(async ({ session }) => {
        return (await session.fromPartition('persist:default').cookies.get({})).length;
      });
    await expect.poll(cookies).toBe(1);
    const page = await openSettings();
    await page.getByRole('button', { name: 'Clear…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clear browsing data' });
    await expect(dialog.getByRole('combobox', { name: 'Time range' })).toHaveValue('hour');
    await expect(dialog.getByRole('checkbox', { name: 'History' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'cleared' })).toHaveCount(0);
    // The cookie and the visit are still there.
    expect(await cookies()).toBe(1);
    await address.fill('app://history');
    await address.press('Enter');
    const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
    await expect(history.getByRole('button', { name: /^Fixture home/ })).toBeVisible();
  } finally {
    await server.stop();
  }
});

test('applies the secure DNS provider that is chosen, and turns it off', async () => {
  const page = await openSettings();
  // The host resolver gives nothing back, so the test records how the browser sets it.
  await browser.main.evaluate(({ app }) => {
    const calls: unknown[] = [];
    Reflect.set(globalThis, 'resolverCalls', calls);
    app.configureHostResolver = (options) => {
      calls.push(options);
    };
  });
  const lastCall = (): Promise<unknown> =>
    browser.main.evaluate(() => (Reflect.get(globalThis, 'resolverCalls') as unknown[]).at(-1));
  const dns = page.getByRole('combobox', { name: 'Use secure DNS' });
  await expect(dns).toHaveValue('automatic');
  await dns.selectOption({ label: 'Quad9 (9.9.9.9)' });
  await expect.poll(lastCall).toEqual({
    secureDnsMode: 'secure',
    secureDnsServers: ['https://dns.quad9.net/dns-query'],
  });
  await dns.selectOption({ label: 'Other service' });
  const service = page.getByRole('textbox', { name: 'Address of the DNS over HTTPS service' });
  await service.fill('dns.example');
  await service.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter the https address');
  await service.fill('https://dns.example/dns-query');
  await service.press('Enter');
  await expect.poll(lastCall).toEqual({
    secureDnsMode: 'secure',
    secureDnsServers: ['https://dns.example/dns-query'],
  });
  await dns.selectOption({ label: 'Off' });
  await expect.poll(lastCall).toEqual({ secureDnsMode: 'off', secureDnsServers: [] });
});

test('starts with the provider of the system when an address for secure DNS is not valid', async () => {
  await browser.close();
  // Chromium refuses such an address; it once stopped every start of the browser.
  browser = await launch([], {
    settings: { 'network.secureDnsTemplates': 'https://dns.example/dns-query{?dns' },
  });
  const page = await openSettings();
  const dns = page.getByRole('combobox', { name: 'Use secure DNS' });
  await expect(dns).toHaveValue('automatic');
  // The page refuses an address with the variable in its host, too.
  await dns.selectOption({ label: 'Other service' });
  const service = page.getByRole('textbox', { name: 'Address of the DNS over HTTPS service' });
  await service.fill('https://{dns}.example/');
  await service.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter the https address');
});
test('changes the shortcut of a command, keeps conflicts and text keys out, and resets it', async () => {
  const page = await openSettings();
  const mac = process.platform === 'darwin';
  const tabs = async (): Promise<number> => (await shellState(browser.shell)).tabs.length;
  const keys = (command: string): Promise<string[]> =>
    page.locator(`[data-command="${command}"] kbd`).allTextContents();
  const change = page.getByRole('button', { name: 'Change the shortcut of New tab' });
  await expect.poll(() => keys('tab.new')).toEqual([mac ? '⌘T' : 'Ctrl+T']);
  await change.click();
  await expect(change).toHaveText('Press keys…');
  await pressNative(browser, 'K', ['primary', 'shift'], 'app://settings');
  await expect.poll(() => keys('tab.new')).toEqual([mac ? '⇧⌘K' : 'Ctrl+Shift+K']);
  // The new shortcut opens a tab, and the old one does nothing now.
  const before = await tabs();
  await pressNative(browser, 'K', ['primary', 'shift']);
  await expect.poll(tabs).toBe(before + 1);
  await pressNative(browser, 'T', ['primary']);
  await browser.main.evaluate(() => new Promise((done) => setTimeout(done, 1000)));
  expect(await tabs()).toBe(before + 1);
  await expect(page.getByRole('button', { name: 'Reset the shortcut of New tab' })).toBeVisible();
  // A shortcut of another command needs a confirmation, and moves.
  await browser.shell.getByRole('tab', { name: 'Settings' }).click();
  await change.click();
  await expect(change).toHaveText('Press keys…');
  await pressNative(browser, 'D', ['primary'], 'app://settings');
  const taken = page.getByRole('alert').filter({ hasText: 'is the shortcut of' });
  await expect(taken).toContainText(
    `${mac ? '⌘D' : 'Ctrl+D'} is the shortcut of Bookmark the page.`,
  );
  await taken.getByRole('button', { name: 'Use it for New tab' }).click();
  await expect.poll(() => keys('tab.new')).toEqual([mac ? '⌘D' : 'Ctrl+D']);
  await expect.poll(() => keys('bookmark.toggle')).toEqual([]);
  // A key that types text is no shortcut.
  await change.click();
  await expect(change).toHaveText('Press keys…');
  await pressNative(browser, 'K', [], 'app://settings');
  await expect(page.getByRole('alert')).toContainText('This key types or edits text');
  // So is a key that edits text in pages, such as paste.
  await change.click();
  await expect(change).toHaveText('Press keys…');
  await pressNative(browser, 'V', ['primary'], 'app://settings');
  await expect(page.getByRole('alert')).toContainText('This key types or edits text');
  await expect.poll(() => keys('tab.new')).toEqual([mac ? '⌘D' : 'Ctrl+D']);
  await page.getByRole('button', { name: 'Reset the shortcut of New tab' }).click();
  await expect.poll(() => keys('tab.new')).toEqual([mac ? '⌘T' : 'Ctrl+T']);
  await expect.poll(() => keys('bookmark.toggle')).toEqual([mac ? '⌘D' : 'Ctrl+D']);
  // A shortcut of one's own moves too, also from a command further down the list.
  const downloads = page.getByRole('button', { name: 'Change the shortcut of Open the downloads' });
  await downloads.click();
  await expect(downloads).toHaveText('Press keys…');
  await pressNative(browser, 'Y', ['primary', 'shift'], 'app://settings');
  const own = mac ? '⇧⌘Y' : 'Ctrl+Shift+Y';
  await expect.poll(() => keys('downloads.open')).toEqual([own]);
  await browser.shell.getByRole('tab', { name: 'Settings' }).click();
  await change.click();
  await expect(change).toHaveText('Press keys…');
  await pressNative(browser, 'Y', ['primary', 'shift'], 'app://settings');
  await page
    .getByRole('alert')
    .filter({ hasText: 'is the shortcut of' })
    .getByRole('button', { name: 'Use it for New tab' })
    .click();
  await expect.poll(() => keys('tab.new')).toEqual([own]);
  await expect.poll(() => keys('downloads.open')).toEqual([]);
  const count = await tabs();
  await pressNative(browser, 'Y', ['primary', 'shift']);
  await expect.poll(tabs).toBe(count + 1);
});

/** The background color that the shell paints with. */
function surface(): Promise<string> {
  return browser.shell.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--surface-0').trim(),
  );
}

test('colors every view with the theme and the custom colors, and imports a theme', async () => {
  const page = await openSettings();
  const before = await surface();
  await page.getByRole('radio', { name: 'Forest' }).check();
  await expect.poll(surface).toBe('oklch(96.8% 0.01 155)');
  // Open windows take the theme's color too, which shows where no page has painted yet.
  await expect
    .poll(() =>
      browser.main.evaluate(({ BaseWindow }) =>
        BaseWindow.getAllWindows()[0]?.getBackgroundColor().toLowerCase(),
      ),
    )
    .toBe('#eff7f1');
  await page.getByRole('radio', { name: 'Custom' }).check();
  await expect.poll(surface).toBe(before);
  const background = page.getByRole('textbox', {
    name: 'Background in the light mode',
    exact: true,
  });
  await background.evaluate((input: HTMLInputElement) => {
    input.value = '#fdf6e3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(surface).toBe('#fdf6e3');
  // Text in the color of its background cannot be read; the page says so.
  await page
    .getByRole('textbox', { name: 'Text in the light mode', exact: true })
    .evaluate((input: HTMLInputElement) => {
      input.value = '#fdf6e3';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await expect(page.getByRole('alert').filter({ hasText: 'Text on Background' })).toContainText(
    'has a contrast of 1.0:1 in the light mode',
  );
  // Texts show on the color under the pointer as well, such as the marked section.
  await expect(
    page.getByRole('alert').filter({ hasText: 'Text on Pointer over a control' }),
  ).toContainText('in the light mode');
  const folder = mkdtempSync(join(tmpdir(), 'theme-'));
  const path = join(folder, 'theme.json');
  writeFileSync(
    path,
    JSON.stringify({ $schemaVersion: 1, light: { 'surface-0': '#eef6ff' }, dark: {} }),
  );
  try {
    await browser.main.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] });
    }, path);
    await page.getByRole('button', { name: 'Import…' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'theme' })).toHaveText(
      'The theme is imported.',
    );
    await expect.poll(surface).toBe('#eef6ff');
    await expect(page.getByRole('alert').filter({ hasText: 'Text on Background' })).toHaveCount(0);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
