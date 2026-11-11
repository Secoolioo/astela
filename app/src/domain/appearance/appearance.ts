import type { AccentColors } from './accent-presets.ts';

/** Which colors the browser uses: those of the system, or always light or dark. */
export const colorModes = ['system', 'light', 'dark'] as const;

/** A color mode. */
export type ColorMode = (typeof colorModes)[number];

/** How much space the browser's controls take. */
export const densities = ['compact', 'normal', 'comfortable'] as const;

/** A density. */
export type Density = (typeof densities)[number];

/** How large the text of the browser's own UI is. */
export const textSizes = ['small', 'medium', 'large', 'larger'] as const;

/** A text size. */
export type TextSize = (typeof textSizes)[number];

/**
 * The sizes of each density, in CSS pixels: the toolbar, the tabs, the controls, the rows of
 * lists, and the spacing steps `--space-1` to `--space-7`.
 */
const densitySizes: Readonly<Record<Density, Readonly<Record<string, number>>>> = {
  compact: {
    'toolbar-height': 32,
    'tab-height': 28,
    'control-small': 24,
    'control-height': 24,
    'control-large': 28,
    'row-height': 40,
    ...spacing([2, 4, 8, 12, 16, 24, 32]),
  },
  normal: {
    'toolbar-height': 40,
    'tab-height': 32,
    'control-small': 24,
    'control-height': 28,
    'control-large': 32,
    'row-height': 48,
    ...spacing([4, 8, 12, 16, 24, 32, 48]),
  },
  comfortable: {
    'toolbar-height': 48,
    'tab-height': 40,
    'control-small': 28,
    'control-height': 32,
    'control-large': 40,
    'row-height': 56,
    ...spacing([4, 12, 16, 20, 32, 40, 56]),
  },
};

/** The font sizes and line heights of each text size, in CSS pixels. */
const textSizeTokens: Readonly<Record<TextSize, Readonly<Record<string, number>>>> = {
  small: text([10, 11, 12, 13, 15, 18, 24], [16, 20, 20, 24, 32]),
  medium: text([11, 12, 13, 14, 16, 20, 28], [16, 20, 24, 28, 36]),
  large: text([12, 13, 14, 15, 17, 22, 30], [20, 20, 24, 28, 36]),
  larger: text([13, 14, 16, 17, 19, 24, 32], [20, 24, 24, 32, 40]),
};

/** The spacing tokens for the steps of a density. */
function spacing(steps: readonly number[]): Record<string, number> {
  return Object.fromEntries(steps.map((size, index) => [`space-${String(index + 1)}`, size]));
}

/** The font size and line height tokens of a text size, from the smallest to the largest. */
function text(sizes: readonly number[], lines: readonly number[]): Record<string, number> {
  const names = ['tiny', 'small', 'ui', 'large', 'larger', 'title', 'display'];
  const lineNames = ['ui', 'large', 'larger', 'title', 'display'];
  return Object.fromEntries([
    ...sizes.map((size, index) => [`font-size-${names[index] ?? ''}`, size]),
    ...lines.map((size, index) => [`line-height-${lineNames[index] ?? ''}`, size]),
  ]);
}

/**
 * The names of fonts that the browser may use as its font: letters, digits, spaces, dots,
 * hyphens and underscores, so a name can be quoted in a style sheet.
 */
export const fontNamePattern = /^[\p{L}\p{N} ._-]{0,64}$/u;

/**
 * The style sheet that applies the accent, the density, the text size and the font to the
 * browser's own pages. It sets design tokens only; `tokens.css` picks the accent of the
 * current color mode.
 * @param appearance - The colors of the accent, the density, the text size, and the name of
 *   the font; an empty name keeps the font of the system.
 */
export function appearanceCss(appearance: {
  readonly accent: AccentColors;
  readonly density: Density;
  readonly textSize: TextSize;
  readonly font: string;
}): string {
  const accent = appearance.accent;
  const sizes = { ...densitySizes[appearance.density], ...textSizeTokens[appearance.textSize] };
  const tokens = Object.entries(sizes).map(([name, size]) => `--${name}:${String(size)}px`);
  const font = appearance.font.trim();
  if (font !== '' && fontNamePattern.test(font))
    tokens.push(`--font-ui:"${font}",var(--font-system)`);
  // Two :root selectors outrank the defaults in tokens.css, whatever the order of sheets.
  return (
    `:root:root{--accent-light:${accent.light};--accent-dark:${accent.dark};` +
    `${tokens.join(';')}}`
  );
}
