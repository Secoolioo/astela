import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accentPresets, presetAccentColors } from '../../domain/appearance/accent-presets.ts';
import { contrastRatio, parseColor, type Oklch } from '../../shared/color.ts';
import { swatches } from '../../shared/swatches.ts';
import { builtInThemes, themeIds } from '../../shared/themes.ts';

/** The design tokens of the browser's own views, without their comments. */
const tokensCss = readFileSync(
  join(import.meta.dirname, '..', '..', 'ui', 'ui-kit', 'tokens.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The colors of the swatches in the first rule of tokens.css with a selector, by swatch.
 * @param selector - The selector, such as `:root[data-private]`.
 * @param inside - The at-rule that holds the rule.
 */
function swatchesOf(selector: string, inside?: string): Record<string, Oklch | undefined> {
  const from = inside === undefined ? 0 : tokensCss.indexOf(`${inside} {`) + inside.length + 2;
  const text = tokensCss.slice(from);
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const body = rule.exec(text)?.[1] ?? '';
  return Object.fromEntries(
    swatches.map((swatch) => {
      const value = new RegExp(`--swatch-${swatch}:\\s*([^;]+);`).exec(body)?.[1];
      return [swatch, value === undefined ? undefined : parseColor(value.trim())];
    }),
  );
}

/** A color of the design tokens, which must be one that the tests can read. */
function color(value: string): Oklch {
  const parsed = parseColor(value);
  if (parsed === undefined) throw new Error(`Cannot read ${value}`);
  return parsed;
}

/** The surfaces of a palette that a group's chip and line lie on, with the raised surface. */
function surfacesOf(palette: (typeof builtInThemes)['astela']['light']): Record<string, Oklch> {
  const [one, two] = [color(palette['surface-1']), color(palette['surface-2'])];
  return {
    'surface-0': color(palette['surface-0']),
    'surface-1': one,
    'surface-2': two,
    'surface-hover': color(palette['surface-hover']),
    // The raised surface of the dark mode is the middle of the first two surfaces.
    'surface-raised': { l: (one.l + two.l) / 2, c: (one.c + two.c) / 2, h: one.h },
  };
}

describe('the swatches of groups of tabs', () => {
  it('are the accent presets besides Astela, in their order', () => {
    expect(accentPresets).toEqual(['astela', ...swatches]);
  });

  it('have the colors of the accent presets in tokens.css, in light, dark and private mode', () => {
    const modes = [
      ['light', swatchesOf(':root')],
      ['dark', swatchesOf(':root', '@media (prefers-color-scheme: dark)')],
      ['dark', swatchesOf(':root[data-private]')],
    ] as const;
    for (const [mode, found] of modes) {
      for (const swatch of swatches) {
        const expected = color(presetAccentColors[swatch][mode]);
        const actual = found[swatch];
        expect(actual, `--swatch-${swatch} in ${mode} mode`).toBeDefined();
        expect(actual?.l).toBeCloseTo(expected.l, 5);
        expect(actual?.c).toBeCloseTo(expected.c, 5);
        expect(actual?.h).toBeCloseTo(expected.h, 5);
      }
    }
  });

  it.each(themeIds)('stand out by 3:1 from every surface of %s in both modes', (id) => {
    for (const mode of ['light', 'dark'] as const) {
      for (const [name, surface] of Object.entries(surfacesOf(builtInThemes[id][mode]))) {
        for (const swatch of swatches) {
          // The line of a group and the dot of its chip are parts of the interface, which
          // need 3:1 (docs/architecture/design-system.md).
          expect(
            contrastRatio(color(presetAccentColors[swatch][mode]), surface),
            `${swatch} on ${name} in the ${mode} mode`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
