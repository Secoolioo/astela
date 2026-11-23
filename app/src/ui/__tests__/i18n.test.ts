import { describe, expect, it } from 'vitest';
import { catalogProblems } from '../../shared/__tests__/catalog-problems.ts';
import mainDe from '../../main/i18n/de.json' with { type: 'json' };
import de from '../i18n/de.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import { Translator, catalogs, isMessageKey, pickLanguage } from '../i18n/i18n.ts';

describe('i18n', () => {
  it('has every key in every shipped language, no orphans and the same placeholders', () => {
    expect(catalogProblems(catalogs)).toEqual([]);
    expect(Object.keys(de).toSorted()).toEqual(Object.keys(en).toSorted());
  });

  it('picks the first shipped language and falls back to English', () => {
    expect(pickLanguage(['fr-FR', 'de-AT', 'en'])).toBe('de');
    expect(pickLanguage(['fr'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });

  it('tells message keys from other strings', () => {
    expect(isMessageKey('shell.back')).toBe(true);
    expect(isMessageKey('constructor')).toBe(false);
    expect(isMessageKey(undefined)).toBe(false);
  });

  it('translates and falls back for unknown languages', () => {
    expect(new Translator('de').t('shell.back')).toBe('Zurück');
    const unknown = new Translator('xx');
    expect(unknown.language).toBe('en');
    expect(unknown.t('shell.back')).toBe('Back');
  });

  it('keeps to one German word for each thing, in the pages and in the menus', () => {
    const german: Record<string, string> = { ...de, ...mainDe };
    // The toolbar is the Symbolleiste, as in the other browsers in German.
    expect(Object.entries(german).filter(([, text]) => /Werkzeugleiste/i.test(text))).toEqual([]);
    // Verlauf alone is the history; a gradient of colors is a Farbverlauf.
    const english: Record<string, string> = en;
    const gradients = Object.keys(english).filter((key) => /gradient/i.test(english[key] ?? ''));
    expect(gradients.length).toBeGreaterThan(0);
    expect(
      gradients.filter((key) => {
        const text = german[key] ?? '';
        return (
          !/Farbverlauf/.test(text) || /(?<!Farb)verlauf/i.test(text.replace(/Farbverlauf/g, ''))
        );
      }),
    ).toEqual([]);
  });
});
