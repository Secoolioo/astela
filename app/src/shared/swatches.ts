/**
 * The colors that people give a group of tabs, and later a workspace: the six accent presets
 * besides Astela's own accent, in the order that pickers offer them. The interface draws each
 * one with its token `--swatch-<name>` of `tokens.css`, in light and dark mode.
 */
export const swatches = ['blue', 'teal', 'green', 'orange', 'red', 'graphite'] as const;

/** A color of a group of tabs. */
export type Swatch = (typeof swatches)[number];
