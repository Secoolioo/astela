/** The text of an item of a menu, and its access key. */
export interface LabelParts {
  /** The text as it shows, without the marks of the access key. */
  readonly text: string;
  /** The access key in lower case, which the letter after `&` gives on Windows and Linux. */
  readonly accessKey?: string;
  /** Where the letter of the access key is in the text. */
  readonly at?: number;
}

/**
 * The text of an item of a menu and its access key. On Windows and Linux, `&` marks the
 * letter after it as the access key, the first one counts, and `&&` stands for an `&` of its
 * own. macOS has no access keys, so its texts show as they are.
 * @param label - The text, as the browser process sends it.
 * @param mac - Whether the menu is one of macOS.
 */
export function parseLabel(label: string, mac: boolean): LabelParts {
  if (mac) return { text: label };
  let text = '';
  let accessKey: string | undefined;
  let at: number | undefined;
  let last = 0;
  // Each mark with the character after it: another & stands for itself, an & at the end for
  // nothing.
  for (const match of label.matchAll(/&(.?)/gsu)) {
    text += label.slice(last, match.index);
    last = match.index + match[0].length;
    const next = match[1] ?? '';
    if (next !== '&' && next !== '' && accessKey === undefined) {
      accessKey = next.toLowerCase();
      at = text.length;
    }
    text += next;
  }
  text += label.slice(last);
  return accessKey === undefined || at === undefined ? { text } : { text, accessKey, at };
}

/** An entry of a menu, as far as its keys depend on it. */
export interface KeyEntry {
  readonly type: 'item' | 'submenu' | 'separator' | 'zoom';
  readonly label?: string;
  /** Whether the entry can be chosen; a zoom row can when one of its parts can. */
  readonly enabled?: boolean;
}

/** What a key press in a menu does. */
export type MenuAction =
  | { readonly kind: 'focus'; readonly index: number }
  | { readonly kind: 'activate'; readonly index: number }
  | { readonly kind: 'openSubmenu'; readonly index: number }
  | { readonly kind: 'closeSubmenu' }
  | { readonly kind: 'closeMenu' }
  | { readonly kind: 'none' };

/** Whether the keyboard can reach an entry: separators and entries that cannot be chosen not. */
function reachable(entry: KeyEntry | undefined): boolean {
  return entry !== undefined && entry.type !== 'separator' && entry.enabled !== false;
}

/**
 * The next entry that the keyboard can reach, after or before one, around the end.
 * @returns Its place, or -1 when there is none.
 */
function step(entries: readonly KeyEntry[], from: number, by: 1 | -1): number {
  const count = entries.length;
  for (let moved = 1; moved <= count; moved += 1) {
    const index = (((from + by * moved) % count) + count) % count;
    if (reachable(entries[index])) return index;
  }
  return -1;
}

/** Moves the focus to an entry, or does nothing for -1. */
function focus(index: number): MenuAction {
  return index === -1 ? { kind: 'none' } : { kind: 'focus', index };
}

/**
 * What a key press does in a menu, as in the menus of the systems and the menu pattern of
 * WAI-ARIA: the arrows move and go round, skipping separators and entries that cannot be
 * chosen, Home and End go to the ends, Right, Enter and Space open a submenu, Left and Escape
 * close it, Escape and Tab close the menu, and Enter and Space choose an item. On Windows and
 * Linux, a letter chooses the item whose access key it is, or moves among the items that share
 * it; on macOS, and where no item has the letter as its access key, such as in the folders of
 * the bookmarks bar, it moves to the next item whose text starts with it.
 * @param entries - The entries of the menu.
 * @param focused - The place of the entry that has the focus, or -1 for the menu itself.
 * @param key - The key, as `KeyboardEvent.key` names it.
 * @param options - Whether the menu is one of macOS, and whether it is the menu itself rather
 *   than a submenu.
 */
export function menuKey(
  entries: readonly KeyEntry[],
  focused: number,
  key: string,
  options: { readonly mac: boolean; readonly root: boolean },
): MenuAction {
  const current = entries[focused];
  switch (key) {
    case 'ArrowDown':
      return focus(step(entries, focused === -1 ? -1 : focused, 1));
    case 'ArrowUp':
      return focus(step(entries, focused === -1 ? 0 : focused, -1));
    case 'Home':
      return focus(step(entries, -1, 1));
    case 'End':
      return focus(step(entries, 0, -1));
    case 'ArrowRight':
      return current?.type === 'submenu' && reachable(current)
        ? { kind: 'openSubmenu', index: focused }
        : { kind: 'none' };
    case 'ArrowLeft':
      return options.root ? { kind: 'none' } : { kind: 'closeSubmenu' };
    case 'Escape':
      return options.root ? { kind: 'closeMenu' } : { kind: 'closeSubmenu' };
    case 'Tab':
      return { kind: 'closeMenu' };
    case 'Enter':
    case ' ':
      if (!reachable(current)) return { kind: 'none' };
      return current?.type === 'submenu'
        ? { kind: 'openSubmenu', index: focused }
        : { kind: 'activate', index: focused };
    default:
      return letter(entries, focused, key, options.mac);
  }
}

/** What a letter does: the item of its access key, or the next item that starts with it. */
function letter(
  entries: readonly KeyEntry[],
  focused: number,
  key: string,
  mac: boolean,
): MenuAction {
  if (!/^.$/su.test(key) || key === ' ') return { kind: 'none' };
  const wanted = key.toLocaleLowerCase();
  const parts = entries.map((entry) => parseLabel(entry.label ?? '', mac));
  const owners = mac
    ? []
    : entries.flatMap((entry, index) =>
        reachable(entry) && parts[index]?.accessKey === wanted ? [index] : [],
      );
  const [only] = owners;
  if (owners.length === 1 && only !== undefined) {
    const entry = entries[only];
    if (entry?.type === 'submenu') return { kind: 'openSubmenu', index: only };
    // A letter moves to the zoom row, whose parts the arrows reach.
    if (entry?.type === 'zoom') return { kind: 'focus', index: only };
    return { kind: 'activate', index: only };
  }
  const starts = (index: number): boolean =>
    owners.length > 1
      ? owners.includes(index)
      : reachable(entries[index]) &&
        (parts[index]?.text ?? '').trimStart().toLocaleLowerCase().startsWith(wanted);
  for (let moved = 1; moved <= entries.length; moved += 1) {
    const index = (((focused + moved) % entries.length) + entries.length) % entries.length;
    if (starts(index)) return { kind: 'focus', index };
  }
  return { kind: 'none' };
}
