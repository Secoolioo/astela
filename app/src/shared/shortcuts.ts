/**
 * Commands that keyboard shortcuts run in a window, also while web content has focus, in the
 * order in which the settings page lists them.
 */
export const windowCommands = [
  'tab.new',
  'window.new',
  'window.newPrivate',
  'tab.close',
  'tab.reopen',
  'tab.next',
  'tab.previous',
  'page.back',
  'page.forward',
  'page.reload',
  'page.reloadHard',
  'page.home',
  'omnibox.focus',
  'find.open',
  'find.next',
  'find.previous',
  'zoom.in',
  'zoom.out',
  'zoom.reset',
  'window.fullscreen',
  'bookmark.toggle',
  'bookmarks.open',
  'bookmarks.toggleBar',
  'history.open',
  'downloads.open',
  'settings.open',
  'page.print',
  'page.save',
  'page.source',
  'devtools.toggle',
] as const;

/** A command that a keyboard shortcut runs in a window. */
export type WindowCommand = (typeof windowCommands)[number];

// The tables write a key press as `Modifiers+Key`: the modifiers in the order Ctrl, Alt,
// Shift, Cmd (the meta key: Command on macOS, Windows or Super elsewhere), then the key as
// `KeyboardEvent.key` names it, letters in upper case. The browser process sees each key
// before the page and cannot tell whether a text field has focus, so no shortcut may be a
// key that edits text.

/**
 * macOS. Cmd+Left and Cmd+Right are left out on purpose: they move the caret to the start
 * and the end of a line. Cmd+Tab belongs to the app switcher of the system.
 */
const macShortcuts: readonly (readonly [string, WindowCommand])[] = [
  ['Cmd+T', 'tab.new'],
  ['Cmd+N', 'window.new'],
  ['Shift+Cmd+N', 'window.newPrivate'],
  ['Cmd+W', 'tab.close'],
  ['Shift+Cmd+T', 'tab.reopen'],
  ['Ctrl+Tab', 'tab.next'],
  ['Alt+Cmd+ArrowRight', 'tab.next'],
  ['Shift+Cmd+]', 'tab.next'],
  ['Ctrl+Shift+Tab', 'tab.previous'],
  ['Alt+Cmd+ArrowLeft', 'tab.previous'],
  ['Shift+Cmd+[', 'tab.previous'],
  ['Cmd+R', 'page.reload'],
  ['Shift+Cmd+H', 'page.home'],
  ['Shift+Cmd+R', 'page.reloadHard'],
  ['Cmd+[', 'page.back'],
  ['Cmd+]', 'page.forward'],
  ['Cmd+L', 'omnibox.focus'],
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
  ['Ctrl+Shift+T', 'tab.reopen'],
  ['Ctrl+Tab', 'tab.next'],
  ['Ctrl+PageDown', 'tab.next'],
  ['Ctrl+Shift+Tab', 'tab.previous'],
  ['Ctrl+PageUp', 'tab.previous'],
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
  ['F6', 'omnibox.focus'],
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
  ['Ctrl+P', 'page.print'],
  ['Ctrl+S', 'page.save'],
  ['Ctrl+U', 'page.source'],
  ['F12', 'devtools.toggle'],
  ['Ctrl+Shift+I', 'devtools.toggle'],
];

/** The shortcuts that people chose, by command; an empty list leaves a command without one. */
export type ShortcutOverrides = Readonly<Partial<Record<WindowCommand, readonly string[]>>>;

/** A key press in the notation of the tables: modifiers in a fixed order, then the key. */
export const shortcutPattern = /^(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Cmd\+)?[^\s]{1,24}$/;

/**
 * The shortcuts of the window: the defaults of the system, where a command has no shortcut
 * of people's own, and people's own, which win over a default of another command.
 * @param platform - `process.platform`.
 * @param overrides - The shortcuts that people chose.
 */
export function shortcutTable(
  platform: string,
  overrides: ShortcutOverrides = {},
): Map<string, WindowCommand> {
  const table = new Map<string, WindowCommand>();
  for (const [shortcut, command] of platform === 'darwin' ? macShortcuts : pcShortcuts) {
    if (overrides[command] === undefined) table.set(shortcut, command);
  }
  for (const command of windowCommands) {
    for (const shortcut of overrides[command] ?? []) table.set(shortcut, command);
  }
  return table;
}

/**
 * The shortcuts of a command in a table, the one that menus show first.
 * @param table - The shortcuts of the window.
 * @param command - The command.
 */
export function shortcutsOf(
  table: ReadonlyMap<string, WindowCommand>,
  command: WindowCommand,
): string[] {
  return [...table].filter(([, other]) => other === command).map(([shortcut]) => shortcut);
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
  if (mac) return control !== undefined || command !== undefined ? undefined : 'text';
  if (control !== undefined && alt !== undefined) return 'altgr';
  return control !== undefined || alt !== undefined ? undefined : 'text';
}

/** Shortcuts that macOS itself uses for the app or the system. */
const macSystem = new Set([
  'Cmd+Q',
  'Cmd+H',
  'Alt+Cmd+H',
  'Cmd+M',
  'Cmd+Tab',
  'Shift+Cmd+Tab',
  'Cmd+`',
  'Cmd+ ',
  'Ctrl+ ',
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
  'Alt+ ',
]);

const keyNames: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  BrowserBack: 'Back',
  BrowserForward: 'Forward',
  Escape: 'Esc',
  ' ': 'Space',
};

/**
 * A shortcut as the system writes it: `⇧⌘T` on macOS, `Ctrl+Shift+T` elsewhere.
 * @param shortcut - The key press in the notation of the tables.
 * @param mac - Whether the browser runs on macOS.
 */
export function displayShortcut(shortcut: string, mac: boolean): string {
  const match = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Cmd\+)?(.+)$/.exec(shortcut);
  if (match === null) return shortcut;
  const [, control, alt, shift, command, key = ''] = match;
  const name = keyNames[key] ?? (key === '+' && !mac ? 'Plus' : key);
  if (mac) {
    return `${control === undefined ? '' : '⌃'}${alt === undefined ? '' : '⌥'}${shift === undefined ? '' : '⇧'}${command === undefined ? '' : '⌘'}${name}`;
  }
  return [control && 'Ctrl', alt && 'Alt', shift && 'Shift', command && 'Win', name]
    .filter((part) => part !== undefined)
    .join('+');
}

const acceleratorKeys: Readonly<Record<string, string>> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  '+': 'Plus',
  ' ': 'Space',
  Escape: 'Esc',
};

/**
 * A shortcut in Electron's accelerator syntax, for menus that show it, or `undefined` for a
 * key that menus cannot show, such as the Back key of some keyboards.
 * @param shortcut - The key press in the notation of the tables.
 */
export function acceleratorOf(shortcut: string): string | undefined {
  const match = /^((?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?)(Cmd\+)?(.+)$/.exec(shortcut);
  if (match === null) return undefined;
  const [, modifiers = '', command, key = ''] = match;
  const name = acceleratorKeys[key] ?? key;
  if (
    !/^(?:[A-Z0-9]|F\d{1,2}|[-=[\];',./\\`]|Plus|Space|Tab|Esc|Left|Right|Up|Down|Home|End|PageUp|PageDown|Delete|Insert|Backspace)$/.test(
      name,
    )
  ) {
    return undefined;
  }
  return `${modifiers}${command === undefined ? '' : 'Cmd+'}${name}`;
}
