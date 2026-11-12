import { expect, test } from '@playwright/test';
import { FixtureServer, launch, waitForPage } from './harness.ts';

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
