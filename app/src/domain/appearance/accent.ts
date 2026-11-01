/** A color in OKLCH: lightness 0-1, chroma and hue in degrees. */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

/** Linear sRGB components, 0-1 inside the gamut. */
type Rgb = readonly [number, number, number];

/** Identifiers of the accent colors offered without picking a custom color. */
export const accentPresets = ['blue', 'teal', 'green', 'orange', 'red', 'graphite'] as const;

/** An accent preset. */
export type AccentPreset = (typeof accentPresets)[number];

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

/** The accent of a color mode, as CSS. */
export interface AccentColors {
  readonly light: string;
  readonly dark: string;
}

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
 * The WCAG contrast ratio of two OKLCH colors.
 * @param a - One color.
 * @param b - The other color.
 * @returns A ratio from 1 to 21.
 */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const [la, lb] = [luminance(toRgb(a)), luminance(toRgb(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Reads a `#rrggbb` color.
 * @param hex - The color; anything else reads as black.
 */
export function oklchFromHex(hex: string): Oklch {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const channel = (index: number): number => toLinear(parseInt(match?.[index] ?? '00', 16) / 255);
  const [r, g, b] = [channel(1), channel(2), channel(3)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lab = {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
  const hue = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return { l: lab.l, c: Math.hypot(lab.a, lab.b), h: hue < 0 ? hue + 360 : hue };
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

/** Lowers the chroma until the color fits into sRGB. */
function inGamut(color: Oklch): Oklch {
  const fits = (c: number): boolean =>
    toRgb({ ...color, c }).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (fits(color.c)) {
    return color;
  }
  let [low, high] = [0, color.c];
  for (let i = 0; i < 30; i += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return { ...color, c: low };
}

function toRgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ];
}

function toLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance as WCAG defines it, from linear sRGB clamped to the gamut. */
function luminance([r, g, b]: Rgb): number {
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function css({ l, c, h }: Oklch): string {
  return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${h.toFixed(1)})`;
}
