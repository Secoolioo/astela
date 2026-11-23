import { app, dialog, Menu } from 'electron';
import { uiLocale } from './ui-language.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import { acceleratorOf, shortcutsOf } from '../shared/menu-shortcuts.ts';
import type { WindowCommand } from '../shared/shortcuts.ts';
import type { PolicyService } from '../domain/policy/policy-service.ts';
import type { UpdateController } from '../domain/updates/update-controller.ts';
import type { UpdateState } from '../domain/updates/update-service.ts';
import type { Disposable } from '../shared/disposable.ts';
import type { Translator } from '../shared/i18n/i18n.ts';
import { translatorFor, type MessageKey } from './i18n/i18n.ts';

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

/** What About shows of the updates and the check that it can start. */
export type AboutUpdates = Pick<UpdateController, 'state' | 'check' | 'onDidChange'>;

/**
 * The reasons of the codes of a failed check, those of the signed feed; every other code, such
 * as one of electron-updater or of the network, gets a reason of its own.
 */
const failureReasons: ReadonlyMap<string, MessageKey> = new Map([
  ['unavailable', 'dialog.updateFailedUnavailable'],
  ['signature', 'dialog.updateFailedSignature'],
  ['expired', 'dialog.updateFailedExpired'],
  ['rollback', 'dialog.updateFailedRollback'],
  ['invalid', 'dialog.updateFailedInvalid'],
  ['mismatch', 'dialog.updateFailedMismatch'],
  ['no-artifact', 'dialog.updateFailedNoArtifact'],
]);

/**
 * The line of About on the updates, in the language of the browser.
 * @param i18n - The translator.
 * @param state - The state of the updates.
 */
function updateLine(i18n: Translator<MessageKey>, state: UpdateState): string {
  const name = app.getName();
  if (state.kind === 'disabled') {
    return i18n.t(
      state.reason === 'policy'
        ? 'dialog.updatesOffByPolicy'
        : state.reason === 'install-type'
          ? 'dialog.updatesFromSystem'
          : 'dialog.updatesNoKeys',
    );
  }
  if (state.kind === 'idle') {
    if (state.lastCheckAt === undefined) return i18n.t('dialog.updatesNotChecked', { name });
    const time = new Intl.DateTimeFormat(uiLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(state.lastCheckAt);
    return i18n.t('dialog.updatesUpToDate', { name, time });
  }
  if (state.kind === 'checking') return i18n.t('dialog.updatesChecking');
  if (state.kind === 'downloading') {
    return i18n.t('dialog.updatesDownloading', {
      version: state.version,
      percent: String(state.percent),
    });
  }
  if (state.kind === 'ready')
    return i18n.t('dialog.updatesReady', { version: state.version, name });
  // The message of the error is for the log, in English; About tells the reason of its code.
  return i18n.t('dialog.updatesFailed', {
    reason: i18n.t(failureReasons.get(state.code) ?? 'dialog.updateFailedOther'),
  });
}

/** The windows that show About now, and the key of an About without a window. */
const showingAbout = new WeakSet<object>();
const withoutWindow = {};

/**
 * Tells the version of the browser and of what it is built on, and the state of the updates.
 * A window shows one About at a time. While nothing runs, About offers to check for updates,
 * which a policy that wants updates only on request needs; a check shows About again at once,
 * which says that it checks and shows again with the answer as soon as there is one.
 * @param window - The window whose menu or shortcut asked; without one, as from the menu bar
 *   of macOS while no window is open, About shows on its own.
 * @param updates - The updates, once they have started after the first window.
 */
export function showAbout(
  window: BrowserWindowController | undefined,
  updates?: AboutUpdates,
): void {
  const parent = window?.window;
  const key = parent ?? withoutWindow;
  if (showingAbout.has(key)) return;
  showingAbout.add(key);
  const i18n = translatorFor(uiLocale(), process.platform);
  const state = updates?.state;
  const offersCheck = state?.kind === 'idle' || state?.kind === 'failed';
  // A message box cannot change, so the answer of a check closes it and shows About again. On
  // macOS, a box without a window cannot be closed so; the answer shows once it is closed.
  const answered = new AbortController();
  let listener: Disposable | undefined;
  if (state?.kind === 'checking') {
    listener = updates?.onDidChange((next) => {
      if (next.kind !== 'checking') answered.abort();
    });
  }
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    message: i18n.t('dialog.about', { name: app.getName(), version: app.getVersion() }),
    detail: [
      ...(state === undefined ? [] : [updateLine(i18n, state), '']),
      `Electron ${process.versions.electron}`,
      `Chromium ${process.versions.chrome}`,
      `Node.js ${process.versions.node}`,
    ].join('\n'),
    signal: answered.signal,
    ...(offersCheck
      ? {
          buttons: [i18n.t('dialog.ok'), i18n.t('dialog.checkForUpdates')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        }
      : {}),
  };
  void (
    parent === undefined ? dialog.showMessageBox(options) : dialog.showMessageBox(parent, options)
  ).then(({ response }) => {
    listener?.dispose();
    showingAbout.delete(key);
    if (parent?.isDestroyed() === true || updates === undefined) return;
    if (answered.signal.aborted) {
      showAbout(window, updates);
    } else if (offersCheck && response === 1) {
      // The check says so at once, so About shows that it checks.
      void updates.check();
      showAbout(window, updates);
    }
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
 * About shows on its own, and any other command runs in a new window.
 * @param windows - The browser's windows.
 * @param command - The command.
 * @param openPrivateWindow - Opens a private window, if people may.
 * @param updates - The updates, once they have started, which About shows without a window.
 */
export function runFromMenuBar(
  windows: Pick<WindowManager, 'lastUsed' | 'open'>,
  command: WindowCommand,
  openPrivateWindow: () => void,
  updates: () => AboutUpdates | undefined,
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
  } else if (command === 'app.about') {
    showAbout(undefined, updates());
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
 *   picture are on; their items are missing while they are off. The policies, which can turn
 *   private windows and the developer tools off; their items are greyed out then, as in Chrome,
 *   and the table has no shortcut for them.
 */
export function macMenuBar(
  run: (command: WindowCommand) => void,
  table: ReadonlyMap<string, WindowCommand>,
  options: {
    readonly palette: boolean;
    readonly splitView?: boolean;
    readonly reader?: boolean;
    readonly pictureInPicture?: boolean;
    readonly policies?: Pick<PolicyService, 'getMandatory'>;
  } = { palette: true },
): Menu {
  const i18n = translatorFor(uiLocale(), process.platform);
  const privateWindows = options.policies?.getMandatory('PrivateModeAvailability')?.value !== 1;
  const developerTools = options.policies?.getMandatory('DeveloperToolsAvailability')?.value !== 2;
  // The window handles the keys itself, also while a page has the focus.
  const keys = (name: WindowCommand): Electron.MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(table, name);
    return accelerator === undefined ? {} : { accelerator, registerAccelerator: false };
  };
  const command = (
    label: Parameters<typeof i18n.t>[0],
    name: WindowCommand,
    enabled = true,
  ): Electron.MenuItemConstructorOptions => ({
    label: i18n.t(label),
    ...keys(name),
    ...(enabled ? {} : { enabled }),
    click: () => run(name),
  });
  return Menu.buildFromTemplate([
    {
      role: 'appMenu',
      // Roles name their items in English, so every item gets the text of the catalog.
      submenu: [
        // About shows the state of the updates and can start a check, as the browser menu's.
        command('menu.about', 'app.about'),
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
        command('menu.newPrivateWindow', 'window.newPrivate', privateWindows),
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
        command('menu.developerTools', 'devtools.toggle', developerTools),
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
