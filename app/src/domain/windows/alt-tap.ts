/** A key press as the browser sees it before a view does, as far as Alt alone depends on it. */
export interface AltTapInput {
  /** `keyDown` or `keyUp`. */
  readonly type: string;
  /** The key as `KeyboardEvent.key` names it, such as `Alt` or `AltGraph`. */
  readonly key: string;
  readonly control: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly isAutoRepeat: boolean;
  /** Whether an input method composes text with the key. */
  readonly isComposing: boolean;
  /**
   * The modifiers of the key press as Electron names them, such as `leftbuttondown` for a
   * button of the pointer that is held.
   */
  readonly modifiers?: readonly string[];
}

/** An event of the pointer in a view while Alt is down, as Electron reports it. */
export interface AltTapPointer {
  /** Such as `mouseDown`, `mouseMove` or `mouseWheel`. */
  readonly type: string;
  /** The modifiers of the event, such as `leftbuttondown`. */
  readonly modifiers?: readonly string[];
}

/** The modifiers of a button of the pointer that is held. */
const buttons = new Set(['leftbuttondown', 'middlebuttondown', 'rightbuttondown']);

/** Events of the keyboard, which reach {@link AltTap.key} instead. */
const keyEvents = new Set(['rawKeyDown', 'keyDown', 'keyUp', 'char']);

/** Events of a pointer that only moves, which leave the tap armed while no button is held. */
const moves = new Set([
  'undefined',
  'mouseMove',
  'mouseEnter',
  'mouseLeave',
  'pointerMove',
  'pointerRawUpdate',
]);

/** Whether the modifiers of an event hold a button of the pointer. */
function buttonHeld(modifiers: readonly string[] | undefined): boolean {
  return modifiers?.some((modifier) => buttons.has(modifier.toLowerCase())) === true;
}

/**
 * Tells Alt pressed and released alone, which opens the browser menu on Windows and Linux, as
 * in other browsers, apart from Alt in a combination. Alt without Ctrl, Shift or Meta arms it,
 * and holding it keeps it armed; any other key disarms it, also Shift for a switch of the
 * keyboard layout and Ctrl with Alt for AltGr, and so does composing text. The release of Alt
 * while armed is the tap. Alt does not arm while a button of the pointer is held, and the
 * pointer disarms it when it is pressed, released, turns its wheel or drags while Alt is
 * down, as for a drag that started before Alt went down. The window disarms it when it loses
 * the focus.
 */
export class AltTap {
  private armed = false;

  /** Whether an Alt is down alone, so that its release opens the menu. */
  get waiting(): boolean {
    return this.armed;
  }

  /**
   * Takes a key press.
   * @param input - The key press.
   * @returns `arm` for Alt down alone, `open` for its release while armed, and `none` for
   *   everything else.
   */
  key(input: AltTapInput): 'arm' | 'open' | 'none' {
    if (input.isComposing) {
      this.armed = false;
      return 'none';
    }
    if (input.type === 'keyDown') {
      // Holding Alt repeats its key press, which neither arms nor disarms.
      if (input.key === 'Alt' && input.isAutoRepeat) return 'none';
      this.armed =
        input.key === 'Alt' &&
        !input.control &&
        !input.shift &&
        !input.meta &&
        !buttonHeld(input.modifiers);
      return this.armed ? 'arm' : 'none';
    }
    if (input.type === 'keyUp' && input.key === 'Alt' && this.armed) {
      this.armed = false;
      return 'open';
    }
    return 'none';
  }

  /**
   * Takes an event of the pointer in the view while Alt is down: a press, a release, a turn of
   * the wheel or a move with a button held disarms the tap, a move without one does not.
   * @param input - The event.
   */
  pointer(input: AltTapPointer): void {
    if (keyEvents.has(input.type)) return;
    if (moves.has(input.type) && !buttonHeld(input.modifiers)) return;
    this.armed = false;
  }

  /** Disarms the tap, as the loss of the focus does. */
  reset(): void {
    this.armed = false;
  }
}
