import { nativeTheme } from 'electron';

/** `--surface-0` of the theme in light and dark mode, as `#rrggbb`. */
let colors = { light: '#f5f7f9', dark: '#14161a' };

/**
 * Sets the window colors of the theme.
 * @param theme - `--surface-0` of the theme in light and dark mode.
 */
export function setWindowColors(theme: { readonly light: string; readonly dark: string }): void {
  colors = { light: theme.light, dark: theme.dark };
}

/**
 * The window color that shows until the shell has painted: `--surface-0` of the theme in the
 * system's light or dark mode, or in a private window, which is dark in both, so a window
 * never flashes in the other mode.
 * @param privateWindow - Whether the window is a private window.
 */
export function windowBackground(privateWindow = false): string {
  return privateWindow || nativeTheme.shouldUseDarkColors ? colors.dark : colors.light;
}
