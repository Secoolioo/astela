import { app, dialog, Menu } from 'electron';
import { uiLocale } from './ui-language.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import { acceleratorOf, shortcutsOf } from '../shared/menu-shortcuts.ts';
import type { WindowCommand } from '../shared/shortcuts.ts';
import { translatorFor } from './i18n/i18n.ts';

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
 * Runs a command of the menu bar of macOS in the window that was used last. A popover that
 * covers the window closes first, as a shortcut closes it, so that the command acts on the
 * page and the focus goes where the command puts it; the suggestions of the address bar stay.
 * A popover may take the command first, as it takes its shortcut, such as the command palette
 * its own commands. With no window open, a command that opens a window opens only that window,
 * and any other command runs in a new window.
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
    const overlay = front.overlay;
    if (overlay?.coversWindow === true) {
      if (overlay.offer(command)) return;
      overlay.close();
    }
    front.execute(command);
  } else if (command === 'window.newPrivate') {
    openPrivateWindow();
  } else {
    const opened = windows.open();
    if (command !== 'window.new' && command !== 'tab.new') opened.execute(command);
  }
}

/**
 * The menu bar of macOS, with the browser's settings in the application menu and the command
 * palette, tab search, split view, the reader view, picture in picture and the tools of the
 * page in the View menu. Its items run the commands of the window, as the keys do, so they act
 * on the page and not on the browser's own views, and the policies apply.
 * @param run - Runs a command in the frontmost window.
 * @param table - The keyboard shortcuts of the windows, which the items show.
 * @param options - Whether the command palette, split view, the reader view and picture in
 *   picture are on; their items are missing while they are off.
 */
export function macMenuBar(
  run: (command: WindowCommand) => void,
  table: ReadonlyMap<string, WindowCommand>,
  options: {
    readonly palette: boolean;
    readonly splitView?: boolean;
    readonly reader?: boolean;
    readonly pictureInPicture?: boolean;
  } = { palette: true },
): Menu {
  const i18n = translatorFor(uiLocale(), process.platform);
  // The window handles the keys itself, also while a page has the focus.
  const keys = (name: WindowCommand): Electron.MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(table, name);
    return accelerator === undefined ? {} : { accelerator, registerAccelerator: false };
  };
  const command = (
    label: Parameters<typeof i18n.t>[0],
    name: WindowCommand,
  ): Electron.MenuItemConstructorOptions => ({
    label: i18n.t(label),
    ...keys(name),
    click: () => run(name),
  });
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
        // As in every app of macOS, Close Window closes the key window, which can also be one of
        // the developer tools, and a browser window closes as with its close button. With no key
        // window, such as when every window is in the Dock, the item cannot be chosen.
        { role: 'close', label: i18n.t('menu.closeWindow'), ...keys('window.close') },
        { type: 'separator' },
        command('menu.savePage', 'page.save'),
        command('menu.savePdf', 'page.savePdf'),
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
        ...(options.palette
          ? [
              command('menu.commandPalette', 'palette.open'),
              command('menu.searchTabs', 'tabs.search'),
              { type: 'separator' } as const,
            ]
          : []),
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
        ...(options.splitView === false ? [] : [command('menu.splitView', 'split.toggle')]),
        ...(options.reader === false ? [] : [command('menu.readerView', 'reader.toggle')]),
        ...(options.pictureInPicture === false
          ? []
          : [command('menu.pictureInPicture', 'media.pictureInPicture')]),
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
