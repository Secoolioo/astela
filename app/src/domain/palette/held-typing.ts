/** A key press as the browser sees it before a view does, as far as held typing depends on it. */
export interface HeldKey {
  /** `keyDown` or `keyUp`. */
  readonly type: string;
  /** The key as `KeyboardEvent.key` names it, such as `a`, `Enter` or `Dead`. */
  readonly key: string;
  readonly control: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  /** Whether an input method composes text with the key. */
  readonly isComposing: boolean;
}

/** What was typed while the keys were held, once they are let go. */
export interface TypedText {
  /** The text, at most {@link heldLimit} UTF-16 code units, as the palette's field takes. */
  readonly text: string;
  /** Whether Enter was pressed, which chooses the first result. */
  readonly enter: boolean;
  /** Whether Escape was pressed, which closes the palette before it shows. */
  readonly cancelled: boolean;
}

/** How long after the shortcut new keys are held, in milliseconds. */
export const holdTime = 2000;
/** How long the held text is at most, in UTF-16 code units, as the palette's field counts. */
export const heldLimit = 200;

const nothing: TypedText = { text: '', enter: false, cancelled: false };

/**
 * Holds the keys typed right after the shortcut of the command palette, while the palette
 * loads, so that they go to its field and none of them to the page: printable characters,
 * Backspace, which deletes the last of them, Enter, which chooses the first result, and
 * Escape, which cancels. Keys with Ctrl or Command are shortcuts and stay with their view,
 * apart from AltGr on Windows, which reports Ctrl with Alt and types characters. An input
 * method's keys and dead keys are never held, as they compose in the view. New keys are held
 * for {@link holdTime} after the shortcut; what was held stays until it is let go, unless the
 * hold is given up before the palette is ready.
 */
export class HeldTyping {
  private holding = false;
  /** Whether new keys are held; a hold that was given up only waits to be let go. */
  private taking = false;
  private since = 0;
  private text = '';
  private enter = false;
  private cancelled = false;
  private readonly now: () => number;
  private readonly platform: string;

  /**
   * @param now - The time in milliseconds, such as `performance.now`.
   * @param platform - `process.platform`.
   */
  constructor(now: () => number, platform: string) {
    this.now = now;
    this.platform = platform;
  }

  /** Whether keys are held, until they are let go. */
  get active(): boolean {
    return this.holding;
  }

  /** Whether Escape was pressed while the keys were held. */
  get wasCancelled(): boolean {
    return this.holding && this.cancelled;
  }

  /**
   * Starts to hold the keys typed from now on; a hold that runs already goes on with what it
   * has, for another {@link holdTime}, and one that was given up starts again with nothing.
   */
  hold(): void {
    if (!this.taking) {
      this.text = '';
      this.enter = false;
      this.cancelled = false;
    }
    this.holding = true;
    this.taking = true;
    this.since = this.now();
  }

  /**
   * Gives up the hold before the palette is ready, as when a click after the shortcut opened a
   * new tab: keys reach their views again at once, what was held goes nowhere, and the palette
   * that waits for the keys does not open, as after Escape.
   */
  cancel(): void {
    if (!this.holding) return;
    this.taking = false;
    this.text = '';
    this.enter = false;
    this.cancelled = true;
  }

  /**
   * Takes a key press while keys are held.
   * @param input - The key press.
   * @returns Whether the key belongs to the hold, so that its view does not get it.
   */
  take(input: HeldKey): boolean {
    if (!this.taking || input.isComposing || input.key === 'Dead') return false;
    if (this.now() - this.since > holdTime) return false;
    const kind = keyKind(input, this.platform);
    if (kind === undefined) return false;
    // The release of a key that the hold took goes nowhere either.
    if (input.type !== 'keyDown') return input.type === 'keyUp';
    if (kind === 'enter') this.enter = true;
    else if (kind === 'escape') this.cancelled = true;
    else if (kind === 'backspace') this.text = withoutLast(this.text);
    else if (this.text.length + input.key.length <= heldLimit) this.text += input.key;
    return true;
  }

  /**
   * Lets the keys go: what was typed goes to the palette, and keys reach their views again.
   * @returns What was typed; nothing when no keys were held.
   */
  release(): TypedText {
    if (!this.holding) return nothing;
    const typed = { text: this.text, enter: this.enter, cancelled: this.cancelled };
    this.holding = false;
    this.taking = false;
    this.text = '';
    this.enter = false;
    this.cancelled = false;
    return typed;
  }
}

/** What a key does to the held text, or `undefined` for a key that the hold leaves alone. */
function keyKind(
  input: HeldKey,
  platform: string,
): 'text' | 'enter' | 'escape' | 'backspace' | undefined {
  const plain = !input.control && !input.alt && !input.meta;
  if (input.key === 'Enter') return plain ? 'enter' : undefined;
  if (input.key === 'Escape') return plain ? 'escape' : undefined;
  if (input.key === 'Backspace') return plain ? 'backspace' : undefined;
  if (!printable(input.key)) return undefined;
  // Command makes a shortcut; so does Ctrl, apart from AltGr on Windows, which is Ctrl with Alt.
  if (input.meta) return undefined;
  if (input.control && !(platform === 'win32' && input.alt)) return undefined;
  return 'text';
}

/** Splits text into the characters that a person sees, made with the first held key. */
let segmenter: Intl.Segmenter | undefined;

/** The characters that a person sees in a text. */
function graphemes(text: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
}

/** Whether a key types one character, rather than naming a key such as `Tab` or `F5`. */
function printable(key: string): boolean {
  return /^\P{C}+$/u.test(key) && graphemes(key).length === 1;
}

/** A text without the last character that a person sees. */
function withoutLast(text: string): string {
  return graphemes(text).slice(0, -1).join('');
}
