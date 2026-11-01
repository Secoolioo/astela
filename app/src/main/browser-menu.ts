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
      label: i18n.t('menu.history'),
      accelerator: mac ? 'Cmd+Y' : 'Ctrl+H',
      registerAccelerator: false,
      click: () => window.execute('history.open'),
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

/** What the content blocker's menu shows for the active tab. */
export interface BlockerMenuState {
  /** The page's site, by host name. */
  readonly site: string;
  /** Requests blocked on the page. */
  readonly blocked: number;
  /** Whether blocking works on the page. */
  readonly on: boolean;
  /** Whether the blocker is on at all; when it is off, sites cannot be switched. */
  readonly available: boolean;
  /** Turns blocking on the site on or off and reloads the page. */
  readonly toggle: () => void;
}

/**
 * Shows the content blocker's menu for the active tab: how much it blocked on the page, the
 * switch for the page's site, and the way to its settings.
 * @param window - The window whose blocker button was clicked.
 * @param position - Where the menu opens, in the window's coordinates.
 * @param state - The page's numbers and the switch.
 */
export function popupBlockerMenu(
  window: BrowserWindowController,
  position: { readonly x: number; readonly y: number },
  state: BlockerMenuState,
): void {
  const i18n = translatorFor(app.getLocale(), process.platform);
  const menu = Menu.buildFromTemplate([
    { label: i18n.t('menu.blockedCount', { count: String(state.blocked) }), enabled: false },
    { type: 'separator' },
    {
      label: i18n.t('menu.blockOnSite', { site: state.site }),
      type: 'checkbox',
      checked: state.on,
      enabled: state.available,
      click: state.toggle,
    },
    { type: 'separator' },
    { label: i18n.t('menu.blockerSettings'), click: () => window.execute('settings.open') },
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
