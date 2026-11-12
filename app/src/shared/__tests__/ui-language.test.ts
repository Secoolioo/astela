import { describe, expect, it } from 'vitest';
import {
  isLanguageCode,
  languageArguments,
  languageOfArguments,
  localeArguments,
  localeOfArguments,
} from '../ui-language.ts';

describe('the language of the browser', () => {
  it('gives the views a chosen language and nothing when it follows the system', () => {
    expect(languageArguments('de')).toEqual(['--language=de']);
    expect(languageArguments('system')).toEqual([]);
    expect(isLanguageCode('system')).toBe(false);
    expect(isLanguageCode('fil')).toBe(true);
  });

  it('reads only a language code from the arguments of a view', () => {
    expect(languageOfArguments(['--appearance=x', '--language=de'])).toBe('de');
    expect(languageOfArguments(['--language=de-DE'])).toBeUndefined();
    expect(languageOfArguments(['--language="><x'])).toBeUndefined();
    expect(languageOfArguments([])).toBeUndefined();
  });

  it('gives the views the locale of the system as a language tag', () => {
    expect(localeArguments('en-GB')).toEqual(['--system-locale=en-GB']);
    expect(localeArguments('de_AT')).toEqual(['--system-locale=de-AT']);
    expect(localeArguments('en-US@posix')).toEqual(['--system-locale=en-US']);
    expect(localeArguments('')).toEqual([]);
    expect(localeArguments('a b')).toEqual([]);
    expect(localeOfArguments(['--system-locale=en-GB'])).toBe('en-GB');
    expect(localeOfArguments(['--system-locale=<x>'])).toBeUndefined();
    expect(localeOfArguments([])).toBeUndefined();
  });
});
