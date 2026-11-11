/** The argument that gives the browser's own views the language chosen in the settings. */
const prefix = '--language=';

/**
 * Whether a value of the setting `i18n.language` names a language, rather than `system`.
 * @param value - A value of the setting.
 */
export function isLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}$/.test(value);
}

/**
 * The arguments that give the browser's own views a language: none when the language
 * follows the system, which the views then find out themselves.
 * @param language - The value of the setting `i18n.language`: `system` or a language code.
 */
export function languageArguments(language: string): string[] {
  return isLanguageCode(language) ? [`${prefix}${language}`] : [];
}

/**
 * The language that the browser gave one of its own views.
 * @param args - The command line of the view, such as `process.argv` in its preload.
 * @returns A language code, or `undefined` when the view follows the system.
 */
export function languageOfArguments(args: readonly string[]): string | undefined {
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return value !== undefined && isLanguageCode(value) ? value : undefined;
}

/** The argument that gives the browser's own views the locale of the system. */
const localePrefix = '--system-locale=';

/**
 * The argument that gives the browser's own views the locale of the system, such as `en-GB`,
 * for dates and times in its regional form; none for a locale that is no language tag.
 * @param locale - The locale of the system, such as Electron's `app.getSystemLocale()`, which
 *   can come as `en_GB` or with a modifier, such as `en-US@posix`.
 */
export function localeArguments(locale: string): string[] {
  const tag = locale.replace(/@.*$/, '').replaceAll('_', '-');
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag) ? [`${localePrefix}${tag}`] : [];
}

/**
 * The locale of the system that the browser gave one of its own views.
 * @param args - The command line of the view, such as `process.argv` in its preload.
 * @returns A language tag, or `undefined` when the view has none.
 */
export function localeOfArguments(args: readonly string[]): string | undefined {
  const value = args.find((arg) => arg.startsWith(localePrefix))?.slice(localePrefix.length);
  return value !== undefined && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(value) ? value : undefined;
}
