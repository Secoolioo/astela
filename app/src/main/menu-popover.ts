import { canRun } from '../domain/commands/availability.ts';
import {
  browserMenu,
  folderLevel,
  folderDepth,
  moreTools,
  toContent,
  zoomCommands,
  type BrowserMenuInput,
  type BrowserMenuText,
  type FolderEntry,
  type ModelLevel,
} from '../domain/menus/browser-menu.ts';
import type {
  BrowserWindowController,
  WindowManager,
} from '../platform/electron/browser-window.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import type { OverlayOptions, WindowOverlay } from '../platform/electron/overlay.ts';
import { bookmarkRoots } from '../shared/bookmarks.ts';
import type { OverlayAnchor, PopoverAnchor } from '../shared/ipc/overlay-anchor.ts';
import {
  ChooseMenuItem,
  OpenSubmenu,
  type OverlayContent,
} from '../shared/ipc/overlay-contracts.ts';
import type { ShellPopover } from '../shared/ipc/shell-contracts.ts';
import type { Translator } from '../shared/i18n/i18n.ts';
import { translatorFor, type MessageKey } from './i18n/i18n.ts';
import {
  existingOverlay,
  focusBackOf,
  overlayBySender,
  overlayOf,
  rectOf,
  track,
  windowOfOverlay,
} from './overlays.ts';
import { uiLocale } from './ui-language.ts';

/** What the menus of the overlay need from the browser process. */
export interface MenuPopoverDependencies {
  readonly windows: WindowManager;
  readonly router: IpcRouter;
  readonly overlay: OverlayOptions;
  /** The bookmarks and folders in a folder of the bookmarks, in their order. */
  readonly folderContents: (folder: number) => readonly FolderEntry[];
}

/** A menu that an overlay shows, with what its entries do. */
interface MenuState {
  readonly menu: 'browser' | 'folder';
  readonly anchor: OverlayAnchor;
  readonly keyboard: boolean;
  levels: readonly ModelLevel[];
}

/** The keys of the texts of the browser menu in the catalogs of the browser process. */
const menuTexts: Readonly<Record<BrowserMenuText, MessageKey>> = {
  menu: 'menu.title',
  newTab: 'menu.newTab',
  newWindow: 'menu.newWindow',
  newPrivateWindow: 'menu.newPrivateWindow',
  zoom: 'menu.zoom',
  zoomOut: 'menu.zoomOut',
  resetZoom: 'menu.actualSize',
  zoomIn: 'menu.zoomIn',
  fullScreen: 'menu.fullScreen',
  history: 'menu.history',
  downloads: 'menu.downloads',
  bookmarks: 'menu.bookmarks',
  find: 'menu.find',
  print: 'menu.print',
  savePage: 'menu.savePage',
  moreTools: 'menu.moreTools',
  viewSource: 'menu.viewSource',
  developerTools: 'menu.developerTools',
  settings: 'menu.settings',
  about: 'menu.about',
  quit: 'menu.quit',
  exit: 'menu.exit',
};

const menus = new WeakMap<WindowOverlay, MenuState>();
let dependencies: MenuPopoverDependencies | undefined;

/**
 * The texts of the browser menu from a catalog of the browser process. macOS has no access
 * keys: the marks that the catalogs of other languages keep for Windows and Linux go, and
 * `&&` stands for an `&`, as the menus of macOS show them.
 * @param i18n - The texts of the browser process, in the language of its menus.
 * @param platform - `process.platform`.
 */
export function menuText(
  i18n: Translator<MessageKey>,
  platform: string,
): (name: BrowserMenuText) => string {
  return platform === 'darwin'
    ? (name) => i18n.t(menuTexts[name]).replace(/&(&?)/g, '$1')
    : (name) => i18n.t(menuTexts[name]);
}

/** The texts of the menus, in the language of the browser's menus. */
function texts(): {
  readonly menu: (name: BrowserMenuText) => string;
  readonly t: (key: MessageKey) => string;
} {
  const i18n = translatorFor(uiLocale(), process.platform);
  return { menu: menuText(i18n, process.platform), t: (key) => i18n.t(key) };
}

/** What the browser menu shows of a window now. */
function inputOf(window: BrowserWindowController): BrowserMenuInput {
  const active = window.tabs.active;
  return {
    platform: process.platform,
    table: window.shortcuts(),
    context: window.commandContext(),
    // Only a page whose view exists zooms; a tab that waits for its view has nothing to zoom.
    zoom: window.activeShowsWebPage && active !== undefined ? active.zoom : null,
    fullScreen: !window.window.isDestroyed() && window.window.isFullScreen(),
  };
}

/**
 * The content of the overlay for a menu. The menu of a folder lines up with the start of its
 * button, as the bookmarks bar reads from the start; the browser menu with the end of its
 * button at the end of the toolbar.
 */
function contentOf(state: MenuState): OverlayContent {
  return {
    kind: 'menu',
    anchor: state.anchor,
    align: state.menu === 'folder' ? 'start' : 'auto',
    keyboard: state.keyboard,
    mac: process.platform === 'darwin',
    levels: toContent(state.levels),
  };
}

/**
 * Shows a menu in the window's overlay. It takes the focus; Escape belongs to the page, which
 * closes an open submenu first, and Alt alone closes the menu, as it closes the menus of the
 * system. A question of a site may take its place.
 */
function show(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  state: MenuState,
  popover: ShellPopover,
  deps: MenuPopoverDependencies,
): void {
  const overlay = overlayOf(window, deps.overlay, deps.router);
  if (dependencies === undefined) connect(deps);
  overlay.open(contentOf(state), {
    popover,
    focusBack: focusBackOf(window, anchor),
    keys: {
      escape: 'page',
      closeOnAlt: true,
      // The shortcut of the browser menu closes a menu, as Alt alone does, and opens none.
      onCommand: (command) => {
        if (command !== 'menu.open') return false;
        overlay.close();
        return true;
      },
    },
    yieldsToQuestions: true,
    onClose: () => {
      if (menus.get(overlay) === state) menus.delete(overlay);
    },
  });
  menus.set(overlay, state);
  track(window, overlay);
}

/**
 * Opens the browser menu of a window at its menu button, in the overlay. The first call
 * connects the channels of the menus.
 * @param window - The window.
 * @param anchor - The menu button, and whether the keyboard opened the menu.
 * @param deps - What the menus need.
 */
export function openBrowserMenu(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  deps: MenuPopoverDependencies,
): void {
  const state: MenuState = {
    menu: 'browser',
    anchor: rectOf(anchor),
    keyboard: anchor.keyboard,
    levels: [browserMenu(inputOf(window), texts().menu)],
  };
  show(window, anchor, state, { kind: 'menu', folder: null }, deps);
}

/**
 * Opens the menu of a folder of the bookmarks bar at its button, in the overlay: its bookmarks
 * and its folders, which open as submenus. The » button opens the bookmarks of the bar that do
 * not fit in it.
 * @param window - The window.
 * @param anchor - The button, and whether the keyboard opened the menu.
 * @param folder - The folder, and how many of its first entries the bookmarks bar shows.
 * @param deps - What the menus need.
 */
export function openFolderMenu(
  window: BrowserWindowController,
  anchor: PopoverAnchor,
  folder: { readonly id: number; readonly from: number },
  deps: MenuPopoverDependencies,
): void {
  const { t } = texts();
  const label =
    folder.id === bookmarkRoots.bar
      ? t('menu.moreBookmarks')
      : (deps.folderContents(bookmarkRoots.bar).find((entry) => entry.id === folder.id)?.title ??
        '');
  const state: MenuState = {
    menu: 'folder',
    anchor: rectOf(anchor),
    keyboard: anchor.keyboard,
    levels: [
      folderLevel(deps.folderContents(folder.id), {
        skip: folder.from,
        label,
        empty: t('menu.emptyFolder'),
        mac: process.platform === 'darwin',
        parent: -1,
        depth: 0,
      }),
    ],
  };
  show(window, anchor, state, { kind: 'folder', folder: folder.id }, deps);
}

/** Makes the levels of an open browser menu again, with its open submenu, for a new state. */
function rebuilt(window: BrowserWindowController, state: MenuState): readonly ModelLevel[] {
  const input = inputOf(window);
  const menu = texts().menu;
  const root = browserMenu(input, menu);
  const tools = root.items.findIndex((entry) => entry.type === 'submenu');
  return state.levels.length > 1 && tools !== -1 ? [root, moreTools(input, menu, tools)] : [root];
}

/** Shows an open browser menu with the state of its window now, if that changed what it shows. */
function refresh(window: BrowserWindowController, overlay: WindowOverlay): void {
  const state = menus.get(overlay);
  if (state?.menu !== 'browser' || overlay.content?.kind !== 'menu') return;
  const levels = rebuilt(window, state);
  const before = JSON.stringify(toContent(state.levels));
  state.levels = levels;
  if (JSON.stringify(toContent(levels)) !== before) overlay.update(contentOf(state));
}

function connect(deps: MenuPopoverDependencies): void {
  dependencies = deps;
  const { router, windows } = deps;
  /** The menu that the page of an overlay shows, with its window. */
  const menuOf = (
    sender: number,
  ): { overlay: WindowOverlay; state: MenuState; window: BrowserWindowController } | undefined => {
    const overlay = overlayBySender(sender);
    const state = overlay === undefined ? undefined : menus.get(overlay);
    const window = overlay === undefined ? undefined : windowOfOverlay(windows.all, overlay);
    if (overlay?.content?.kind !== 'menu' || state === undefined || window === undefined) {
      return undefined;
    }
    return { overlay, state, window };
  };
  router.handle(ChooseMenuItem, ({ level, index, part, newTab }, { sender }) => {
    const open = menuOf(sender.id);
    const entry = open?.state.levels[level]?.items[index];
    if (open === undefined || entry === undefined) return null;
    const { overlay, window } = open;
    if (entry.type === 'zoom') {
      if (part === undefined) return null;
      const command = zoomCommands[part];
      if (part === 'fullScreen') {
        overlay.close();
        window.execute(command);
        return null;
      }
      // The menu stays open while the page zooms, and shows the new zoom.
      const allowed =
        part === 'zoomIn'
          ? entry.canZoomIn
          : part === 'zoomOut'
            ? entry.canZoomOut
            : entry.zoom !== null;
      if (allowed) window.execute(command);
      return null;
    }
    if (entry.type !== 'item' || !entry.enabled || entry.action === null) return null;
    const action = entry.action;
    overlay.close();
    if ('run' in action) {
      // The window may have changed since the menu opened.
      if (canRun(action.run, window.commandContext())) window.execute(action.run);
      return null;
    }
    const active = window.tabs.active;
    if (newTab || active === undefined) window.tabs.open(action.url);
    else window.tabs.navigate(active.id, action.url);
    return null;
  });
  router.handle(OpenSubmenu, ({ level, index }, { sender }) => {
    const open = menuOf(sender.id);
    const entry = open?.state.levels[level]?.items[index];
    if (open === undefined || entry?.type !== 'submenu' || !entry.enabled) return null;
    if (level + 1 > folderDepth) return null;
    const { overlay, state, window } = open;
    const { menu, t } = texts();
    const child =
      'tools' in entry.source
        ? moreTools(inputOf(window), menu, index)
        : folderLevel(deps.folderContents(entry.source.folder), {
            label: entry.source.title,
            empty: t('menu.emptyFolder'),
            mac: process.platform === 'darwin',
            parent: index,
            depth: level + 1,
          });
    state.levels = [...state.levels.slice(0, level + 1), child];
    overlay.update(contentOf(state));
    return null;
  });
  // The zoom row follows the page, at most every 50 ms, and only while a browser menu shows.
  let timer: ReturnType<typeof setTimeout> | undefined;
  windows.onDidChange(() => {
    const showing = windows.all.some((window) => {
      const overlay = existingOverlay(window);
      return overlay !== undefined && menus.get(overlay)?.menu === 'browser';
    });
    if (!showing) return;
    timer ??= setTimeout(() => {
      timer = undefined;
      for (const window of windows.all) {
        const overlay = existingOverlay(window);
        if (overlay !== undefined) refresh(window, overlay);
      }
    }, 50);
  });
}
