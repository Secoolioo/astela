import { describe, expect, it } from 'vitest';
import { isLanguageCode, languageArguments, languageOfArguments } from '../ui-language.ts';

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
});
