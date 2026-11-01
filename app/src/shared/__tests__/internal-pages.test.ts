import { describe, expect, it } from 'vitest';
import { newTabUrl, tabPageOf } from '../internal-pages.ts';

describe('tabPageOf', () => {
  it('finds internal pages that open in tabs', () => {
    expect(tabPageOf(newTabUrl)).toBe('newtab');
    expect(tabPageOf('APP://NewTab')).toBe('newtab');
    expect(tabPageOf('app://newtab/?q=1#x')).toBe('newtab');
  });

  it('treats other hosts and schemes as web addresses', () => {
    expect(tabPageOf('app://shell/')).toBeUndefined();
    expect(tabPageOf('app://newtab.example/')).toBeUndefined();
    expect(tabPageOf('https://newtab/')).toBeUndefined();
    expect(tabPageOf('about:blank')).toBeUndefined();
  });
});
