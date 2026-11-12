import { describe, expect, it } from 'vitest';
import { displayShortcut } from '../../shared/shortcuts.ts';
import { Translator } from '../i18n/i18n.ts';
import { keyNamesOf } from '../ui-kit/key-names.ts';

describe('keyNamesOf', () => {
  it('names the keys of shortcuts in the language of the page', () => {
    const german = new Translator('de');
    const names = keyNamesOf((key) => german.t(key));
    expect(displayShortcut('Ctrl+Shift+PageDown', false, names)).toBe('Strg+Umschalt+Bild ab');
    expect(displayShortcut('Alt+Home', false, names)).toBe('Alt+Pos1');
    expect(displayShortcut('Ctrl++', false, names)).toBe('Strg+Plus');
    const english = new Translator('en');
    expect(
      displayShortcut(
        'Ctrl+Shift+PageDown',
        false,
        keyNamesOf((key) => english.t(key)),
      ),
    ).toBe('Ctrl+Shift+Page Down');
  });
});
