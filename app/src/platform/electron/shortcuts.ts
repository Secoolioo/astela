import type { Input, WebContents } from 'electron';
import { shortcutTable, type WindowCommand } from '../../shared/shortcuts.ts';

export type { WindowCommand } from '../../shared/shortcuts.ts';

/** The default shortcuts of each system, made once. */
const defaults = new Map<string, Map<string, WindowCommand>>();

/**
 * Maps a key press to a window command.
 * @param input - The key event.
 * @param platform - `process.platform`.
 * @param table - The shortcuts of the window; the defaults of the system when left out.
 */
export function commandForInput(
  input: Input,
  platform: string,
  table?: ReadonlyMap<string, WindowCommand>,
): WindowCommand | undefined {
  // While an input method composes text, its keys belong to it: Japanese input methods,
  // for example, convert the text with F6 to F10 and Ctrl+T.
  if (input.type !== 'keyDown' || input.isComposing) {
    return undefined;
  }
  let shortcuts = table ?? defaults.get(platform);
  if (shortcuts === undefined) {
    shortcuts = shortcutTable(platform);
    defaults.set(platform, shortcutTable(platform));
  }
  return shortcuts.get(shortcutOf(input, platform === 'darwin'));
}

/**
 * Waits for the next key press of a view, for the editor of shortcuts on the settings page.
 * The key press runs no command and does not reach the page; Escape alone ends the wait
 * without a shortcut, and a key press of modifiers alone is not one yet.
 */
export class ShortcutRecorder {
  private readonly waiting = new Map<number, (shortcut: string | undefined) => void>();

  /**
   * Waits for a key press of a view. A new wait ends the one before without a shortcut.
   * @param contents - The view.
   * @param timeout - How long to wait at most, in milliseconds.
   */
  record(contents: WebContents, timeout = 30_000): Promise<string | undefined> {
    this.waiting.get(contents.id)?.(undefined);
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(undefined), timeout);
      const gone = (): void => done(undefined);
      const done = (shortcut: string | undefined): void => {
        clearTimeout(timer);
        contents.off('destroyed', gone);
        if (this.waiting.get(contents.id) === done) this.waiting.delete(contents.id);
        resolve(shortcut);
      };
      this.waiting.set(contents.id, done);
      contents.once('destroyed', gone);
    });
  }

  /**
   * Takes a key press of a view that waits for one.
   * @param contentsId - The id of the view's web contents.
   * @param input - The key event.
   * @param platform - `process.platform`.
   * @returns Whether the view waited, so the key press belongs to the editor.
   */
  take(contentsId: number, input: Input, platform: string): boolean {
    const done = this.waiting.get(contentsId);
    if (done === undefined) return false;
    if (input.type !== 'keyDown' || input.isComposing) return true;
    if (['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn'].includes(input.key)) {
      return true;
    }
    const plain = !input.control && !input.alt && !input.shift && !input.meta;
    done(plain && input.key === 'Escape' ? undefined : shortcutOf(input, platform === 'darwin'));
    return true;
  }
}

/**
 * Writes a key press in the notation of the tables.
 * @param input - The key event.
 * @param mac - Whether the browser runs on macOS.
 */
export function shortcutOf(input: Input, mac: boolean): string {
  let { key, alt, shift } = input;
  // A letter, or a vowel sign, which Devanagari layouts type on some letter keys.
  const letter = /^[\p{L}\p{M}]$/u.test(key);
  if (/^[a-z]$/i.test(key)) {
    key = key.toUpperCase();
  } else if (letter && /^(?:Key[A-Z]|Digit\d)$/.test(input.code)) {
    // A layout for another script, such as Cyrillic or Devanagari: as in other browsers,
    // Ctrl+T is the key that carries the T on a Latin keyboard. Layouts such as French type
    // letters on the keys of the digits too, where Ctrl+0 is the key that carries the 0.
    key = input.code.slice(-1);
  } else if (mac && letter && !/\p{Script=Latin}/u.test(key) && input.code.startsWith('Bracket')) {
    // The same for Cmd+[ and Cmd+] where a layout for another script, such as Russian or
    // Arabic, types letters on these keys. Latin layouts type brackets, with Option if need
    // be, so German keeps Cmd+ü on the key that has [ in English.
    key = input.code === 'BracketLeft' ? '[' : ']';
  } else if (mac && /^[[\]{}]$/.test(key)) {
    // Where a layout needs Option, and maybe Shift, to type a bracket, both belong to the
    // character. A brace is a bracket with Shift.
    if (alt) shift = false;
    alt = false;
    if (key === '{' || key === '}') {
      shift = true;
      key = key === '{' ? '[' : ']';
    }
  } else if (mac && alt && /^Key[A-Z]$/.test(input.code)) {
    // Option types another character on a letter key, or starts an accent, so Cmd+Option+I
    // arrives as a dead key: such a shortcut counts by the letter on the key.
    key = input.code.slice(3);
  }
  // The space bar has a name, as the notation has no room for a space.
  if (key === ' ') key = 'Space';
  const control = input.control ? 'Ctrl+' : '';
  const meta = input.meta ? 'Cmd+' : '';
  return `${control}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${meta}${key}`;
}
