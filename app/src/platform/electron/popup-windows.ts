import type { BrowserWindowController } from './browser-window.ts';

// A popup shows only the page that it opened with, without a tab strip, so a tab that would open
// in it opens in a regular window instead: people could not reach it there, and the session
// keeps no popup. The code for the tabs that pages open, the context menu and the commands of
// the windows use this; none of it is on the way of the browser's start.

/**
 * The window that takes the tabs of a popup: the regular window, or the private window for a
 * private popup, that had the focus last and shows the popup's workspace, whose partition the
 * popup's pages use.
 * @param popup - The popup.
 * @returns The window, or `undefined` while no such window is open.
 */
export function tabWindowOf(popup: BrowserWindowController): BrowserWindowController | undefined {
  return popup.windows?.byFocus.find(
    (window) =>
      !window.popup &&
      !window.closing &&
      window.isPrivate === popup.isPrivate &&
      window.tabs.workspace === popup.tabs.workspace,
  );
}

/**
 * Opens an address in a tab of the window that takes the tabs of a popup, and brings that window
 * to the front unless the tab opens in the background; a new window opens with the tab when no
 * such window is open.
 * @param popup - The popup.
 * @param url - The address.
 * @param activate - Whether the tab becomes the active one.
 */
export function openForPopup(popup: BrowserWindowController, url: string, activate: boolean): void {
  const target = tabWindowOf(popup);
  if (target === undefined) {
    popup.windows?.open(url, { private: popup.isPrivate, workspace: popup.tabs.workspace });
    return;
  }
  target.tabs.open(url, { activate });
  if (activate) target.window.focus();
}
