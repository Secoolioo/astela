import type { MenuEntry, MenuLevel, ZoomPart } from '../../shared/ipc/overlay-contracts.ts';
import { shortcutsOf, systemShortcutsOf } from '../../shared/menu-shortcuts.ts';
import type { WindowCommand } from '../../shared/shortcuts.ts';
import { zoomFactors } from '../../shared/zoom.ts';
import { canRun, type CommandContext } from '../commands/availability.ts';

/** What an item of a menu does, which the overlay's page never learns. */
export type ItemAction =
  | { readonly run: WindowCommand }
  | { readonly url: string }
  /** The item only tells something, such as that a folder is empty. */
  | null;

/** What a submenu shows: more tools of the page, or the contents of a folder of bookmarks. */
export type SubmenuSource =
  { readonly tools: 'more' } | { readonly folder: number; readonly title: string };

/** An entry of a menu, with what it does. */
export type ModelEntry =
  | (Extract<MenuEntry, { type: 'item' }> & { readonly action: ItemAction })
  | (Extract<MenuEntry, { type: 'submenu' }> & { readonly source: SubmenuSource })
  | Extract<MenuEntry, { type: 'separator' | 'zoom' }>;

/** One level of a menu, with what its entries do. */
export interface ModelLevel {
  /** The place of the item in the level before that opened this one; -1 for the menu itself. */
  readonly parent: number;
  readonly label: string;
  readonly items: readonly ModelEntry[];
}

/** The texts of the browser menu, as the browser process names them in its catalogs. */
export type BrowserMenuText =
  | 'menu'
  | 'newTab'
  | 'newWindow'
  | 'newPrivateWindow'
  | 'closeWindow'
  | 'zoom'
  | 'zoomOut'
  | 'resetZoom'
  | 'zoomIn'
  | 'fullScreen'
  | 'history'
  | 'downloads'
  | 'bookmarks'
  | 'commandPalette'
  | 'searchTabs'
  | 'find'
  | 'readerView'
  | 'pictureInPicture'
  | 'print'
  | 'savePage'
  | 'savePdf'
  | 'moreTools'
  | 'viewSource'
  | 'developerTools'
  | 'settings'
  | 'about'
  | 'quit'
  | 'exit';

/** What the browser menu shows of a window. */
export interface BrowserMenuInput {
  /** `process.platform`: Windows exits, the others quit, and macOS shows Command+Q. */
  readonly platform: string;
  /** The shortcuts of the window, which the items show. */
  readonly table: ReadonlyMap<string, WindowCommand>;
  /** What decides which commands can run in the window now. */
  readonly context: CommandContext;
  /** The zoom of the active tab's page, or `null` without a page that zooms. */
  readonly zoom: number | null;
  /** Whether the window is in full screen. */
  readonly fullScreen: boolean;
}

/** The command of each part of the zoom row. */
export const zoomCommands: Readonly<Record<ZoomPart, WindowCommand>> = {
  zoomOut: 'zoom.out',
  reset: 'zoom.reset',
  zoomIn: 'zoom.in',
  fullScreen: 'window.fullscreen',
};

/**
 * The shortcut that the item of a command shows: its first one in the window, or else the one
 * that the system gives it, such as Command+Q on macOS.
 */
function shortcutFor(input: BrowserMenuInput, command: WindowCommand): string | null {
  return (
    shortcutsOf(input.table, command)[0] ?? systemShortcutsOf(input.platform, command)[0] ?? null
  );
}

/**
 * An item that runs a command, which can be chosen while the command can run; an item that
 * turns something on and off says whether it is on.
 */
function commandItem(
  input: BrowserMenuInput,
  text: (name: BrowserMenuText) => string,
  name: BrowserMenuText,
  run: WindowCommand,
  checked?: boolean,
): ModelEntry {
  return {
    type: 'item',
    label: text(name),
    shortcut: shortcutFor(input, run),
    enabled: canRun(run, input.context),
    icon: null,
    ...(checked === undefined ? {} : { checked }),
    action: { run },
  };
}

const separator: ModelEntry = { type: 'separator' };

/**
 * The browser menu of a window: new tabs and windows, the zoom row, the history, downloads and
 * bookmarks, the command palette and tab search, the tools of the page with a submenu for more
 * of them, the settings, About and Quit, which Windows calls Exit. Items whose command cannot
 * run now, such as the page tools on the browser's own pages, cannot be chosen; New private
 * window is missing when a policy forbids private windows, the palette's items while the
 * palette is off, and the items of the reader view and of picture in picture while they are
 * off. They have a check mark while the reader view shows, or a video of the page shows in
 * picture in picture.
 * @param input - The window, its shortcuts and its zoom.
 * @param text - The texts of the items, in the language of the menus.
 */
export function browserMenu(
  input: BrowserMenuInput,
  text: (name: BrowserMenuText) => string,
): ModelLevel {
  const item = (name: BrowserMenuText, run: WindowCommand): ModelEntry =>
    commandItem(input, text, name, run);
  const { zoom, context } = input;
  const zooms = zoom !== null;
  // The items of the reader view and of picture in picture have a check mark while they show.
  const active = context.tabs[context.activeIndex];
  const reader = context.reader
    ? [commandItem(input, text, 'readerView', 'reader.toggle', active?.reader === 'open')]
    : [];
  const pictureInPicture = context.pictureInPicture
    ? [
        commandItem(
          input,
          text,
          'pictureInPicture',
          'media.pictureInPicture',
          active?.pictureInPicture === 'open',
        ),
      ]
    : [];
  const smallest = zoomFactors[0] ?? 0.25;
  const largest = zoomFactors.at(-1) ?? 5;
  const zoomRow: ModelEntry = {
    type: 'zoom',
    label: text('zoom'),
    zoom,
    canZoomOut: zooms && zoom > smallest + 0.001 && canRun('zoom.out', context),
    canZoomIn: zooms && zoom < largest - 0.001 && canRun('zoom.in', context),
    fullScreen: input.fullScreen,
    labels: {
      zoomOut: text('zoomOut'),
      reset: text('resetZoom'),
      zoomIn: text('zoomIn'),
      fullScreen: text('fullScreen'),
    },
    shortcuts: {
      zoomOut: shortcutFor(input, zoomCommands.zoomOut),
      reset: shortcutFor(input, zoomCommands.reset),
      zoomIn: shortcutFor(input, zoomCommands.zoomIn),
      fullScreen: shortcutFor(input, zoomCommands.fullScreen),
    },
  };
  return {
    parent: -1,
    label: text('menu'),
    items: [
      item('newTab', 'tab.new'),
      item('newWindow', 'window.new'),
      ...(context.privateWindows ? [item('newPrivateWindow', 'window.newPrivate')] : []),
      item('closeWindow', 'window.close'),
      separator,
      zoomRow,
      separator,
      item('history', 'history.open'),
      item('downloads', 'downloads.open'),
      item('bookmarks', 'bookmarks.open'),
      separator,
      ...(context.palette
        ? [item('commandPalette', 'palette.open'), item('searchTabs', 'tabs.search'), separator]
        : []),
      item('find', 'find.open'),
      ...reader,
      ...pictureInPicture,
      item('print', 'page.print'),
      item('savePage', 'page.save'),
      {
        type: 'submenu',
        label: text('moreTools'),
        enabled: true,
        icon: null,
        source: { tools: 'more' },
      },
      separator,
      item('settings', 'settings.open'),
      item('about', 'app.about'),
      item(input.platform === 'win32' ? 'exit' : 'quit', 'app.quit'),
    ],
  };
}

/**
 * The submenu with more tools of the page: its source and the developer tools, which are
 * missing when a policy keeps them closed.
 * @param input - The window and its shortcuts.
 * @param text - The texts of the items.
 * @param parent - The place of the item that opens the submenu.
 */
export function moreTools(
  input: BrowserMenuInput,
  text: (name: BrowserMenuText) => string,
  parent: number,
): ModelLevel {
  return {
    parent,
    label: text('moreTools'),
    items: [
      commandItem(input, text, 'savePdf', 'page.savePdf'),
      commandItem(input, text, 'viewSource', 'page.source'),
      ...(input.context.developerTools
        ? [commandItem(input, text, 'developerTools', 'devtools.toggle')]
        : []),
    ],
  };
}

/** A bookmark or a folder in a folder of the bookmarks; folders have no address. */
export interface FolderEntry {
  readonly id: number;
  readonly title: string;
  readonly url: string | null;
}

/** At most this many bookmarks and folders appear in one level of a menu. */
export const folderLimit = 500;
/** Submenus of folders open at most this deep below the menu itself. */
export const folderDepth = 20;
/** At most this many characters of a title show in a menu. */
export const labelLimit = 300;

/**
 * The text of a title in a menu: as it is on macOS, and elsewhere with each `&` doubled, so
 * that it shows and marks no access key; long titles are cut.
 * @param title - The title.
 * @param mac - Whether the menu is one of macOS.
 */
export function titleLabel(title: string, mac: boolean): string {
  const label = mac ? title : title.replaceAll('&', '&&');
  if (label.length <= labelLimit) return label;
  const cut = label.slice(0, labelLimit);
  // A cut between the two marks of an & would leave a mark of an access key.
  const marks = /&+$/.exec(cut)?.[0].length ?? 0;
  return !mac && marks % 2 === 1 ? cut.slice(0, -1) : cut;
}

/**
 * One level of the menu of a folder of bookmarks: its bookmarks, which open, and its folders,
 * which open as submenus down to {@link folderDepth} levels, at most {@link folderLimit} of
 * them; an empty folder says so with an item that cannot be chosen.
 * @param entries - The bookmarks and folders of the folder, in their order.
 * @param options - How many of the first entries to leave out, as the bookmarks bar shows them
 *   already; the name of the level and the text of an empty folder; whether the menu is one of
 *   macOS; the place of the item that opens the level and how deep the level is.
 */
export function folderLevel(
  entries: readonly FolderEntry[],
  options: {
    readonly skip?: number;
    readonly label: string;
    readonly empty: string;
    readonly mac: boolean;
    readonly parent: number;
    readonly depth: number;
  },
): ModelLevel {
  const skip = options.skip ?? 0;
  const shown = entries.slice(skip, skip + folderLimit);
  const items = shown.map((entry): ModelEntry => {
    if (entry.url === null) {
      return {
        type: 'submenu',
        label: titleLabel(entry.title, options.mac),
        enabled: options.depth < folderDepth,
        icon: 'folder',
        source: { folder: entry.id, title: entry.title },
      };
    }
    return {
      type: 'item',
      label: titleLabel(entry.title || entry.url, options.mac),
      shortcut: null,
      enabled: true,
      icon: 'bookmark',
      action: { url: entry.url },
    };
  });
  return {
    parent: options.parent,
    label: titleLabel(options.label, options.mac),
    items:
      items.length > 0
        ? items
        : [
            {
              type: 'item',
              label: options.empty,
              shortcut: null,
              enabled: false,
              icon: null,
              action: null,
            },
          ],
  };
}

/**
 * The levels of a menu as the overlay's page gets them: without what their entries do, so the
 * page names places in the menu and the browser process finds what they stand for.
 * @param levels - The levels of the menu.
 */
export function toContent(levels: readonly ModelLevel[]): MenuLevel[] {
  return levels.map(({ parent, label, items }) => ({
    parent,
    label,
    items: items.map((entry): MenuEntry => {
      if (entry.type === 'item') {
        const { action: _action, ...shown } = entry;
        return shown;
      }
      if (entry.type === 'submenu') {
        const { source: _source, ...shown } = entry;
        return shown;
      }
      return entry;
    }),
  }));
}
