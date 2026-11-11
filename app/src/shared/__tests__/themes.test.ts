import { describe, expect, it } from 'vitest';
import { contrastRatio, hexFromOklch, parseColor } from '../color.ts';
import {
  builtInThemes,
  paletteTokens,
  themeBackgrounds,
  themeColors,
  themeIds,
  windowColors,
} from '../themes.ts';

const color = (value: string) => {
  const parsed = parseColor(value);
  if (parsed === undefined) throw new Error(`Not a color: ${value}`);
  return parsed;
};

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
  });
});

describe('parseColor and hexFromOklch', () => {
  it('read and write colors', () => {
    expect(hexFromOklch(color('#2a7f62'))).toBe('#2a7f62');
    expect(parseColor('oklch(50% 0.1 120)')).toEqual({ l: 0.5, c: 0.1, h: 120 });
    expect(parseColor('red')).toBeUndefined();
  });
});
