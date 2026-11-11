import * as v from 'valibot';

/** The design tokens that a theme sets for each color mode: surfaces, texts and lines. */
export const paletteTokens = [
  'surface-0',
  'surface-1',
  'surface-2',
  'surface-hover',
  'text-1',
  'text-2',
  'border-1',
] as const;

/** A design token that a theme sets. */
export type PaletteToken = (typeof paletteTokens)[number];

/** The colors of a theme in one color mode, as CSS, by token. */
export type Palette = Readonly<Record<PaletteToken, string>>;

/** The colors of a theme in the light and in the dark mode. */
export interface ThemeColors {
  readonly light: Palette;
  readonly dark: Palette;
}

/** The built-in themes. True Dark changes only the dark mode, to black for OLED screens. */
export const themeIds = ['astela', 'paper', 'forest', 'ocean', 'slate', 'true-dark'] as const;

/** A built-in theme. */
export type ThemeId = (typeof themeIds)[number];

/** A theme choice: a built-in theme, or the colors that people chose themselves. */
export type ThemeChoice = ThemeId | 'custom';

const o = (l: number, c: number, h: number): string =>
  `oklch(${String(l)}% ${String(Number(c.toFixed(4)))} ${String(h)})`;

/** A palette from the lightness of each token, with one chroma and hue for surfaces and texts. */
function palette(
  lightness: readonly [number, number, number, number, number, number, number],
  surface: { readonly c: number; readonly h: number },
  text: { readonly c: number; readonly h: number },
): Palette {
  const [s0, s1, s2, hover, t1, t2, border] = lightness;
  return {
    'surface-0': o(s0, surface.c, surface.h),
    'surface-1': o(s1, surface.c * 0.7, surface.h),
    'surface-2': o(s2, surface.c * 1.3, surface.h),
    'surface-hover': o(hover, surface.c * 1.5, surface.h),
    'text-1': o(t1, text.c, text.h),
    'text-2': o(t2, text.c, text.h),
    'border-1': o(border, surface.c * 1.3, surface.h),
  };
}

/** Astela's colors, as `tokens.css` has them. */
const astela: ThemeColors = {
  light: {
    'surface-0': 'oklch(97.5% 0.003 260)',
    'surface-1': 'oklch(99.5% 0.002 260)',
    'surface-2': 'oklch(93% 0.005 260)',
    'surface-hover': 'oklch(91% 0.006 260)',
    'text-1': 'oklch(22% 0.01 260)',
    'text-2': 'oklch(45% 0.01 260)',
    'border-1': 'oklch(88% 0.006 260)',
  },
  dark: {
    'surface-0': 'oklch(20% 0.008 260)',
    'surface-1': 'oklch(25% 0.009 260)',
    'surface-2': 'oklch(29% 0.01 260)',
    'surface-hover': 'oklch(33% 0.011 260)',
    'text-1': 'oklch(95% 0.005 260)',
    'text-2': 'oklch(75% 0.01 260)',
    'border-1': 'oklch(36% 0.01 260)',
  },
};

/**
 * The colors of the built-in themes. Astela's are those of `tokens.css`; every theme keeps a
 * contrast of at least 4.5:1 for its texts on its surfaces, which a test checks.
 */
export const builtInThemes: Readonly<Record<ThemeId, ThemeColors>> = {
  astela,
  paper: {
    light: palette([96.5, 99, 92, 89.5, 24, 46, 87], { c: 0.012, h: 80 }, { c: 0.015, h: 60 }),
    dark: palette([21, 25.5, 29.5, 33.5, 94, 75, 36], { c: 0.01, h: 70 }, { c: 0.012, h: 80 }),
  },
  forest: {
    light: palette([96.8, 99.2, 92.5, 90, 23, 45, 87.5], { c: 0.01, h: 155 }, { c: 0.02, h: 160 }),
    dark: palette(
      [20, 24.5, 28.5, 32.5, 94.5, 75, 35.5],
      { c: 0.014, h: 160 },
      { c: 0.012, h: 155 },
    ),
  },
  ocean: {
    light: palette(
      [96.8, 99.3, 92.5, 90, 22, 45, 87.5],
      { c: 0.012, h: 230 },
      { c: 0.025, h: 240 },
    ),
    dark: palette([19.5, 24, 28, 32, 95, 75, 35], { c: 0.02, h: 245 }, { c: 0.012, h: 230 }),
  },
  slate: {
    light: palette([97, 99.5, 92.5, 90, 21, 44, 87], { c: 0, h: 0 }, { c: 0, h: 0 }),
    dark: palette([19, 23.5, 27.5, 31.5, 95, 74, 34], { c: 0, h: 0 }, { c: 0, h: 0 }),
  },
  'true-dark': {
    light: astela.light,
    dark: palette([0, 12, 17, 21, 96, 76, 24], { c: 0, h: 0 }, { c: 0, h: 0 }),
  },
};

/**
 * The window color of each built-in theme, `surface-0` as `#rrggbb`, which shows until the
 * shell has painted. They are written out, so the start needs no color math; a test checks
 * that they match.
 */
export const themeBackgrounds: Readonly<
  Record<ThemeId, { readonly light: string; readonly dark: string }>
> = {
  astela: { light: '#f5f7f9', dark: '#14161a' },
  paper: { light: '#f8f3eb', dark: '#1b1813' },
  forest: { light: '#eff7f1', dark: '#111814' },
  ocean: { light: '#edf6fb', dark: '#0d161d' },
  slate: { light: '#f5f5f5', dark: '#141414' },
  'true-dark': { light: '#f5f7f9', dark: '#000000' },
};

/** A color that people chose, as `#rrggbb`. */
const Hex = v.pipe(v.string(), v.regex(/^#[0-9a-f]{6}$/i));

/** The colors of one mode that people chose; a token without a color keeps Astela's. */
const CustomPalette = v.strictObject({
  'surface-0': v.optional(Hex),
  'surface-1': v.optional(Hex),
  'surface-2': v.optional(Hex),
  'surface-hover': v.optional(Hex),
  'text-1': v.optional(Hex),
  'text-2': v.optional(Hex),
  'border-1': v.optional(Hex),
});

/** The colors of the custom theme, in the light and in the dark mode. */
export const CustomTheme = v.strictObject({ light: CustomPalette, dark: CustomPalette });

/** The colors of the custom theme. */
export type CustomTheme = v.InferOutput<typeof CustomTheme>;

/**
 * Whether a value names a built-in theme.
 * @param value - The value.
 */
export function isThemeId(value: unknown): value is ThemeId {
  return themeIds.some((id) => id === value);
}

/**
 * The colors of a theme choice: those of a built-in theme, or Astela's with the colors that
 * people chose instead. Astela itself needs no colors, `tokens.css` has them.
 * @param theme - The choice.
 * @param custom - The colors that people chose.
 */
export function themeColors(theme: ThemeChoice, custom: CustomTheme): ThemeColors | undefined {
  if (theme === 'astela') return undefined;
  if (theme !== 'custom') return builtInThemes[theme];
  const base = builtInThemes.astela;
  return {
    light: mergePalette(base.light, custom.light),
    dark: mergePalette(base.dark, custom.dark),
  };
}

/**
 * The window colors of a theme choice, light and dark.
 * @param theme - The choice.
 * @param custom - The colors that people chose.
 */
export function windowColors(
  theme: ThemeChoice,
  custom: CustomTheme,
): { readonly light: string; readonly dark: string } {
  if (theme !== 'custom') return themeBackgrounds[theme];
  return {
    light: custom.light['surface-0'] ?? themeBackgrounds.astela.light,
    dark: custom.dark['surface-0'] ?? themeBackgrounds.astela.dark,
  };
}

/** A palette with the colors that people chose in place of its own. */
function mergePalette(base: Palette, chosen: CustomTheme['light']): Palette {
  const result: Record<PaletteToken, string> = { ...base };
  for (const token of paletteTokens) {
    const color = chosen[token];
    if (color !== undefined) result[token] = color;
  }
  return result;
}
