import { app, Menu } from 'electron';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import { translatorFor } from './i18n/i18n.ts';

/**
 * Shows the browser menu of a window. Its shortcuts are shown for reference only: the
 * window handles them itself, also while a page has the focus.
 * @param window - The window whose menu button was clicked.
 * @param position - Where the menu opens, in the window's coordinates.
 */
export function popupBrowserMenu(
  window: BrowserWindowController,
  position: { readonly x: number; readonly y: number },
): void {
  const i18n = translatorFor(app.getLocale(), process.platform);
  const mac = process.platform === 'darwin';
  const menu = Menu.buildFromTemplate([
    {
      label: i18n.t('menu.newTab'),
      accelerator: mac ? 'Cmd+T' : 'Ctrl+T',
      registerAccelerator: false,
      click: () => window.execute('tab.new'),
    },
    { type: 'separator' },
    {
      label: i18n.t('menu.settings'),
      ...(mac ? { accelerator: 'Cmd+,', registerAccelerator: false } : {}),
      click: () => window.execute('settings.open'),
    },
  ]);
  menu.popup({ window: window.window, x: position.x, y: position.y });
}

/**
 * The menu bar of macOS, with the browser's settings in the application menu.
 * @param openSettings - Opens the settings page in the frontmost window.
 */
export function macMenuBar(openSettings: () => void): Menu {
  const i18n = translatorFor(app.getLocale(), process.platform);
  return Menu.buildFromTemplate([
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: i18n.t('menu.settings'),
          accelerator: 'Cmd+,',
          registerAccelerator: false,
          click: openSettings,
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]);
}
