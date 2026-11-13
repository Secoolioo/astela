import { describe, expect, it, vi } from 'vitest';
import { themeBackgrounds, themeToolbars } from '../../shared/themes.ts';

const theme = vi.hoisted(() => ({ shouldUseDarkColors: false }));
vi.mock('electron', () => ({ nativeTheme: theme }));

describe('window colors', () => {
  it("start with Astela's window and toolbar colors, before the settings set those of the theme", async () => {
    const { setWindowColors, toolbarBackground, windowBackground } =
      await import('../window-background.ts');
    expect([windowBackground(), toolbarBackground()]).toEqual([
      themeBackgrounds.astela.light,
      themeToolbars.astela.light,
    ]);
    // A private window is dark in both modes.
    expect([windowBackground(true), toolbarBackground(true)]).toEqual([
      themeBackgrounds.astela.dark,
      themeToolbars.astela.dark,
    ]);
    theme.shouldUseDarkColors = true;
    expect([windowBackground(), toolbarBackground()]).toEqual([
      themeBackgrounds.astela.dark,
      themeToolbars.astela.dark,
    ]);
    setWindowColors(themeBackgrounds.slate, themeToolbars.slate);
    expect([windowBackground(), toolbarBackground()]).toEqual([
      themeBackgrounds.slate.dark,
      themeToolbars.slate.dark,
    ]);
  });
});
