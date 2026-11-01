import { expect, test } from '@playwright/test';
import { launch, waitForPage } from './harness.ts';

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
