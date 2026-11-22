import { describe, expect, it } from 'vitest';
import { paperSizeFor } from '../page-tools/paper-size.ts';

describe('paperSizeFor', () => {
  it('takes US Letter where the region of the system uses it, whatever the language of the menus', () => {
    expect(paperSizeFor('en-US', 'en-US')).toBe('Letter');
    expect(paperSizeFor('en-CA', 'en')).toBe('Letter');
    expect(paperSizeFor('fr-CA', 'de')).toBe('Letter');
    expect(paperSizeFor('es-MX', 'en-US')).toBe('Letter');
    expect(paperSizeFor('en_US.UTF-8', 'de')).toBe('Letter');
  });

  it('takes A4 everywhere else, also with English menus, which Chromium reports as en-US', () => {
    expect(paperSizeFor('en-GB', 'en-US')).toBe('A4');
    expect(paperSizeFor('en-GB', 'en')).toBe('A4');
    expect(paperSizeFor('en_AU.UTF-8', 'en-US')).toBe('A4');
    expect(paperSizeFor('de-DE', 'de')).toBe('A4');
    expect(paperSizeFor('fr-FR', 'en-US')).toBe('A4');
    expect(paperSizeFor('ja-JP', 'en-US')).toBe('A4');
  });

  it('gives a system locale without a region the region that its language most likely means', () => {
    expect(paperSizeFor('de', 'en-US')).toBe('A4');
    expect(paperSizeFor('en', 'de')).toBe('Letter');
  });

  it('follows the language of the menus when the system names no region', () => {
    // A system without a language setting, LANG=C on Linux.
    expect(paperSizeFor('en-US@posix', 'de')).toBe('A4');
    expect(paperSizeFor('en-US@posix', 'en-US')).toBe('Letter');
    expect(paperSizeFor('C', 'de')).toBe('A4');
    expect(paperSizeFor('', 'en')).toBe('Letter');
    expect(paperSizeFor('', 'fr')).toBe('A4');
  });

  it('takes A4 when neither locale is a language tag', () => {
    expect(paperSizeFor('', '')).toBe('A4');
    expect(paperSizeFor('not a locale', 'C')).toBe('A4');
  });
});
