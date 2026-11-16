import * as v from 'valibot';
import { shortcutPattern, windowCommands } from '../shortcuts.ts';
import { defineEvent, defineRequest } from './contract.ts';
import { OverlayAnchor } from './overlay-anchor.ts';
import { FaviconKey } from './shell-contracts.ts';

/**
 * The content blocker's popover for the active tab: the domain that an exception covers,
 * such as `example.com`, the requests blocked on the page, whether the blocker blocks on
 * the site, whether it is on at all, so that the switch for the site can be used, and
 * whether it has no usable filter data.
 */
const ShieldPopover = v.strictObject({
  kind: v.literal('shield'),
  anchor: OverlayAnchor,
  site: v.pipe(v.string(), v.maxLength(253)),
  blocked: v.pipe(v.number(), v.integer(), v.minValue(0)),
  on: v.boolean(),
  available: v.boolean(),
  failed: v.boolean(),
});

/**
 * A site, or a proxy, that asks for a user name and password: its host, the realm that it
 * names, and whether the connection is encrypted. In a split view, `pane` is the side of the
 * page, over which the question shows; the questions below have it as well.
 */
const LoginPrompt = v.strictObject({
  kind: v.literal('login'),
  host: v.pipe(v.string(), v.maxLength(300)),
  realm: v.pipe(v.string(), v.maxLength(300)),
  proxy: v.boolean(),
  secure: v.boolean(),
  pane: v.optional(OverlayAnchor),
});

/**
 * A site that asks for permissions: the question's number, the site's host with the port if it
 * has one, and what it wants.
 */
const PermissionPrompt = v.strictObject({
  kind: v.literal('permission'),
  id: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  site: v.pipe(v.string(), v.maxLength(300)),
  permissions: v.pipe(
    v.array(v.picklist(['camera', 'microphone', 'location', 'notifications', 'clipboard'])),
    v.minLength(1),
    v.maxLength(5),
  ),
  pane: v.optional(OverlayAnchor),
});

/**
 * A site that wants to see a screen or a window, and the screens and windows to choose from:
 * their names, and small pictures of them as JPEG data URLs, empty when the system has none.
 */
const ScreenPicker = v.strictObject({
  kind: v.literal('screen'),
  site: v.pipe(v.string(), v.maxLength(300)),
  sources: v.pipe(
    v.array(
      v.strictObject({
        id: v.pipe(v.string(), v.maxLength(200)),
        name: v.pipe(v.string(), v.maxLength(500)),
        screen: v.boolean(),
        thumbnail: v.pipe(
          v.string(),
          v.maxLength(400_000),
          v.regex(/^(?:data:image\/jpeg;base64,[A-Za-z0-9+/=]*)?$/),
        ),
      }),
    ),
    v.minLength(1),
    v.maxLength(100),
  ),
  pane: v.optional(OverlayAnchor),
});

/**
 * The list of downloads at its button, newest first: each one's name, where it stands, its
 * bytes, whether it is paused and whether its file is still there.
 */
const DownloadsPanel = v.strictObject({
  kind: v.literal('downloads'),
  anchor: OverlayAnchor,
  items: v.pipe(
    v.array(
      v.strictObject({
        id: v.pipe(v.number(), v.integer(), v.minValue(1)),
        name: v.pipe(v.string(), v.maxLength(1000)),
        state: v.picklist(['progressing', 'completed', 'cancelled', 'interrupted']),
        received: v.pipe(v.number(), v.minValue(0)),
        total: v.pipe(v.number(), v.minValue(0)),
        paused: v.boolean(),
        exists: v.boolean(),
      }),
    ),
    v.maxLength(100),
  ),
});

/**
 * The suggestions of the address bar below it: what Enter would do, open tabs, bookmarks and
 * visited pages, and the one that the arrow keys chose, or -1.
 */
const SuggestionList = v.strictObject({
  kind: v.literal('suggestions'),
  items: v.pipe(
    v.array(
      v.strictObject({
        kind: v.picklist(['search', 'url', 'tab', 'bookmark', 'history']),
        title: v.pipe(v.string(), v.maxLength(1024)),
        url: v.pipe(v.string(), v.maxLength(8192)),
      }),
    ),
    v.maxLength(8),
  ),
  selected: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(7)),
});

/**
 * The text of an item of a menu. On Windows and Linux, `&` marks the access key of the letter
 * after it, and `&&` stands for an `&` of its own; macOS has no access keys.
 */
const MenuLabel = v.pipe(v.string(), v.maxLength(300));
/** The shortcut that an item shows, in the notation of the tables of shortcuts, or none. */
const MenuShortcut = v.nullable(v.pipe(v.string(), v.maxLength(40), v.regex(shortcutPattern)));
/** The icon of an item: bookmarks and folders of the bookmarks bar have one. */
const MenuIcon = v.nullable(v.picklist(['bookmark', 'folder']));

/** An item of a menu that runs something, and whether it can run now. */
const MenuItem = v.strictObject({
  type: v.literal('item'),
  label: MenuLabel,
  shortcut: MenuShortcut,
  enabled: v.boolean(),
  icon: MenuIcon,
});

/** An item of a menu that opens a submenu next to it. */
const MenuSubmenu = v.strictObject({
  type: v.literal('submenu'),
  label: MenuLabel,
  enabled: v.boolean(),
  icon: MenuIcon,
});

/** A line between the groups of a menu. */
const MenuSeparator = v.strictObject({ type: v.literal('separator') });

/** The parts of the zoom row of the browser menu. */
const zoomParts = ['zoomOut', 'reset', 'zoomIn', 'fullScreen'] as const;

/**
 * The zoom row of the browser menu: the zoom of the active tab's page, `null` without a page
 * that zooms, whether it can zoom in and out from there, whether the window is in full screen,
 * and the names and shortcuts of its buttons.
 */
const MenuZoom = v.strictObject({
  type: v.literal('zoom'),
  label: MenuLabel,
  zoom: v.nullable(v.pipe(v.number(), v.minValue(0.25), v.maxValue(5))),
  canZoomIn: v.boolean(),
  canZoomOut: v.boolean(),
  fullScreen: v.boolean(),
  labels: v.strictObject({
    zoomOut: MenuLabel,
    reset: MenuLabel,
    zoomIn: MenuLabel,
    fullScreen: MenuLabel,
  }),
  shortcuts: v.strictObject({
    zoomOut: MenuShortcut,
    reset: MenuShortcut,
    zoomIn: MenuShortcut,
    fullScreen: MenuShortcut,
  }),
});

/** An entry of a menu. */
const MenuEntry = v.variant('type', [MenuItem, MenuSubmenu, MenuSeparator, MenuZoom]);

/**
 * One level of a menu: the menu itself, or a submenu that is open, with the place of the item
 * that opened it in the level before, its name and its entries.
 */
const MenuLevel = v.strictObject({
  parent: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(500)),
  label: MenuLabel,
  items: v.pipe(v.array(MenuEntry), v.maxLength(501)),
});

/**
 * A menu at its button, such as the browser menu or a folder of the bookmarks bar, with its
 * submenus that are open: the edge of the button that it lines up with, `auto` for the end of
 * a button in the right half of the window and the start otherwise, whether the keyboard
 * opened it, so that its first item takes the focus and the access keys show, and whether it
 * is a menu of macOS, which has none.
 */
const MenuPopover = v.strictObject({
  kind: v.literal('menu'),
  anchor: OverlayAnchor,
  align: v.picklist(['start', 'end', 'auto']),
  keyboard: v.boolean(),
  mac: v.boolean(),
  levels: v.pipe(v.array(MenuLevel), v.minLength(1), v.maxLength(21)),
});

/** A menu at its button. */
export type MenuPopover = v.InferOutput<typeof MenuPopover>;
/** One level of a menu. */
export type MenuLevel = v.InferOutput<typeof MenuLevel>;
/** An entry of a menu. */
export type MenuEntry = v.InferOutput<typeof MenuEntry>;
/** A part of the zoom row of the browser menu. */
export type ZoomPart = (typeof zoomParts)[number];

/**
 * The popover of the bookmark star for the page of the active tab: whether the star just added
 * the bookmark, the bookmark's id, name and folder, and the folders to move it to, each with
 * its depth below the bookmarks bar or the other bookmarks.
 */
const BookmarkEditor = v.strictObject({
  kind: v.literal('bookmark'),
  anchor: OverlayAnchor,
  added: v.boolean(),
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  title: v.pipe(v.string(), v.maxLength(1024)),
  folder: v.pipe(v.number(), v.integer(), v.minValue(1)),
  folders: v.pipe(
    v.array(
      v.strictObject({
        id: v.pipe(v.number(), v.integer(), v.minValue(1)),
        title: v.pipe(v.string(), v.maxLength(1024)),
        depth: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20)),
      }),
    ),
    v.minLength(1),
    v.maxLength(500),
  ),
});

/** The popover of the bookmark star. */
export type BookmarkEditor = v.InferOutput<typeof BookmarkEditor>;

/** A command of the window. */
const PaletteCommandId = v.picklist(windowCommands);

/** The name of a row of the settings page, such as `appearance.density`, or of a section. */
const SettingsRowId = v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z0-9.-]{0,63}$/));

/**
 * The command palette, which covers the window: the number of the time it opened, which its
 * requests name, whether it searches everything or the open tabs, the area of the pages that it
 * lies at the top of, whether it runs on macOS, whether the tab strip is at a side, the commands
 * that can run now with their shortcuts, the commands that the palette ran last, and the rows of
 * the settings page whose setting the browser does not offer on this system.
 */
const CommandPalette = v.strictObject({
  kind: v.literal('palette'),
  session: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  scope: v.picklist(['all', 'tabs']),
  area: OverlayAnchor,
  mac: v.boolean(),
  vertical: v.boolean(),
  commands: v.pipe(
    v.array(
      v.strictObject({
        id: PaletteCommandId,
        shortcuts: v.pipe(
          v.array(v.pipe(v.string(), v.maxLength(40), v.regex(shortcutPattern))),
          v.maxLength(4),
        ),
      }),
    ),
    v.maxLength(100),
  ),
  recent: v.pipe(v.array(PaletteCommandId), v.maxLength(5)),
  absent: v.pipe(v.array(SettingsRowId), v.maxLength(100)),
});

/** The command palette. */
export type CommandPalette = v.InferOutput<typeof CommandPalette>;

/** What the overlay shows, or `null` when it is closed. */
// A union rather than a variant: the union is in the bundle of the browser process anyway.
export const OverlayContent = v.nullable(
  v.union([
    ShieldPopover,
    LoginPrompt,
    PermissionPrompt,
    ScreenPicker,
    DownloadsPanel,
    SuggestionList,
    MenuPopover,
    BookmarkEditor,
    CommandPalette,
  ]),
);

/** The content of an open overlay. */
export type OverlayContent = NonNullable<v.InferOutput<typeof OverlayContent>>;

/** Asks for what the overlay shows; the page asks once it has loaded. */
export const GetOverlay = defineRequest({
  channel: 'overlay.get',
  request: v.strictObject({}),
  response: OverlayContent,
  capability: 'overlay',
});

/** Tells the overlay page what to show from now on. */
export const OverlayChanged = defineEvent({
  channel: 'overlay.changed',
  payload: OverlayContent,
  capability: 'overlay',
});

/** Closes the overlay, for example after a click next to the popover. */
export const CloseOverlay = defineRequest({
  channel: 'overlay.close',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/**
 * Tells that what closed has left the page, after the motion of its exit, so the overlay may
 * leave the window.
 */
export const OverlayExited = defineRequest({
  channel: 'overlay.exited',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** A level of an open menu, and a place among its entries. */
const MenuPlace = {
  level: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(20)),
  index: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(500)),
};

/**
 * Chooses an item of the open menu by its place, or a part of its zoom row; `newTab` opens a
 * bookmark in a new tab, as Ctrl or Command with a click or Enter does. The browser process
 * finds what the place stands for in the menu that it sent.
 */
export const ChooseMenuItem = defineRequest({
  channel: 'overlay.chooseMenuItem',
  request: v.strictObject({
    ...MenuPlace,
    part: v.optional(v.picklist(zoomParts)),
    newTab: v.boolean(),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Opens the submenu of an item of the open menu, and closes the submenus after its level. */
export const OpenSubmenu = defineRequest({
  channel: 'overlay.openSubmenu',
  request: v.strictObject(MenuPlace),
  response: v.null(),
  capability: 'overlay',
});

/** Gives the bookmark of the star's popover a name and a folder, and closes the popover. */
export const SaveBookmark = defineRequest({
  channel: 'overlay.saveBookmark',
  request: v.strictObject({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    title: v.pipe(v.string(), v.maxLength(1024)),
    folder: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Removes every bookmark of the page of the star's popover, and closes the popover. */
export const RemoveBookmark = defineRequest({
  channel: 'overlay.removeBookmark',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** Opens a suggestion of the address bar that was clicked, by its place in the list. */
export const ChooseSuggestion = defineRequest({
  channel: 'overlay.chooseSuggestion',
  request: v.strictObject({ index: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(7)) }),
  response: v.null(),
  capability: 'overlay',
});

/** Turns the content blocker off or on for the site of the active tab, and reloads it. */
export const ToggleSiteBlocking = defineRequest({
  channel: 'overlay.toggleSiteBlocking',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** Opens the settings at the row of the content blocker and closes the overlay. */
export const OpenBlockerSettings = defineRequest({
  channel: 'overlay.openBlockerSettings',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** Signs in with the user name and password of the sign-in prompt. */
export const SignIn = defineRequest({
  channel: 'overlay.signIn',
  request: v.strictObject({
    username: v.pipe(v.string(), v.maxLength(1024)),
    password: v.pipe(v.string(), v.maxLength(1024)),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Answers the question of a site for permissions; the answer is kept for the site. */
export const AnswerPermission = defineRequest({
  channel: 'overlay.answerPermission',
  request: v.strictObject({
    id: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    allow: v.boolean(),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Lets the site that asked see the chosen screen or window. */
export const ShareScreen = defineRequest({
  channel: 'overlay.shareScreen',
  request: v.strictObject({ id: v.pipe(v.string(), v.maxLength(200)) }),
  response: v.null(),
  capability: 'overlay',
});

/** Pauses, resumes, cancels, opens, shows, retries or removes a download of the list. */
export const DownloadAction = defineRequest({
  channel: 'overlay.download',
  request: v.strictObject({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    action: v.picklist(['pause', 'resume', 'cancel', 'open', 'folder', 'retry', 'remove']),
  }),
  response: v.null(),
  capability: 'overlay',
});

/** Opens the folder that downloads go to. */
export const OpenDownloadsFolder = defineRequest({
  channel: 'overlay.openDownloadsFolder',
  request: v.strictObject({}),
  response: v.null(),
  capability: 'overlay',
});

/** What the palette looks for: everything, the open tabs, the bookmarks or the history. */
const PaletteScope = v.picklist(['all', 'tabs', 'bookmarks', 'history']);

/**
 * A result of the palette from the browser process: an open tab with the icon of its page,
 * where it is and whether it sleeps, a bookmark, a visited page, a search with the host of its
 * search engine, or an address to open.
 */
const PaletteItem = v.variant('kind', [
  v.strictObject({
    kind: v.literal('tab'),
    title: v.pipe(v.string(), v.maxLength(1024)),
    url: v.pipe(v.string(), v.maxLength(2048)),
    favicon: v.nullable(FaviconKey),
    place: v.picklist(['current', 'window', 'other']),
    sleeping: v.boolean(),
  }),
  v.strictObject({
    kind: v.picklist(['bookmark', 'history']),
    title: v.pipe(v.string(), v.maxLength(1024)),
    url: v.pipe(v.string(), v.maxLength(2048)),
  }),
  v.strictObject({
    kind: v.literal('search'),
    query: v.pipe(v.string(), v.maxLength(200)),
    host: v.pipe(v.string(), v.maxLength(253)),
  }),
  v.strictObject({ kind: v.literal('url'), url: v.pipe(v.string(), v.maxLength(2048)) }),
]);

/** A result of the palette from the browser process. */
export type PaletteItem = v.InferOutput<typeof PaletteItem>;

/**
 * Tells the palette that one of its two shortcuts was pressed while it shows: the shortcut of
 * the scope that shows closes it, the other one switches to its scope.
 */
export const PaletteShortcut = defineEvent({
  channel: 'overlay.paletteShortcut',
  payload: v.picklist(['all', 'tabs']),
  capability: 'overlay',
});

/**
 * Asks the browser process for the open tabs, bookmarks, visited pages and the address or the
 * search that match some text. The answer has a number, which a choice names, and, with the
 * first request after the palette opened, what was typed before its field was ready and
 * whether Enter was pressed then.
 */
export const QueryPalette = defineRequest({
  channel: 'overlay.paletteQuery',
  request: v.strictObject({
    session: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    scope: PaletteScope,
    text: v.pipe(v.string(), v.maxLength(200)),
  }),
  response: v.strictObject({
    answer: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
    typed: v.pipe(v.string(), v.maxLength(200)),
    enter: v.boolean(),
    items: v.pipe(v.array(PaletteItem), v.maxLength(250)),
  }),
  capability: 'overlay',
  ratePerSecond: 60,
});

/** Opens a result of an answer of the palette by its place, and closes the palette. */
export const ChoosePaletteItem = defineRequest({
  channel: 'overlay.paletteChoose',
  request: v.strictObject({
    answer: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    index: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(249)),
  }),
  response: v.null(),
  capability: 'overlay',
});

/**
 * Runs a command of the window from the palette, and closes the palette; the browser process
 * checks again that it can run.
 */
export const RunPaletteCommand = defineRequest({
  channel: 'overlay.paletteRun',
  request: v.strictObject({ command: PaletteCommandId }),
  response: v.null(),
  capability: 'overlay',
});

/** Opens the settings at a row of the settings page, and closes the palette. */
export const OpenPaletteSetting = defineRequest({
  channel: 'overlay.paletteSetting',
  request: v.strictObject({ id: SettingsRowId }),
  response: v.null(),
  capability: 'overlay',
});

/**
 * The icon of the page of an open tab, as a `data:` address, for a tab of a window of the same
 * kind as the palette's; `null` without one.
 */
export const GetPaletteFavicon = defineRequest({
  channel: 'overlay.favicon',
  request: v.strictObject({ key: FaviconKey }),
  response: v.nullable(v.pipe(v.string(), v.startsWith('data:image/'), v.maxLength(200_000))),
  capability: 'overlay',
  ratePerSecond: 250,
});
