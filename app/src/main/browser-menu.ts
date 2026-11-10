import { app, dialog, Menu } from 'electron';
import type { BrowserWindowController } from '../platform/electron/browser-window.ts';
import type { WindowCommand } from '../platform/electron/shortcuts.ts';
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
  const i18n = translatorFor(app.getLocale(), process.platform);
  const mac = process.platform === 'darwin';
  const key = (macKey: string, otherKey: string): string => (mac ? macKey : otherKey);
  const item = (
    label: Parameters<typeof i18n.t>[0],
    command: WindowCommand,
    accelerator?: string,
  ): Electron.MenuItemConstructorOptions => ({
    label: i18n.t(label),
    ...(accelerator === undefined ? {} : { accelerator, registerAccelerator: false }),
    click: () => window.execute(command),
  });
  const menu = Menu.buildFromTemplate([
    item('menu.newTab', 'tab.new', key('Cmd+T', 'Ctrl+T')),
    item('menu.newWindow', 'window.new', key('Cmd+N', 'Ctrl+N')),
    ...(options.privateWindows
      ? [item('menu.newPrivateWindow', 'window.newPrivate', key('Shift+Cmd+N', 'Ctrl+Shift+N'))]
      : []),
    { type: 'separator' },
    item('menu.history', 'history.open', key('Cmd+Y', 'Ctrl+H')),
    item('menu.downloads', 'downloads.open', key('Alt+Cmd+L', 'Ctrl+J')),
    item('menu.bookmarks', 'bookmarks.open', key('Shift+Cmd+O', 'Ctrl+Shift+O')),
    { type: 'separator' },
    {
      label: i18n.t('menu.zoom'),
      submenu: [
        item('menu.zoomIn', 'zoom.in', key('Cmd+Plus', 'Ctrl+Plus')),
        item('menu.zoomOut', 'zoom.out', key('Cmd+-', 'Ctrl+-')),
        item('menu.actualSize', 'zoom.reset', key('Cmd+0', 'Ctrl+0')),
        { type: 'separator' },
        item('menu.fullScreen', 'window.fullscreen', key('Ctrl+Cmd+F', 'F11')),
      ],
    },
    item('menu.find', 'find.open', key('Cmd+F', 'Ctrl+F')),
    item('menu.print', 'page.print', key('Cmd+P', 'Ctrl+P')),
    item('menu.savePage', 'page.save', key('Cmd+S', 'Ctrl+S')),
    {
      label: i18n.t('menu.moreTools'),
      submenu: [
        item('menu.viewSource', 'page.source', key('Alt+Cmd+U', 'Ctrl+U')),
        item('menu.developerTools', 'devtools.toggle', key('Alt+Cmd+I', 'F12')),
      ],
    },
    { type: 'separator' },
    item('menu.settings', 'settings.open', mac ? 'Cmd+,' : undefined),
    { label: i18n.t('menu.about'), click: () => showAbout(window) },
    {
      label: i18n.t(process.platform === 'win32' ? 'menu.exit' : 'menu.quit'),
      ...(mac ? { accelerator: 'Cmd+Q', registerAccelerator: false } : {}),
      click: () => app.quit(),
    },
  ]);
  menu.popup({ window: window.window, x: position.x, y: position.y });
}

/**
 * Tells the version of the browser and of what it is built on.
 * @param window - The window whose menu asked.
 */
function showAbout(window: BrowserWindowController): void {
  const i18n = translatorFor(app.getLocale(), process.platform);
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
    {
      label: i18n.t('menu.file'),
      submenu: [
        command('menu.newTab', 'Cmd+T', 'tab.new'),
        command('menu.newWindow', 'Cmd+N', 'window.new'),
        command('menu.newPrivateWindow', 'Shift+Cmd+N', 'window.newPrivate'),
        { type: 'separator' },
        command('menu.savePage', 'Cmd+S', 'page.save'),
        command('menu.print', 'Cmd+P', 'page.print'),
      ],
    },
    { role: 'editMenu' },
    {
      label: i18n.t('menu.view'),
      submenu: [
        command('menu.find', 'Cmd+F', 'find.open'),
        command('menu.downloads', 'Alt+Cmd+L', 'downloads.open'),
        { type: 'separator' },
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
