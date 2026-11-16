import type { WindowCommand } from './shortcuts.ts';

// What menus and the pages of the browser read from the table of shortcuts. It loads with
// them, not with the start of the browser.

/**
 * The shortcuts that the system itself gives a command, besides those of the window: on
 * macOS, Command+Q quits through the application menu. People cannot change them, and they
 * work whatever the window's shortcuts are.
 * @param platform - `process.platform`.
 * @param command - The command.
 */
export function systemShortcutsOf(platform: string, command: WindowCommand): readonly string[] {
  return platform === 'darwin' && command === 'app.quit' ? ['Cmd+Q'] : [];
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

const acceleratorKeys: Readonly<Record<string, string>> = {
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  '+': 'Plus',
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
