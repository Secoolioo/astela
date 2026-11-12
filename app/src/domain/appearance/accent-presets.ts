/** Identifiers of the accent colors offered without picking a custom color. */
export const accentPresets = [
  'astela',
  'blue',
  'teal',
  'green',
  'orange',
  'red',
  'graphite',
] as const;

/** An accent preset. */
export type AccentPreset = (typeof accentPresets)[number];

/** The accent of a color mode, as CSS. */
export interface AccentColors {
  readonly light: string;
  readonly dark: string;
  /**
   * A second color, for progress, where the accent has one: Astela's own accent pairs the
   * violet of its logo with the blue of it. Without one, progress takes the accent.
   */
  readonly secondary?: { readonly light: string; readonly dark: string };
}

/**
 * The accents of the presets, as `accentColors` in `accent.ts` computes them. They are
 * written out, so the start of the browser needs no color math for a preset; a test checks
 * that they match.
 */
export const presetAccentColors: Readonly<Record<AccentPreset, AccentColors>> = {
  astela: {
    light: 'oklch(55.0% 0.240 290.0)',
    dark: 'oklch(72.0% 0.157 290.0)',
    secondary: { light: 'oklch(55.0% 0.180 265.0)', dark: 'oklch(72.0% 0.145 265.0)' },
  },
  blue: { light: 'oklch(55.0% 0.170 255.0)', dark: 'oklch(72.0% 0.148 255.0)' },
  teal: { light: 'oklch(55.0% 0.094 195.0)', dark: 'oklch(72.0% 0.110 195.0)' },
  green: { light: 'oklch(54.8% 0.150 150.0)', dark: 'oklch(72.0% 0.150 150.0)' },
  orange: { light: 'oklch(55.0% 0.136 55.0)', dark: 'oklch(72.0% 0.160 55.0)' },
  red: { light: 'oklch(55.0% 0.190 25.0)', dark: 'oklch(72.0% 0.174 25.0)' },
  graphite: { light: 'oklch(55.0% 0.020 260.0)', dark: 'oklch(72.0% 0.020 260.0)' },
};

/**
 * Whether an accent is one of the presets.
 * @param accent - A preset, such as `blue`, or a custom color, such as `#2a7f62`.
 */
export function isAccentPreset(accent: string): accent is AccentPreset {
  return Object.hasOwn(presetAccentColors, accent);
}
