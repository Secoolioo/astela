import type { Input, WebContents } from 'electron';
import { shortcutOf } from './shortcuts.ts';

// The editor of shortcuts on the settings page waits for key presses with this. It loads with
// the handlers of the browser's own pages, before the settings page, not with the start.

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
