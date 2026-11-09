import { app, dialog, Menu } from 'electron';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { WindowCommand } from '../platform/electron/shortcuts.ts';
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

/**
 * Tells that an exception of the content blocker could not be saved.
 * @param window - The window whose blocker menu was used.
 * @param managed - Whether a policy manages the exceptions.
 */
export function showBlockerSaveError(window: BrowserWindowController, managed: boolean): void {
  const i18n = translatorFor(app.getLocale(), process.platform);
  void dialog.showMessageBox(window.window, {
    type: 'warning',
    message: i18n.t('menu.blockerSaveFailed'),
    detail: i18n.t(managed ? 'menu.blockerManaged' : 'menu.blockerListFull'),
  });
}

/**
 * The menu bar of macOS, with the browser's settings in the application menu and the tools
 * of the page in the View menu. Its items run the commands of the window, as the keys do, so
 * they act on the page and not on the browser's own views, and the policies apply.
 * @param run - Runs a command in the frontmost window.
 */
export function macMenuBar(run: (command: WindowCommand) => void): Menu {
  const i18n = translatorFor(app.getLocale(), process.platform);
  // The window handles the keys itself, also while a page has the focus.
  const command = (
    label: Parameters<typeof i18n.t>[0],
    accelerator: string,
    name: WindowCommand,
  ): Electron.MenuItemConstructorOptions => ({
    label: i18n.t(label),
    accelerator,
    registerAccelerator: false,
    click: () => run(name),
  });
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
          click: () => run('settings.open'),
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
    {
      label: i18n.t('menu.view'),
      submenu: [
        command('menu.reload', 'Cmd+R', 'page.reload'),
        command('menu.reloadHard', 'Shift+Cmd+R', 'page.reloadHard'),
        { type: 'separator' },
        command('menu.actualSize', 'Cmd+0', 'zoom.reset'),
        command('menu.zoomIn', 'Cmd+Plus', 'zoom.in'),
        command('menu.zoomOut', 'Cmd+-', 'zoom.out'),
        { type: 'separator' },
        command('menu.fullScreen', 'Ctrl+Cmd+F', 'window.fullscreen'),
        { type: 'separator' },
        command('menu.viewSource', 'Alt+Cmd+U', 'page.source'),
        command('menu.developerTools', 'Alt+Cmd+I', 'devtools.toggle'),
      ],
    },
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
