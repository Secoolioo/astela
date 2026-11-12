import { describe, expect, it } from 'vitest';
import { folded, matchesAll, matchRank, searchWords } from '../search-text.ts';

describe('folded and searchWords', () => {
  it('compare without case, accents and ß', () => {
    expect(folded('Größe Über')).toBe('grosse uber');
    expect(folded('Café ÉTÉ')).toBe('cafe ete');
    expect(folded(folded('Größe'))).toBe(folded('Größe'));
  });

  it('split a search at white space and leave out blanks', () => {
    expect(searchWords('  Zoom\tIN  vergrößern ')).toEqual(['zoom', 'in', 'vergrossern']);
    expect(searchWords('   ')).toEqual([]);
  });
});

describe('matchesAll', () => {
  it('needs every word of a search', () => {
    expect(matchesAll('close the other tabs', ['oth', 'tab'])).toBe(true);
    expect(matchesAll('close the other tabs', ['oth', 'window'])).toBe(false);
    expect(matchesAll('anything', [])).toBe(true);
  });
});

describe('matchRank', () => {
  it('ranks a text that starts with the search first, then words that start, then the rest', () => {
    expect(matchRank('Zoom in', ['zoom'])).toBe(0);
    expect(matchRank('Zoom in', ['zoom', 'in'])).toBe(0);
    expect(matchRank('Close the other tabs', ['oth', 'tab'])).toBe(1);
    expect(matchRank('Reopen the last closed tab', ['open'])).toBe(2);
    expect(matchRank('reopen', ['open'])).toBe(2);
  });

  it('folds the text, and counts a word after a sign as the start of a word', () => {
    expect(matchRank('Größe der Schrift', searchWords('grosse'))).toBe(0);
    expect(matchRank('Über Astela', searchWords('astela'))).toBe(1);
    expect(matchRank('Search duckduckgo.com', ['com'])).toBe(1);
    expect(matchRank('Bookmarks-bar', ['bar'])).toBe(1);
  });

  it('finds no rank when a word is missing', () => {
    expect(matchRank('Zoom in', ['zoom', 'out'])).toBeUndefined();
    expect(matchRank('', ['a'])).toBeUndefined();
  });

  it('looks at every place of a word, not only the first', () => {
    // The first `tab` is inside a word, the second starts one.
    expect(matchRank('stable tabs', ['tab'])).toBe(1);
  });
});
