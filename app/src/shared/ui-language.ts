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
