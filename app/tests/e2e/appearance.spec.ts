import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  FixtureServer,
  launch,
  overlayPage,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

/** The design tokens that the browser set in a page. */
function tokens(): { tab: string; light: string; dark: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    tab: style.getPropertyValue('--tab-height').trim(),
    light: style.getPropertyValue('--accent-light').trim(),
    dark: style.getPropertyValue('--accent-dark').trim(),
  };
}

test('applies the stored color mode, accent and density before the first paint', async () => {
  const browser = await launch([], {
    settings: {
      'appearance.colorMode': 'dark',
      'appearance.accent': 'green',
      'appearance.density': 'compact',
    },
  });
  try {
    // Playwright emulates a light color scheme in the pages it attaches to, so the mode is
    // checked in the browser process.
    expect(
      await browser.main.evaluate(({ nativeTheme, BaseWindow }) => ({
        source: nativeTheme.themeSource,
        dark: nativeTheme.shouldUseDarkColors,
        background: BaseWindow.getAllWindows()[0]?.getBackgroundColor(),
      })),
    ).toEqual({ source: 'dark', dark: true, background: '#14161A' });
    const expected = {
      tab: '28px',
      light: 'oklch(54.8% 0.150 150.0)',
      dark: 'oklch(72.0% 0.150 150.0)',
    };
    expect(await browser.shell.evaluate(tokens)).toEqual(expected);
    const page = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
    expect(await page.evaluate(tokens)).toEqual(expected);
  } finally {
    await browser.close();
  }
});

/** The accent of a page and the color of its progress. */
function accentTokens(): { accent: string; progress: string } {
  const style = getComputedStyle(document.documentElement);
  return {
    accent: style.getPropertyValue('--accent').trim(),
    progress: style.getPropertyValue('--accent-secondary').trim(),
  };
}

test('starts with the violet of the logo and shows progress in its blue', async () => {
  const browser = await launch();
  try {
    // Playwright emulates a light color scheme in the pages it attaches to.
    const astela = { accent: 'oklch(55.0% 0.240 290.0)', progress: 'oklch(55.0% 0.180 265.0)' };
    await expect.poll(() => browser.shell.evaluate(accentTokens)).toEqual(astela);
    const page = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
    expect(await page.evaluate(accentTokens)).toEqual(astela);
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings/#appearance.accent');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    // A theme has the name Astela as well, so the test looks only at the accent colors.
    const accents = settings.getByRole('radiogroup', { name: 'Accent color' });
    await expect(accents.getByRole('radio', { name: 'Astela' })).toBeChecked();
    // Another accent shows progress in its own color.
    await accents.getByRole('radio', { name: 'Green' }).check();
    await expect
      .poll(() => browser.shell.evaluate(accentTokens))
      .toEqual({ accent: 'oklch(54.8% 0.150 150.0)', progress: 'oklch(54.8% 0.150 150.0)' });
  } finally {
    await browser.close();
  }
});

/** The tokens of motion, shape and depth that a page uses. */
function motionTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const names = [
    '--motion-instant',
    '--motion-fast',
    '--motion-base',
    '--motion-slow',
    '--motion-loop',
    '--ease-standard',
    '--radius-1',
    '--radius-2',
    '--radius-3',
    '--radius-pill',
  ];
  return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
}

test('takes motion and radii from tokens, and moves nothing when the system asks for reduced motion', async () => {
  const browser = await launch();
  try {
    const page = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
    for (const view of [browser.shell, page]) {
      expect(await view.evaluate(motionTokens)).toEqual({
        '--motion-instant': '60ms',
        '--motion-fast': '120ms',
        '--motion-base': '180ms',
        '--motion-slow': '220ms',
        '--motion-loop': '1000ms',
        '--ease-standard': 'cubic-bezier(0.2, 0, 0, 1)',
        '--radius-1': '6px',
        '--radius-2': '8px',
        '--radius-3': '12px',
        '--radius-pill': '999px',
      });
      expect(
        await view.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--shadow-popover').trim(),
        ),
      ).not.toBe('');
      await view.emulateMedia({ reducedMotion: 'reduce' });
      expect(await view.evaluate(motionTokens)).toMatchObject({
        '--motion-instant': '0ms',
        '--motion-fast': '0ms',
        '--motion-base': '0ms',
        '--motion-slow': '0ms',
        '--motion-loop': '0ms',
      });
    }
  } finally {
    await browser.close();
  }
});

test('shows switches whose knob slides, and a star that pops when a page becomes a bookmark', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch();
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('app://settings/#bookmarks.bar');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    const toggle = settings.getByRole('switch', { name: 'Show bookmarks bar' });
    const look = (): Promise<string[]> =>
      toggle.evaluate((element) => [
        getComputedStyle(element).appearance,
        getComputedStyle(element).width,
        getComputedStyle(element, '::before').transform,
      ]);
    expect(await look()).toEqual(['none', '32px', 'none']);
    await toggle.check();
    await expect.poll(look).toEqual(['none', '32px', 'matrix(1, 0, 0, 1, 14, 0)']);
    // The star of a page that becomes a bookmark pops once.
    await address.fill(`${server.origin}/index.html`);
    await address.press('Enter');
    await waitForPage(browser, (url) => url.endsWith('/index.html'));
    await browser.shell.evaluate(() => {
      const root = document.querySelector('app-shell')?.shadowRoot;
      const pops = { count: 0 };
      Reflect.set(window, 'pops', pops);
      root?.addEventListener(
        'animationstart',
        (event) => {
          if (event instanceof AnimationEvent && event.animationName === 'pop') pops.count += 1;
        },
        true,
      );
    });
    await browser.shell.getByRole('button', { name: 'Bookmark this page' }).click();
    await expect
      .poll(() =>
        browser.shell.evaluate(() => (Reflect.get(window, 'pops') as { count: number }).count),
      )
      .toBe(1);
  } finally {
    await browser.close();
    await server.stop();
  }
});

/** A color as Chromium computes it, such as `oklch(0.34 0.01 260 / 0.6)`. */
function oklch(value: string): { l: number; c: number; h: number; alpha: number } {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (match === null) throw new Error(`Not an oklch color: ${value}`);
  return {
    l: Number(match[1]),
    c: Number(match[2]),
    h: Number(match[3]),
    alpha: Number(match[4] ?? '1'),
  };
}

/**
 * The surfaces and the line of a page's palette, and the colors that its line and its raised
 * surface take on an element that uses them.
 */
function darkLook(): { palette: Record<string, string>; line: string; raised: string } {
  const style = getComputedStyle(document.documentElement);
  const names = ['--surface-0', '--surface-1', '--surface-2', '--surface-hover', '--border-1'];
  const probe = document.createElement('div');
  probe.style.borderTop = '1px solid var(--line-1)';
  probe.style.background = 'var(--surface-raised)';
  document.body.append(probe);
  const look = {
    palette: Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()])),
    line: getComputedStyle(probe).borderTopColor,
    raised: getComputedStyle(probe).backgroundColor,
  };
  probe.remove();
  return look;
}

/** Astela's dark surfaces, 3.5 % lightness apart, and its line. */
const darkPalette = {
  '--surface-0': 'oklch(20% 0.008 260)',
  '--surface-1': 'oklch(23.5% 0.009 260)',
  '--surface-2': 'oklch(27% 0.01 260)',
  '--surface-hover': 'oklch(30.5% 0.011 260)',
  '--border-1': 'oklch(34% 0.01 260)',
};

/** Checks that a line is the line of the dark palette, drawn at 60 %. */
function expectCalmLine(color: string): void {
  const line = oklch(color);
  expect(line.l).toBeCloseTo(0.34, 3);
  expect(line.alpha).toBeCloseTo(0.6, 3);
}

/** Checks that a surface lies between the panels and the fields of the dark palette. */
function expectRaised(color: string): void {
  const raised = oklch(color);
  expect(raised.l).toBeGreaterThan(0.235);
  expect(raised.l).toBeLessThan(0.27);
  expect(raised.alpha).toBe(1);
}

/**
 * Checks that a line is the line of the palette, drawn at 60 %, and that a surface lies
 * between the panels and the fields of the dark palette.
 */
function expectCalm(look: { line: string; raised: string }): void {
  expectCalmLine(look.line);
  expectRaised(look.raised);
}

/** The line at the top of an element and its surface, as its page computes them. */
function outlineOf(element: Locator): Promise<{ line: string; raised: string }> {
  return element.evaluate((found) => ({
    line: getComputedStyle(found).borderTopColor,
    raised: getComputedStyle(found).backgroundColor,
  }));
}

/** The bar before an element, as its page computes it, or `none` for its content without one. */
function barOf(element: Locator): Promise<{ content: string; color: string; width: string }> {
  return element.evaluate((found) => {
    const bar = getComputedStyle(found, '::before');
    return { content: bar.content, color: bar.backgroundColor, width: bar.width };
  });
}

/** The accent of a page, as its tokens give it. */
function accentColor(): string {
  const probe = document.createElement('div');
  probe.style.background = 'var(--accent)';
  document.body.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

/** The shell of the private window, once it is open. */
async function privateShell(browser: Browser): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of browser.cdp.contexts().flatMap((context) => context.pages())) {
        if (!page.url().startsWith('app://shell') || page.isClosed()) continue;
        if ((await shellState(page).catch(() => undefined))?.private === true) found = page;
      }
      return found !== undefined;
    })
    .toBe(true);
  if (found === undefined) throw new Error('No private window');
  return found;
}

test('uses calm lines, finer surface steps and raised popovers in the dark mode', async () => {
  const mac = process.platform === 'darwin';
  const browser = await launch([], { settings: { 'appearance.colorMode': 'dark' } });
  try {
    // Windows and Linux: the window controls that the browser gives Chromium to draw.
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
    // Playwright emulates a light color scheme in the pages it attaches to.
    const newTab = await waitForPage(browser, (url) => url.startsWith('app://newtab'));
    for (const view of [browser.shell, newTab]) {
      await view.emulateMedia({ colorScheme: 'dark' });
      const look = await view.evaluate(darkLook);
      expect(look.palette).toEqual(darkPalette);
      expectCalm(look);
    }
    // The line below the toolbar is the calm one.
    const navLine = oklch(
      await browser.shell.evaluate(() => {
        const nav = document.querySelector('app-shell')?.shadowRoot?.querySelector('nav');
        return nav === null || nav === undefined ? 'none' : getComputedStyle(nav).borderBottomColor;
      }),
    );
    expect(navLine.l).toBeCloseTo(0.34, 3);
    expect(navLine.alpha).toBeCloseTo(0.6, 3);
    // The suggestions of the address bar lie on the raised surface, inside the calm line.
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await address.fill('calm lines');
    const overlay = await overlayPage(browser);
    await overlay.emulateMedia({ colorScheme: 'dark' });
    const list = overlay.getByRole('listbox', { name: 'Suggestions' });
    await expect(list).toBeVisible();
    expectCalm(await outlineOf(list));
    // The row that the arrow keys mark carries a bar in the accent, which the step of its
    // surface alone does not show well; a row without the mark has no bar.
    const row = list.getByRole('option').first();
    await expect(row).toHaveAttribute('aria-selected', 'false');
    expect((await barOf(row)).content).toBe('none');
    await address.press('ArrowDown');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    expect(await barOf(row)).toEqual({
      content: '""',
      color: await overlay.evaluate(accentColor),
      width: '3px',
    });
    // Forced colors take the surfaces away; the bar takes the color of the system's mark.
    await overlay.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
    const highlight = await overlay.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'forced-color-adjust: none; background: Highlight';
      document.body.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect((await barOf(row)).color).toBe(highlight);
    await overlay.emulateMedia({ colorScheme: 'dark', forcedColors: 'none' });
    await address.press('Escape');
    if (!mac) {
      // With the tabs at a side, the window controls take the color of the darker toolbar.
      await address.fill('app://settings/#tabs.position');
      await address.press('Enter');
      const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
      await settings.getByRole('radio', { name: 'Left' }).check();
      await expect
        .poll(() =>
          browser.main.evaluate(() =>
            (globalThis as unknown as { overlays: Electron.TitleBarOverlay[] }).overlays.at(-1),
          ),
        )
        .toEqual({ color: '#1c1e22', symbolColor: '#e8eaed', height: 40 });
    }
    // A private window has the same colors in the light mode.
    await pressNative(browser, 'N', ['primary', 'shift']);
    const shell = await privateShell(browser);
    await shell.emulateMedia({ colorScheme: 'light' });
    const look = await shell.evaluate(darkLook);
    expect(look.palette).toEqual(darkPalette);
    expectCalm(look);
  } finally {
    await browser.close();
  }
});

test('lays popovers, questions and dialogs of the dark mode on the raised surface, and lists inside the calm line', async () => {
  const server = new FixtureServer();
  await server.start();
  const browser = await launch([], { settings: { 'appearance.colorMode': 'dark' } });
  try {
    const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    // Two pages, so that the history lists two rows.
    for (const name of ['index.html', 'permissions.html']) {
      await address.fill(`${server.origin}/${name}`);
      await address.press('Enter');
      await waitForPage(browser, (url) => url.endsWith(`/${name}`));
    }
    const page = await waitForPage(browser, (url) => url.endsWith('/permissions.html'));
    // The popover of the shield, with its rows apart by the calm line.
    await browser.shell.getByRole('button', { name: /^Content blocker: \d+ blocked$/ }).click();
    const overlay = await overlayPage(browser);
    await overlay.emulateMedia({ colorScheme: 'dark' });
    const shield = overlay.getByRole('dialog', { name: 'Content blocker' });
    await expect(shield).toBeVisible();
    expectCalm(await outlineOf(shield));
    expectCalmLine((await outlineOf(shield.locator('.row').first())).line);
    await overlay.keyboard.press('Escape');
    await expect(shield).toBeHidden();
    // The question of a site.
    const asked = page.evaluate(() => Notification.requestPermission());
    await overlay.emulateMedia({ colorScheme: 'dark' });
    const question = overlay.getByRole('dialog', {
      name: `${new URL(server.origin).host} wants to`,
    });
    await expect(question).toBeVisible();
    expectCalm(await outlineOf(question));
    await question.getByRole('button', { name: 'Allow' }).click();
    expect(await asked).toBe('granted');
    // The settings: sections inside the calm line with their rows apart by it, and the dialog
    // and the bar that offers a restart on the raised surface.
    await address.fill('app://settings');
    await address.press('Enter');
    const settings = await waitForPage(browser, (url) => url.startsWith('app://settings'));
    await settings.emulateMedia({ colorScheme: 'dark' });
    const section = settings.locator('section').first();
    await expect(section).toBeVisible();
    expectCalmLine((await outlineOf(section)).line);
    expectCalmLine((await outlineOf(settings.locator('.slot + .slot').first())).line);
    await settings.getByRole('button', { name: 'Reset all settings…' }).click();
    const reset = settings.getByRole('dialog');
    await expect(reset).toBeVisible();
    expectCalm(await outlineOf(reset));
    await reset.getByRole('button', { name: 'Cancel' }).click();
    await expect(reset).toBeHidden();
    await settings.getByRole('combobox', { name: 'Language of the browser' }).selectOption('de');
    const restart = settings.locator('.restart');
    await expect(restart).toBeVisible();
    expectCalm(await outlineOf(restart));
    // The history: the list of the day inside the calm line, with its rows apart by it.
    await address.fill('app://history');
    await address.press('Enter');
    const history = await waitForPage(browser, (url) => url.startsWith('app://history'));
    await history.emulateMedia({ colorScheme: 'dark' });
    const second = history.locator('li + li').first();
    await expect(second).toBeVisible();
    expectCalmLine((await outlineOf(history.locator('ul').first())).line);
    expectCalmLine((await outlineOf(second)).line);
  } finally {
    await browser.close();
    await server.stop();
  }
});

test('mixes the calm line and the raised surface from the colors of a custom theme', async () => {
  const dark = { 'surface-1': '#2a2622', 'surface-2': '#3a342e', 'border-1': '#8a7f70' };
  const browser = await launch([], {
    settings: {
      'appearance.colorMode': 'dark',
      'appearance.theme': 'custom',
      'appearance.customTheme': { light: {}, dark },
    },
  });
  try {
    await browser.shell.emulateMedia({ colorScheme: 'dark' });
    // Each property of a probe takes a value, and the shell computes its color.
    const probes: [string, string][] = [
      ['border-top-color', 'var(--line-1)'],
      ['border-top-color', `color-mix(in oklch, ${dark['border-1']} 60%, transparent)`],
      ['background-color', 'var(--surface-raised)'],
      ['background-color', `color-mix(in oklch, ${dark['surface-1']}, ${dark['surface-2']})`],
    ];
    const [line, mixedLine, raised, mixedRaised] = await browser.shell.evaluate(
      (pairs) =>
        pairs.map(([property, value]) => {
          const probe = document.createElement('div');
          probe.style.setProperty(property, value);
          document.body.append(probe);
          const color = getComputedStyle(probe).getPropertyValue(property);
          probe.remove();
          return color;
        }),
      probes,
    );
    // The theme sets seven colors; the line and the raised surface follow from them.
    expect(oklch(line ?? '').alpha).toBeCloseTo(0.6, 3);
    expect(line).toBe(mixedLine);
    expect(raised).toBe(mixedRaised);
  } finally {
    await browser.close();
  }
});
