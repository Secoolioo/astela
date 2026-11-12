import { app, dialog, Menu } from 'electron';
import { uiLocale } from './ui-language.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import {
  acceleratorOf,
  shortcutsOf,
  systemShortcutsOf,
  type WindowCommand,
} from '../shared/shortcuts.ts';
import { translatorFor } from './i18n/i18n.ts';

/**
 * Shows the browser menu of a window. Its shortcuts are shown for reference only: the
 * window handles them itself, also while a page has the focus.
 * @param window - The window whose menu button was clicked.
 * @param position - Where the menu opens, in the window's coordinates.
 * @param options - Whether people may open private windows.
 */
export function popupBrowserMenu(
  window: BrowserWindowController,
  position: { readonly x: number; readonly y: number },
  options: { readonly privateWindows: boolean },
): void {
  const i18n = translatorFor(uiLocale(), process.platform);
  const table = window.shortcuts();
  const item = (
    label: Parameters<typeof i18n.t>[0],
    command: WindowCommand,
  ): Electron.MenuItemConstructorOptions => {
    // Without a shortcut of the window, an item shows the one that the system gives the
    // command, such as Command+Q, with which the application menu of macOS quits.
    const accelerator =
      acceleratorFor(table, command) ??
      systemShortcutsOf(process.platform, command)
        .map((shortcut) => acceleratorOf(shortcut))
        .find((written) => written !== undefined);
    return {
      label: i18n.t(label),
      ...(accelerator === undefined ? {} : { accelerator, registerAccelerator: false }),
      click: () => window.execute(command),
    };
  };
  const menu = Menu.buildFromTemplate([
    item('menu.newTab', 'tab.new'),
    item('menu.newWindow', 'window.new'),
    ...(options.privateWindows ? [item('menu.newPrivateWindow', 'window.newPrivate')] : []),
    { type: 'separator' },
    item('menu.history', 'history.open'),
    item('menu.downloads', 'downloads.open'),
    item('menu.bookmarks', 'bookmarks.open'),
    { type: 'separator' },
    {
      label: i18n.t('menu.zoom'),
      submenu: [
        item('menu.zoomIn', 'zoom.in'),
        item('menu.zoomOut', 'zoom.out'),
        item('menu.actualSize', 'zoom.reset'),
        { type: 'separator' },
        item('menu.fullScreen', 'window.fullscreen'),
      ],
    },
    item('menu.find', 'find.open'),
    item('menu.print', 'page.print'),
    item('menu.savePage', 'page.save'),
    {
      label: i18n.t('menu.moreTools'),
      submenu: [
        item('menu.viewSource', 'page.source'),
        item('menu.developerTools', 'devtools.toggle'),
      ],
    },
    { type: 'separator' },
    item('menu.settings', 'settings.open'),
    item('menu.about', 'app.about'),
    item(process.platform === 'win32' ? 'menu.exit' : 'menu.quit', 'app.quit'),
  ]);
  menu.popup({ window: window.window, x: position.x, y: position.y });
}

/** The shortcut of a command that a menu shows: the first that Electron can write. */
function acceleratorFor(
  table: ReadonlyMap<string, WindowCommand>,
  command: WindowCommand,
): string | undefined {
  for (const shortcut of shortcutsOf(table, command)) {
    const accelerator = acceleratorOf(shortcut);
    if (accelerator !== undefined) return accelerator;
  }
  return undefined;
}

/**
 * Tells the version of the browser and of what it is built on.
 * @param window - The window whose menu or shortcut asked.
 */
export function showAbout(window: BrowserWindowController): void {
  const i18n = translatorFor(uiLocale(), process.platform);
  void dialog.showMessageBox(window.window, {
    type: 'info',
    message: i18n.t('dialog.about', { name: app.getName(), version: app.getVersion() }),
    detail: [
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node.js ${process.versions.node}`,
    ].join('\n'),
  });
}

/**
 * Tells that an exception of the content blocker could not be saved.
 * @param window - The window whose blocker menu was used.
 * @param managed - Whether a policy manages the exceptions.
 */
export function showBlockerSaveError(window: BrowserWindowController, managed: boolean): void {
  const i18n = translatorFor(uiLocale(), process.platform);
  void dialog.showMessageBox(window.window, {
    type: 'warning',
    message: i18n.t('menu.blockerSaveFailed'),
    detail: i18n.t(managed ? 'menu.blockerManaged' : 'menu.blockerListFull'),
  });
}

/**
 * Runs a command of the menu bar of macOS in the window that was used last. With no window
 * open, a command that opens a window opens only that window, and any other command runs in
 * a new window.
 * @param windows - The browser's windows.
 * @param command - The command.
 * @param openPrivateWindow - Opens a private window, if people may.
 */
export function runFromMenuBar(
  windows: Pick<WindowManager, 'lastUsed' | 'open'>,
  command: WindowCommand,
  openPrivateWindow: () => void,
): void {
  const front = windows.lastUsed;
  if (front !== undefined) {
    front.execute(command);
  } else if (command === 'window.newPrivate') {
    openPrivateWindow();
  } else {
    const opened = windows.open();
    if (command !== 'window.new' && command !== 'tab.new') opened.execute(command);
  }
}

/**
 * The menu bar of macOS, with the browser's settings in the application menu and the tools
 * of the page in the View menu. Its items run the commands of the window, as the keys do, so
 * they act on the page and not on the browser's own views, and the policies apply.
 * @param run - Runs a command in the frontmost window.
 * @param table - The keyboard shortcuts of the windows, which the items show.
 */
export function macMenuBar(
  run: (command: WindowCommand) => void,
  table: ReadonlyMap<string, WindowCommand>,
): Menu {
  const i18n = translatorFor(uiLocale(), process.platform);
  // The window handles the keys itself, also while a page has the focus.
  const command = (
    label: Parameters<typeof i18n.t>[0],
    name: WindowCommand,
  ): Electron.MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(table, name);
    return {
      label: i18n.t(label),
      ...(accelerator === undefined ? {} : { accelerator, registerAccelerator: false }),
      click: () => run(name),
    };
  };
  return Menu.buildFromTemplate([
    {
      role: 'appMenu',
      // Roles name their items in English, so every item gets the text of the catalog.
      submenu: [
        { role: 'about', label: i18n.t('menu.about') },
        { type: 'separator' },
        command('menu.settings', 'settings.open'),
        { type: 'separator' },
        { role: 'services', label: i18n.t('menu.services') },
        { type: 'separator' },
        { role: 'hide', label: i18n.t('menu.hide') },
        { role: 'hideOthers', label: i18n.t('menu.hideOthers') },
        { role: 'unhide', label: i18n.t('menu.showAll') },
        { type: 'separator' },
        { role: 'quit', label: i18n.t('menu.quitApp') },
      ],
    },
    {
      label: i18n.t('menu.file'),
      submenu: [
        command('menu.newTab', 'tab.new'),
        command('menu.newWindow', 'window.new'),
        command('menu.newPrivateWindow', 'window.newPrivate'),
        { type: 'separator' },
        command('menu.savePage', 'page.save'),
        command('menu.print', 'page.print'),
      ],
    },
    {
      label: i18n.t('menu.edit'),
      submenu: [
        { role: 'undo', label: i18n.t('contextMenu.undo') },
        { role: 'redo', label: i18n.t('contextMenu.redo') },
        { type: 'separator' },
        { role: 'cut', label: i18n.t('contextMenu.cut') },
        { role: 'copy', label: i18n.t('contextMenu.copy') },
        { role: 'paste', label: i18n.t('contextMenu.paste') },
        { role: 'selectAll', label: i18n.t('contextMenu.selectAll') },
      ],
    },
    {
      label: i18n.t('menu.view'),
      submenu: [
        command('menu.find', 'find.open'),
        command('menu.downloads', 'downloads.open'),
        { type: 'separator' },
        command('menu.reload', 'page.reload'),
        command('menu.reloadHard', 'page.reloadHard'),
        { type: 'separator' },
        command('menu.actualSize', 'zoom.reset'),
        command('menu.zoomIn', 'zoom.in'),
        command('menu.zoomOut', 'zoom.out'),
        { type: 'separator' },
        command('menu.fullScreen', 'window.fullscreen'),
        { type: 'separator' },
        command('menu.viewSource', 'page.source'),
        command('menu.developerTools', 'devtools.toggle'),
      ],
    },
    {
      role: 'windowMenu',
      label: i18n.t('menu.window'),
      submenu: [
        { role: 'minimize', label: i18n.t('menu.minimize') },
        { role: 'zoom', label: i18n.t('menu.zoomWindow') },
        { type: 'separator' },
        { role: 'front', label: i18n.t('menu.front') },
      ],
    },
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
  const i18n = translatorFor(uiLocale(), process.platform);
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
