/**
 * A factor as a percentage in a language, such as a zoom of 1.25 as `125 %` in German.
 * @param factor - The factor, such as 1.25.
 * @param language - The language, such as `de`; the language of the system without it.
 */
export function percent(factor: number, language: string | undefined): string {
  return new Intl.NumberFormat(language, { style: 'percent' }).format(factor);
}
