import { accentColors } from './accent.ts';

/** Which colors the browser uses: those of the system, or always light or dark. */
export const colorModes = ['system', 'light', 'dark'] as const;

/** A color mode. */
export type ColorMode = (typeof colorModes)[number];

/** How much space the browser's controls take. */
export const densities = ['compact', 'normal', 'comfortable'] as const;

/** A density. */
export type Density = (typeof densities)[number];

/** Toolbar and tab height of each density, in CSS pixels, on the 4 px grid. */
const sizes: Readonly<Record<Density, { readonly toolbar: number; readonly tab: number }>> = {
  compact: { toolbar: 32, tab: 28 },
  normal: { toolbar: 40, tab: 32 },
  comfortable: { toolbar: 48, tab: 40 },
};

/**
 * The style sheet that applies the accent and the density to the browser's own pages. It
 * sets design tokens only; `tokens.css` picks the accent of the current color mode.
 * @param appearance - Accent preset or `#rrggbb` color, and density.
 */
export function appearanceCss(appearance: {
  readonly accent: string;
  readonly density: Density;
}): string {
  const accent = accentColors(appearance.accent);
  const size = sizes[appearance.density];
  // Two :root selectors outrank the defaults in tokens.css, whatever the order of sheets.
  return (
    `:root:root{--accent-light:${accent.light};--accent-dark:${accent.dark};` +
    `--toolbar-height:${size.toolbar}px;--tab-height:${size.tab}px}`
  );
}
