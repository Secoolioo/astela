/**
 * The keys of the tab strip, which is a list of tabs as in the tabs pattern of ARIA: the arrows
 * move the focus between the tabs and the chips of groups, Up and Down in a strip at a side of
 * the window, and go round at the ends; Home and End go to the first and the last item; Enter and
 * Space show the focused tab, and Delete closes it. On macOS, the key labelled delete, which
 * types `Backspace`, closes it too, as it removes the chosen item of a list there; the key that
 * types `Delete` needs fn on the keyboards of Mac laptops.
 */

/** What a key does on an item of the tab strip. */
export type StripKey = 'previous' | 'next' | 'first' | 'last' | 'show' | 'close';

/** What the key press of an item of the tab strip tells. */
export interface StripKeyPress {
  /** The key, as `KeyboardEvent.key` names it. */
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  /** Whether the key types for an input method. */
  readonly isComposing: boolean;
}

/**
 * What a key does on an item of the tab strip, or `undefined` for a key that the strip leaves
 * alone, such as one with a modifier, which may be a shortcut.
 * @param press - The key press.
 * @param vertical - Whether the strip is at a side of the window.
 * @param mac - Whether the browser runs on macOS.
 */
export function stripKey(
  press: StripKeyPress,
  vertical: boolean,
  mac: boolean,
): StripKey | undefined {
  if (press.altKey || press.ctrlKey || press.metaKey || press.shiftKey || press.isComposing) {
    return undefined;
  }
  switch (press.key) {
    case vertical ? 'ArrowUp' : 'ArrowLeft':
      return 'previous';
    case vertical ? 'ArrowDown' : 'ArrowRight':
      return 'next';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Enter':
    case ' ':
      return 'show';
    case 'Delete':
      return 'close';
    case 'Backspace':
      return mac ? 'close' : undefined;
    default:
      return undefined;
  }
}
