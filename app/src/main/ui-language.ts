import { app } from 'electron';
import { isLanguageCode } from '../shared/ui-language.ts';

/** The language of this start from the settings, or `undefined` to follow the system. */
let chosen: string | undefined;

/**
 * Sets the language of the browser's menus and dialogs for this start. A change of the
 * setting `i18n.language` takes effect after a restart, so the browser calls this once.
 * @param language - The value of the setting: `system`, or a language code such as `de`.
 */
export function chooseLanguage(language: string): void {
  chosen = isLanguageCode(language) ? language : undefined;
}

/** The locale of the browser's menus and dialogs: the language of the settings, or the system's. */
export function uiLocale(): string {
  return chosen ?? app.getLocale();
}
