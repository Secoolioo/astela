import type { KeyNames } from '../../shared/shortcuts.ts';
import type { MessageKey } from '../i18n/i18n.ts';

/**
 * The names of keys in the language of a page, for the shortcuts that it shows, such as
 * `Strg+Umschalt+Bild ab` in German.
 * @param t - Translates a message key into the language of the page.
 */
export function keyNamesOf(t: (key: MessageKey) => string): KeyNames {
  return {
    ctrl: t('key.ctrl'),
    alt: t('key.alt'),
    shift: t('key.shift'),
    win: t('key.win'),
    keys: {
      PageUp: t('key.pageUp'),
      PageDown: t('key.pageDown'),
      Home: t('key.home'),
      End: t('key.end'),
      Insert: t('key.insert'),
      Delete: t('key.delete'),
      Backspace: t('key.backspace'),
      Space: t('key.space'),
      Escape: t('key.escape'),
      BrowserBack: t('key.back'),
      BrowserForward: t('key.forward'),
      '+': t('key.plus'),
    },
  };
}
