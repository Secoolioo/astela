import { nativeTheme } from 'electron';

/** `--surface-0` of the theme in light and dark mode, as `#rrggbb`. */
let colors = { light: '#f5f7f9', dark: '#14161a' };

/** `--surface-1` of the theme in light and dark mode, the color of the toolbar, as `#rrggbb`. */
let toolbar = { light: '#fdfdff', dark: '#1c1e22' };

/**
 * Sets the window colors of the theme.
 * @param theme - `--surface-0` of the theme in light and dark mode.
 * @param toolbarTheme - `--surface-1` of the theme in light and dark mode.
 */
export function setWindowColors(
  theme: { readonly light: string; readonly dark: string },
  toolbarTheme: { readonly light: string; readonly dark: string },
): void {
  colors = { light: theme.light, dark: theme.dark };
  toolbar = { light: toolbarTheme.light, dark: toolbarTheme.dark };
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

/**
 * The color of the toolbar, which the window controls take when the toolbar is the top row:
 * `--surface-1` of the theme in the system's light or dark mode, or in a private window.
 * @param privateWindow - Whether the window is a private window.
 */
export function toolbarBackground(privateWindow = false): string {
  return privateWindow || nativeTheme.shouldUseDarkColors ? toolbar.dark : toolbar.light;
}
