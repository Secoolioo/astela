/**
 * Commands that keyboard shortcuts run in a window, also while web content has focus, in the
 * order in which the settings page lists them. The menus run them too. Some, such as
 * duplicating a tab, have no default shortcut; people can give them one.
 */
export const windowCommands = [
  'tab.new',
  'window.new',
  'window.newPrivate',
  'tab.close',
  'tab.reopen',
  'tab.duplicate',
  'tab.closeOthers',
  'tab.closeRight',
  // After the commands that close tabs: the command palette lists equal matches in this order,
  // and closing a tab can be undone.
  'window.close',
  'tab.next',
  'tab.previous',
  'tab.select1',
  'tab.select2',
  'tab.select3',
  'tab.select4',
  'tab.select5',
  'tab.select6',
  'tab.select7',
  'tab.select8',
  'tab.selectLast',
  'tab.moveLeft',
  'tab.moveRight',
  'tab.pin',
  'tab.mute',
  'split.toggle',
  'split.swap',
  'tab.newGroup',
  'workspace.select1',
  'workspace.select2',
  'workspace.select3',
  'workspace.select4',
  'workspace.select5',
  'workspace.select6',
  'workspace.select7',
  'workspace.select8',
  'workspace.select9',
  'workspace.next',
  'workspace.previous',
  'workspace.open',
  'page.back',
  'page.forward',
  'page.reload',
  'page.reloadHard',
  'page.home',
  'omnibox.focus',
  'focus.nextPane',
  'focus.previousPane',
  'palette.open',
  'tabs.search',
  'menu.open',
  'find.open',
  'find.next',
  'find.previous',
  'zoom.in',
  'zoom.out',
  'zoom.reset',
  'window.fullscreen',
  'reader.toggle',
  'media.pictureInPicture',
  'bookmark.toggle',
  'bookmarks.open',
  'bookmarks.toggleBar',
  'toolbar.toggleAutoHide',
  'history.open',
  'downloads.open',
  'settings.open',
  'page.print',
  'page.save',
  'page.savePdf',
  'page.source',
  'devtools.toggle',
  'app.about',
  'app.quit',
] as const;

/** A command that a keyboard shortcut runs in a window. */
export type WindowCommand = (typeof windowCommands)[number];

// The tables write a key press as `Modifiers+Key`: the modifiers in the order Ctrl, Alt,
// Shift, Cmd (the meta key: Command on macOS, Windows or Super elsewhere), then the key as
// `KeyboardEvent.key` names it, letters in upper case. The browser process sees each key
// before the page and cannot tell whether a text field has focus, so no shortcut may be a
// key that edits text.

/**
 * The modifier and 1 to 8 for the tabs at those places, and 9 for the last tab.
 * @param modifier - `Cmd` on macOS, `Ctrl` elsewhere.
 */
function selectShortcuts(modifier: 'Cmd' | 'Ctrl'): (readonly [string, WindowCommand])[] {
  const places = [1, 2, 3, 4, 5, 6, 7, 8] as const;
  return [
    ...places.map((place) => [`${modifier}+${place}`, `tab.select${place}`] as const),
    [`${modifier}+9`, 'tab.selectLast'],
  ];
}

/**
 * The modifier and 1 to 9 for the workspaces at those places: the keys that carry the digits in
 * the top row of the keyboard, also where a layout types other characters on them.
 * @param modifier - `Ctrl` on macOS, where Option types characters, `Alt` elsewhere, as Windows
 *   reports AltGr as Ctrl and Alt.
 */
function workspaceShortcuts(modifier: 'Ctrl' | 'Alt'): (readonly [string, WindowCommand])[] {
  const places = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
  return places.map((place) => [`${modifier}+${place}`, `workspace.select${place}`] as const);
}

/**
 * macOS. Cmd+Left and Cmd+Right are left out on purpose: they move the caret to the start
 * and the end of a line. Cmd+Tab belongs to the app switcher of the system.
 */
const macShortcuts: readonly (readonly [string, WindowCommand])[] = [
  ['Cmd+T', 'tab.new'],
  ['Cmd+N', 'window.new'],
  ['Shift+Cmd+N', 'window.newPrivate'],
  ['Cmd+W', 'tab.close'],
  ['Shift+Cmd+W', 'window.close'],
  ['Shift+Cmd+T', 'tab.reopen'],
  ['Ctrl+Tab', 'tab.next'],
  ['Alt+Cmd+ArrowRight', 'tab.next'],
  ['Shift+Cmd+]', 'tab.next'],
  ['Ctrl+Shift+Tab', 'tab.previous'],
  ['Alt+Cmd+ArrowLeft', 'tab.previous'],
  ['Shift+Cmd+[', 'tab.previous'],
  ...selectShortcuts('Cmd'),
  ...workspaceShortcuts('Ctrl'),
  ['Cmd+R', 'page.reload'],
  ['Shift+Cmd+H', 'page.home'],
  ['Shift+Cmd+R', 'page.reloadHard'],
  ['Cmd+[', 'page.back'],
  ['Cmd+]', 'page.forward'],
  ['Cmd+L', 'omnibox.focus'],
  ['Cmd+K', 'palette.open'],
  ['Shift+Cmd+A', 'tabs.search'],
  ['Cmd+,', 'settings.open'],
  ['Cmd+Y', 'history.open'],
  ['Alt+Cmd+L', 'downloads.open'],
  ['Cmd+D', 'bookmark.toggle'],
  ['Shift+Cmd+O', 'bookmarks.open'],
  ['Shift+Cmd+B', 'bookmarks.toggleBar'],
  ['Cmd+F', 'find.open'],
  ['Cmd+G', 'find.next'],
  ['Shift+Cmd+G', 'find.previous'],
  ['Cmd++', 'zoom.in'],
  ['Cmd+=', 'zoom.in'],
  ['Shift+Cmd++', 'zoom.in'],
  ['Cmd+-', 'zoom.out'],
  ['Cmd+0', 'zoom.reset'],
  ['Ctrl+Cmd+F', 'window.fullscreen'],
  ['Alt+Cmd+R', 'reader.toggle'],
  // Shift+Cmd+S stays free: it means Save As.
  ['Ctrl+Cmd+S', 'split.toggle'],
  ['Cmd+P', 'page.print'],
  ['Cmd+S', 'page.save'],
  ['Alt+Cmd+U', 'page.source'],
  ['Alt+Cmd+I', 'devtools.toggle'],
];

/**
 * Windows and Linux. No shortcut combines Ctrl and Alt: Windows reports AltGr, which types
 * characters on many layouts, as Ctrl+Alt. The Back and Forward keys of some keyboards
 * arrive as key presses.
 */
const pcShortcuts: readonly (readonly [string, WindowCommand])[] = [
  ['Ctrl+T', 'tab.new'],
  ['Ctrl+N', 'window.new'],
  ['Ctrl+Shift+N', 'window.newPrivate'],
  ['Ctrl+W', 'tab.close'],
  ['Ctrl+F4', 'tab.close'],
  ['Ctrl+Shift+W', 'window.close'],
  ['Ctrl+Shift+T', 'tab.reopen'],
  ['Ctrl+Tab', 'tab.next'],
  ['Ctrl+PageDown', 'tab.next'],
  ['Ctrl+Shift+Tab', 'tab.previous'],
  ['Ctrl+PageUp', 'tab.previous'],
  ...selectShortcuts('Ctrl'),
  ['Ctrl+Shift+PageUp', 'tab.moveLeft'],
  ['Ctrl+Shift+PageDown', 'tab.moveRight'],
  ['Ctrl+Shift+S', 'split.toggle'],
  ...workspaceShortcuts('Alt'),
  ['F5', 'page.reload'],
  ['Alt+Home', 'page.home'],
  ['Ctrl+R', 'page.reload'],
  ['Ctrl+F5', 'page.reloadHard'],
  ['Shift+F5', 'page.reloadHard'],
  ['Ctrl+Shift+R', 'page.reloadHard'],
  ['Alt+ArrowLeft', 'page.back'],
  ['BrowserBack', 'page.back'],
  ['Alt+ArrowRight', 'page.forward'],
  ['BrowserForward', 'page.forward'],
  ['Ctrl+L', 'omnibox.focus'],
  ['Alt+D', 'omnibox.focus'],
  // The address bar and the page take turns, as the panes of a window do in other programs.
  ['F6', 'focus.nextPane'],
  ['Shift+F6', 'focus.previousPane'],
  ['Ctrl+K', 'palette.open'],
  ['Ctrl+Shift+A', 'tabs.search'],
  // The menu of the window, as F10 opens it in other programs of Windows and Linux.
  ['F10', 'menu.open'],
  ['Ctrl+H', 'history.open'],
  ['Ctrl+J', 'downloads.open'],
  ['Ctrl+D', 'bookmark.toggle'],
  ['Ctrl+Shift+O', 'bookmarks.open'],
  ['Ctrl+Shift+B', 'bookmarks.toggleBar'],
  ['Ctrl+F', 'find.open'],
  ['F3', 'find.next'],
  ['Ctrl+G', 'find.next'],
  ['Shift+F3', 'find.previous'],
  ['Ctrl+Shift+G', 'find.previous'],
  ['Ctrl++', 'zoom.in'],
  ['Ctrl+=', 'zoom.in'],
  ['Ctrl+Shift++', 'zoom.in'],
  ['Ctrl+-', 'zoom.out'],
  ['Ctrl+0', 'zoom.reset'],
  ['F11', 'window.fullscreen'],
  ['F9', 'reader.toggle'],
  ['Ctrl+P', 'page.print'],
  ['Ctrl+S', 'page.save'],
  ['Ctrl+U', 'page.source'],
  ['F12', 'devtools.toggle'],
  ['Ctrl+Shift+I', 'devtools.toggle'],
];

/**
 * The default shortcuts of a system, with their commands. A command can have several, and
 * some commands have none.
 * @param platform - `process.platform`.
 */
export function defaultShortcuts(platform: string): readonly (readonly [string, WindowCommand])[] {
  return platform === 'darwin' ? macShortcuts : pcShortcuts;
}

/** The shortcuts that people chose, by command; an empty list leaves a command without one. */
export type ShortcutOverrides = Readonly<Partial<Record<WindowCommand, readonly string[]>>>;

/** A key press in the notation of the tables: modifiers in a fixed order, then the key. */
export const shortcutPattern = /^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Cmd\+)?[^\s]{1,24}$/;

/** The commands of the command palette, which have no shortcut while the palette is off. */
export const paletteCommands: readonly WindowCommand[] = ['palette.open', 'tabs.search'];

/** The command of the reader view, which has no shortcut while the reader view is off. */
export const readerCommands: readonly WindowCommand[] = ['reader.toggle'];

/**
 * The command of picture in picture, which has no shortcut of its own by default, and none that
 * people gave it while picture in picture is off.
 */
export const pictureInPictureCommands: readonly WindowCommand[] = ['media.pictureInPicture'];

/** The commands of split view, which have no shortcut while split view is off. */
export const splitCommands: readonly WindowCommand[] = ['split.toggle', 'split.swap'];

/** The commands of the workspaces, which have no shortcut while workspaces are off. */
export const workspaceCommands: readonly WindowCommand[] = windowCommands.filter((command) =>
  command.startsWith('workspace.'),
);

/**
 * The shortcuts of the window: the defaults of the system, where a command has no shortcut
 * of people's own, and people's own, which win over a default of another command. Commands
 * that are off have none, so their keys reach the page.
 * @param platform - `process.platform`.
 * @param overrides - The shortcuts that people chose.
 * @param without - Commands that are off, such as those of the command palette while it is.
 */
export function shortcutTable(
  platform: string,
  overrides: ShortcutOverrides = {},
  without: readonly WindowCommand[] = [],
): Map<string, WindowCommand> {
  const table = new Map<string, WindowCommand>();
  for (const [shortcut, command] of defaultShortcuts(platform)) {
    if (overrides[command] === undefined && !without.includes(command)) {
      table.set(shortcut, command);
    }
  }
  for (const command of windowCommands) {
    if (without.includes(command)) continue;
    for (const shortcut of overrides[command] ?? []) table.set(shortcut, command);
  }
  return table;
}

/**
 * Why a key press cannot be a shortcut: it types text, Ctrl with Alt is AltGr on Windows and
 * types characters there, or the system uses it. `undefined` when it can be one.
 * @param shortcut - The key press in the notation of the tables.
 * @param platform - `process.platform`.
 */
export function shortcutProblem(
  shortcut: string,
  platform: string,
): 'text' | 'altgr' | 'system' | undefined {
  const match = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Cmd\+)?(.+)$/.exec(shortcut);
  if (match === null) return 'text';
  const [, control, alt, , command, key = ''] = match;
  const mac = platform === 'darwin';
  if (mac ? macSystem.has(shortcut) : command !== undefined || pcSystem.has(shortcut)) {
    return 'system';
  }
  // Function keys and the browser keys of some keyboards type nothing.
  if (/^(?:F(?:[1-9]|1\d|2[0-4])|Browser[A-Za-z]+)$/.test(key)) return undefined;
  // The browser sees keys before the page, so keys that edit text would edit it nowhere.
  if ((mac ? macEditing : pcEditing).test(shortcut)) return 'text';
  if (mac) return control !== undefined || command !== undefined ? undefined : 'text';
  if (control !== undefined && alt !== undefined) return 'altgr';
  return control !== undefined || alt !== undefined ? undefined : 'text';
}

/**
 * Keys that edit text or move in it on macOS: copy, paste, undo, redo and select all, the
 * arrows with Command, also with Shift to select, deletion with Command, and the bindings
 * with Control that text fields of macOS know.
 */
const macEditing =
  /^(?:(?:Shift\+)?Cmd\+(?:Z|Arrow(?:Left|Right|Up|Down))|Cmd\+(?:[ACVX]|Backspace|Delete)|Ctrl\+[ABDEFHKNOPTVY])$/;

/**
 * Keys that edit text or move in it on Windows and Linux: copy, paste, undo, redo and select
 * all, deletion by words, and the arrows, Home and End by words, also with Shift to select.
 */
const pcEditing =
  /^Ctrl\+(?:(?:Shift\+)?(?:[VZ]|Home|End|Arrow(?:Left|Right|Up|Down))|[ACXY]|Insert|Backspace|Delete)$/;

/** Shortcuts that macOS itself uses for the app or the system. */
const macSystem = new Set([
  'Cmd+Q',
  'Cmd+H',
  'Alt+Cmd+H',
  'Cmd+M',
  'Cmd+Tab',
  'Shift+Cmd+Tab',
  'Cmd+`',
  'Cmd+Space',
  'Ctrl+Space',
  'Alt+Cmd+Escape',
  'Ctrl+Cmd+Q',
  'Shift+Cmd+3',
  'Shift+Cmd+4',
  'Shift+Cmd+5',
]);

/** Shortcuts that Windows and the desktops of Linux use themselves. */
const pcSystem = new Set([
  'Alt+F4',
  'Alt+Tab',
  'Alt+Shift+Tab',
  'Alt+Escape',
  'Ctrl+Escape',
  'Alt+Space',
]);

/** The names of the modifiers and of keys without a character, as a language writes them. */
export interface KeyNames {
  readonly ctrl: string;
  readonly alt: string;
  readonly shift: string;
  readonly win: string;
  /** Names of keys, such as `PageDown`, by the name of the key in the tables. */
  readonly keys: Readonly<Record<string, string>>;
}

/** The names of keys in English, as Windows and Linux write them. */
export const englishKeyNames: KeyNames = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  win: 'Win',
  keys: {
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    Home: 'Home',
    End: 'End',
    Insert: 'Insert',
    Delete: 'Delete',
    Backspace: 'Backspace',
    Space: 'Space',
    Escape: 'Esc',
    BrowserBack: 'Back',
    BrowserForward: 'Forward',
    '+': 'Plus',
  },
};

const arrows: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
};

/**
 * A shortcut as the system writes it: `⇧⌘T` on macOS, `Ctrl+Shift+T` elsewhere, with the
 * names of keys in the language of the page, such as `Strg+Umschalt+Bild ab` in German.
 * @param shortcut - The key press in the notation of the tables.
 * @param mac - Whether the browser runs on macOS.
 * @param names - The names of keys; English by default.
 */
export function displayShortcut(
  shortcut: string,
  mac: boolean,
  names: KeyNames = englishKeyNames,
): string {
  const match = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Cmd\+)?(.+)$/.exec(shortcut);
  if (match === null) return shortcut;
  const [, control, alt, shift, command, key = ''] = match;
  // macOS writes + itself; elsewhere it would read as one more separator.
  const name = arrows[key] ?? (key === '+' && mac ? '+' : (names.keys[key] ?? key));
  if (mac) {
    return `${control === undefined ? '' : '⌃'}${alt === undefined ? '' : '⌥'}${shift === undefined ? '' : '⇧'}${command === undefined ? '' : '⌘'}${name}`;
  }
  return [control && names.ctrl, alt && names.alt, shift && names.shift, command && names.win, name]
    .filter((part) => part !== undefined)
    .join('+');
}
