import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtInThemes, lineOpacity, paletteTokens, statusColors } from '../../shared/themes.ts';

/** The design tokens of the browser's own views, which every view loads. */
const tokensCss = readFileSync(
  join(import.meta.dirname, '..', '..', 'ui', 'ui-kit', 'tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The declarations of the first rule whose selector is written as given, in the order of the
 * file, as name and value without the white space around them.
 * @param selector - The selector, such as `:root[data-private]`.
 * @param inside - The at-rule that holds the rule, such as `@media (prefers-color-scheme: dark)`.
 */
function declarations(selector: string, inside?: string): Map<string, string> {
  let text = tokensCss;
  if (inside !== undefined) {
    const start = text.indexOf(`${inside} {`);
    if (start === -1) throw new Error(`No ${inside} in tokens.css`);
    text = text.slice(start + inside.length + 2);
  }
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const body = rule.exec(text)?.[1];
  if (body === undefined) throw new Error(`No rule ${selector} in tokens.css`);
  return new Map(
    body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== '')
      .map((declaration) => {
        const colon = declaration.indexOf(':');
        return [
          declaration.slice(0, colon).trim(),
          declaration
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim(),
        ];
      }),
  );
}

/** `--line-1` as `tokens.css` mixes it from `--border-1` at an opacity. */
function line(opacity: number): string {
  return opacity === 1
    ? 'var(--border-1)'
    : `color-mix(in oklch, var(--border-1) ${String(Math.round(opacity * 100))}%, transparent)`;
}

/** The palette tokens of a rule, by token. */
function palette(rule: Map<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(paletteTokens.map((token) => [token, rule.get(`--${token}`)]));
}

const light = declarations(':root');
const dark = declarations(':root', '@media (prefers-color-scheme: dark)');
const privateWindow = declarations(':root[data-private]');

describe('tokens.css', () => {
  it("holds Astela's palette and the danger color of themes.ts in the light and the dark mode", () => {
    expect(palette(light)).toEqual(builtInThemes.astela.light);
    expect(light.get('--danger')).toBe(statusColors.danger.light);
    expect(palette(dark)).toEqual(builtInThemes.astela.dark);
    expect(dark.get('--danger')).toBe(statusColors.danger.dark);
  });

  it('mixes the line and the raised surface from the palette in every mode', () => {
    expect(light.get('--line-1')).toBe(line(lineOpacity.light));
    expect(light.get('--surface-raised')).toBe('var(--surface-1)');
    // The line of the dark mode lets 40 % of the surface below it show through.
    expect(line(lineOpacity.dark)).toBe('color-mix(in oklch, var(--border-1) 60%, transparent)');
    for (const rule of [dark, privateWindow]) {
      expect(rule.get('--line-1')).toBe(line(lineOpacity.dark));
      expect(rule.get('--surface-raised')).toBe(
        'color-mix(in oklch, var(--surface-1), var(--surface-2))',
      );
    }
  });

  it('gives the private windows the colors of the dark mode', () => {
    expect(privateWindow.get('color-scheme')).toBe('dark');
    const withoutScheme = new Map([...privateWindow].filter(([name]) => name !== 'color-scheme'));
    expect(withoutScheme).toEqual(dark);
  });
});
