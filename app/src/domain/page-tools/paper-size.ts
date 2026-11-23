/** The sizes of paper that a page saved as PDF can have. */
export type PaperSize = 'A4' | 'Letter';

/**
 * The regions that use US Letter, as the paper sizes of the Unicode CLDR list them; every other
 * region uses A4.
 */
const letterRegions = new Set([
  'BZ',
  'CA',
  'CL',
  'CO',
  'CR',
  'GT',
  'MX',
  'NI',
  'PA',
  'PH',
  'PR',
  'SV',
  'US',
  'VE',
]);

/**
 * The region that a locale names, or else the one that its language most likely means, such
 * as DE for `de`; none for a locale that is no language tag, or for the POSIX locale of a
 * system without a language setting, which Electron reports as `en-US@posix`.
 * @param locale - A locale, also as a system writes it, such as `en_GB.UTF-8`.
 */
function regionOf(locale: string): string | undefined {
  if (/@posix$/i.test(locale)) return undefined;
  try {
    const tag = locale.replace(/[.@].*$/, '').replaceAll('_', '-');
    return new Intl.Locale(tag).maximize().region;
  } catch {
    return undefined;
  }
}

/**
 * The paper of a page saved as PDF: US Letter in the regions that use it, such as the United
 * States, Canada and Mexico, and A4 elsewhere. Chrome takes the region from the locale of its
 * menus, of which it ships one for each region it supports; Astela ships English and German
 * only, so the region comes from the locale of the system, as for the regional formats, and
 * the language of the menus decides only when the system names none.
 * @param systemLocale - The locale of the system, such as `en-GB` from `app.getSystemLocale()`.
 * @param uiLocale - The locale of the browser's menus, such as `de` or `en-US`.
 */
export function paperSizeFor(systemLocale: string, uiLocale: string): PaperSize {
  const region = regionOf(systemLocale) ?? regionOf(uiLocale);
  return region !== undefined && letterRegions.has(region) ? 'Letter' : 'A4';
}
