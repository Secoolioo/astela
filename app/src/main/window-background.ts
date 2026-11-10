import { nativeTheme } from 'electron';

/**
 * The window color that shows until the shell has painted: `--surface-0` of the UI tokens
 * in the system's light or dark mode, or in a private window, which is dark in both, so a
 * window never flashes in the other mode.
 * @param privateWindow - Whether the window is a private window.
 */
export function windowBackground(privateWindow = false): string {
  return privateWindow || nativeTheme.shouldUseDarkColors ? '#14161a' : '#f5f7f9';
}
