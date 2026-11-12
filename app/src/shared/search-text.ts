/**
 * Text in a form that compares without case, accents and ß, as the searches of the browser's
 * own pages compare it: `Größe Über` becomes `grosse uber`.
 * @param text - Any text.
 */
export function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('ß', 'ss');
}

/**
 * The words of a search, folded.
 * @param query - What someone typed.
 */
export function searchWords(query: string): string[] {
  return folded(query)
    .split(/\s+/)
    .filter((word) => word !== '');
}

/**
 * Whether a text holds every word of a search.
 * @param text - A folded text.
 * @param words - The words of the search, from {@link searchWords}.
 */
export function matchesAll(text: string, words: readonly string[]): boolean {
  return words.every((word) => text.includes(word));
}

/**
 * How well a text matches a search, to put the best results first: 0 when the text starts
 * with the whole search, 1 when every word starts a word of the text, 2 when the text only
 * holds every word, and `undefined` when a word is missing.
 * @param text - A text; it is folded here.
 * @param words - The words of the search, from {@link searchWords}.
 */
export function matchRank(text: string, words: readonly string[]): 0 | 1 | 2 | undefined {
  const plain = folded(text);
  if (!matchesAll(plain, words)) return undefined;
  if (plain.startsWith(words.join(' '))) return 0;
  return words.every((word) => startsWord(plain, word)) ? 1 : 2;
}

/** Whether a word of a text starts with a part, at its start or after a sign that is no letter. */
function startsWord(text: string, part: string): boolean {
  for (let index = text.indexOf(part); index !== -1; index = text.indexOf(part, index + 1)) {
    if (index === 0 || !/[\p{L}\p{N}]/u.test(text.charAt(index - 1))) return true;
  }
  return false;
}
