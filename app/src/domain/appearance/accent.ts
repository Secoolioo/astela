import { contrastRatio, css, inGamut, oklchFromHex, type Oklch } from '../../shared/color.ts';
import { accentPresets, type AccentColors, type AccentPreset } from './accent-presets.ts';

export {
  accentPresets,
  contrastRatio,
  oklchFromHex,
  type AccentColors,
  type AccentPreset,
  type Oklch,
};

/** Hue and chroma of each preset; the lightness follows from the contrast rule. */
const presets: Readonly<Record<AccentPreset, { readonly c: number; readonly h: number }>> = {
  blue: { c: 0.17, h: 255 },
  teal: { c: 0.11, h: 195 },
  green: { c: 0.15, h: 150 },
  orange: { c: 0.16, h: 55 },
  red: { c: 0.19, h: 25 },
  graphite: { c: 0.02, h: 260 },
};

function isPreset(accent: string): accent is AccentPreset {
  return Object.hasOwn(presets, accent);
}

/** The lightest light surface and the lightest dark surface that accents appear on. */
const lightSurface: Oklch = { l: 0.995, c: 0.002, h: 260 };
const darkSurface: Oklch = { l: 0.33, c: 0.011, h: 260 };

/** Contrast that accents keep against those surfaces, as WCAG requires for text. */
export const minimumAccentContrast = 4.5;

/**
 * Computes the accent for light and dark mode. A preset or a custom `#rrggbb` color keeps
 * its hue; its lightness changes only as far as needed for a contrast of at least 4.5:1
 * against the surfaces of each mode.
 * @param accent - A preset, such as `blue`, or a custom color, such as `#2a7f62`.
 */
export function accentColors(accent: string): AccentColors {
  const preset = isPreset(accent) ? presets[accent] : undefined;
  const base: Oklch =
    preset === undefined ? oklchFromHex(accent) : { l: 0.55, c: preset.c, h: preset.h };
  const light = solve(base, lightSurface, 'darker');
  const dark = solve(preset === undefined ? base : { ...base, l: 0.72 }, darkSurface, 'lighter');
  return { light: css(light), dark: css(dark) };
}

/**
 * Moves a color's lightness until it has the minimum contrast against a surface: darker on
 * light surfaces, lighter on dark ones. A color that passes already stays as it is.
 */
function solve(color: Oklch, surface: Oklch, direction: 'darker' | 'lighter'): Oklch {
  const passes = (l: number): boolean =>
    contrastRatio(inGamut({ ...color, l }), surface) >= minimumAccentContrast;
  if (passes(color.l)) {
    return inGamut(color);
  }
  // Bisection between the color and the end of the lightness range, which always passes.
  let [failing, passing] = direction === 'darker' ? [color.l, 0] : [color.l, 1];
  for (let i = 0; i < 30; i += 1) {
    const middle = (failing + passing) / 2;
    if (passes(middle)) passing = middle;
    else failing = middle;
  }
  return inGamut({ ...color, l: passing });
}
