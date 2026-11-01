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
    {
      label: i18n.t('menu.bookmarks'),
      accelerator: mac ? 'Shift+Cmd+O' : 'Ctrl+Shift+O',
      registerAccelerator: false,
      click: () => window.execute('bookmarks.open'),
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

/** A bookmark or folder for the menu of a folder of the bookmarks bar. */
export interface FolderEntry {
  readonly id: number;
  readonly title: string;
  readonly url: string | null;
}

/** At most this many bookmarks and folders appear in one menu. */
const folderMenuLimit = 500;

/**
 * Shows the contents of a folder of the bookmarks bar as a menu, with a submenu for each
 * folder in it. Choosing a bookmark opens it in the active tab, or with Ctrl or Command in a
 * new tab.
 * @param window - The window whose bookmarks bar was clicked.
 * @param position - Where the menu opens, in the window's coordinates.
 * @param folder - The folder, and how many of its first entries the menu leaves out because
 *   the bookmarks bar shows them.
 * @param contents - Lists what a folder contains.
 * @param open - Opens a bookmark.
 */
export function popupBookmarkFolder(
  window: BrowserWindowController,
  position: { readonly x: number; readonly y: number },
  folder: { readonly id: number; readonly from: number },
  contents: (folder: number) => readonly FolderEntry[],
  open: (url: string, newTab: boolean) => void,
): void {
  const i18n = translatorFor(app.getLocale(), process.platform);
  const mac = process.platform === 'darwin';
  // Elsewhere, & marks the access key of a menu item; a title shows it as it is.
  const label = (title: string): string => (mac ? title : title.replaceAll('&', '&&'));
  const items = (id: number, depth: number): Electron.MenuItemConstructorOptions[] => {
    const skip = depth === 0 ? folder.from : 0;
    const entries = contents(id).slice(skip, skip + folderMenuLimit);
    if (entries.length === 0) return [{ label: i18n.t('menu.emptyFolder'), enabled: false }];
    return entries.map((entry): Electron.MenuItemConstructorOptions => {
      const url = entry.url;
      if (url === null) {
        return {
          label: label(entry.title),
          submenu: depth < 20 ? items(entry.id, depth + 1) : [],
        };
      }
      return {
        label: label(entry.title || url),
        click: (_item, _window, event) =>
          open(url, event.ctrlKey === true || event.metaKey === true),
      };
    });
  };
  Menu.buildFromTemplate(items(folder.id, 0)).popup({
    window: window.window,
    x: position.x,
    y: position.y,
  });
}
