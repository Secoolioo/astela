import { describe, expect, it } from 'vitest';
import { contrastRatio, hexFromOklch, parseColor, type Oklch } from '../color.ts';
import {
  builtInThemes,
  paletteTokens,
  statusColors,
  themeBackgrounds,
  themeColors,
  themeIds,
  themeToolbars,
  toolbarColors,
  windowColors,
  type Palette,
} from '../themes.ts';

const color = (value: string) => {
  const parsed = parseColor(value);
  if (parsed === undefined) throw new Error(`Not a color: ${value}`);
  return parsed;
};

/** The built-in themes whose dark surfaces step evenly; True Dark keeps its black for OLED. */
const evenThemes = themeIds.filter((id) => id !== 'true-dark');

/** The lightness of a token of a palette, in percent. */
const lightness = (palette: Palette, token: (typeof paletteTokens)[number]): number =>
  color(palette[token]).l * 100;

/**
 * The surfaces of a dark palette that texts and the danger color sit on, with the raised
 * surface of popovers, which `tokens.css` mixes half way between the panels and the fields in
 * OKLCH. The surfaces of a palette share one hue.
 */
function darkSurfaces(
  palette: Palette,
): Readonly<Record<'surface-0' | 'surface-1' | 'surface-2' | 'surface-hover' | 'raised', Oklch>> {
  const panel = color(palette['surface-1']);
  const field = color(palette['surface-2']);
  return {
    'surface-0': color(palette['surface-0']),
    'surface-1': panel,
    'surface-2': field,
    'surface-hover': color(palette['surface-hover']),
    raised: { l: (panel.l + field.l) / 2, c: (panel.c + field.c) / 2, h: panel.h },
  };
}

describe('built-in themes', () => {
  it.each(themeIds)('keep texts readable on their surfaces in %s', (id) => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = builtInThemes[id][mode];
      for (const text of ['text-1', 'text-2'] as const) {
        for (const surface of ['surface-0', 'surface-1', 'surface-2', 'surface-hover'] as const) {
          expect(
            contrastRatio(color(palette[text]), color(palette[surface])),
            `${mode} ${text} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it.each(themeIds)('have the window colors of their background in %s', (id) => {
    expect(hexFromOklch(color(builtInThemes[id].light['surface-0']))).toBe(
      themeBackgrounds[id].light,
    );
    expect(hexFromOklch(color(builtInThemes[id].dark['surface-0']))).toBe(
      themeBackgrounds[id].dark,
    );
  });

  it.each(themeIds)('have the toolbar colors of their toolbar in %s', (id) => {
    expect(hexFromOklch(color(builtInThemes[id].light['surface-1']))).toBe(themeToolbars[id].light);
    expect(hexFromOklch(color(builtInThemes[id].dark['surface-1']))).toBe(themeToolbars[id].dark);
  });
});

describe('the dark mode of the built-in themes', () => {
  it.each(evenThemes)('steps the surfaces evenly and keeps the line close in %s', (id) => {
    const dark = builtInThemes[id].dark;
    const steps = [
      lightness(dark, 'surface-1') - lightness(dark, 'surface-0'),
      lightness(dark, 'surface-2') - lightness(dark, 'surface-1'),
      lightness(dark, 'surface-hover') - lightness(dark, 'surface-2'),
    ];
    for (const step of steps) {
      expect(step, `steps ${steps.join(', ')}`).toBeGreaterThanOrEqual(3);
      expect(step, `steps ${steps.join(', ')}`).toBeLessThanOrEqual(4);
    }
    const line = lightness(dark, 'border-1') - lightness(dark, 'surface-hover');
    expect(line).toBeGreaterThanOrEqual(3);
    expect(line).toBeLessThanOrEqual(4.5);
  });

  it.each(themeIds)('keeps the color under the pointer a step above popovers in %s', (id) => {
    const surfaces = darkSurfaces(builtInThemes[id].dark);
    // The rows of popovers, such as the address suggestions, lie on the raised surface.
    const step = surfaces['surface-2'].l - surfaces['surface-1'].l;
    expect(surfaces['surface-hover'].l - surfaces.raised.l).toBeGreaterThanOrEqual(step);
  });

  it.each(themeIds)('keeps the danger color readable on every surface in %s', (id) => {
    for (const [name, surface] of Object.entries(darkSurfaces(builtInThemes[id].dark))) {
      expect(
        contrastRatio(color(statusColors.danger.dark), surface),
        `danger on ${name}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('themeColors and windowColors', () => {
  it('fill the colors that people left with those of Astela', () => {
    const custom = { light: { 'surface-0': '#ffeedd' }, dark: { 'text-1': '#ffffff' } };
    const colors = themeColors('custom', custom);
    expect(colors?.light['surface-0']).toBe('#ffeedd');
    expect(colors?.light['text-1']).toBe(builtInThemes.astela.light['text-1']);
    expect(colors?.dark['text-1']).toBe('#ffffff');
    expect(Object.keys(colors?.dark ?? {})).toEqual([...paletteTokens]);
    expect(themeColors('astela', custom)).toBeUndefined();
    expect(windowColors('custom', custom)).toEqual({
      light: '#ffeedd',
      dark: themeBackgrounds.astela.dark,
    });
    expect(windowColors('true-dark', custom).dark).toBe('#000000');
    // The toolbar has the color of the panels, surface-1.
    expect(toolbarColors('custom', { light: { 'surface-1': '#fafafa' }, dark: {} })).toEqual({
      light: '#fafafa',
      dark: themeToolbars.astela.dark,
    });
    expect(toolbarColors('paper', custom)).toEqual(themeToolbars.paper);
  });
});

describe('parseColor and hexFromOklch', () => {
  it('read and write colors', () => {
    expect(hexFromOklch(color('#2a7f62'))).toBe('#2a7f62');
    expect(parseColor('oklch(50% 0.1 120)')).toEqual({ l: 0.5, c: 0.1, h: 120 });
    expect(parseColor('red')).toBeUndefined();
  });
});
