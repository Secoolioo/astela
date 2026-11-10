import { describe, expect, it } from 'vitest';
import {
  accentColors,
  accentPresets,
  contrastRatio,
  minimumAccentContrast,
  oklchFromHex,
} from '../appearance/accent.ts';
import { isAccentPreset, presetAccentColors } from '../appearance/accent-presets.ts';
import { appearanceCss } from '../appearance/appearance.ts';

const parse = (css: string): { l: number; c: number; h: number } => {
  const match = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(css);
  if (match === null) throw new Error(`Not an oklch color: ${css}`);
  return { l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) };
};
const lightSurface = { l: 0.995, c: 0.002, h: 260 };
const darkSurface = { l: 0.33, c: 0.011, h: 260 };

describe('accent colors', () => {
  it('keeps every preset and custom color readable in both modes', () => {
    for (const accent of [...accentPresets, '#7c3aed', '#ffcc00', '#000000', '#ffffff']) {
      const { light, dark } = accentColors(accent);
      // Rounding to one decimal of a percent costs at most a hundredth of the ratio.
      expect(contrastRatio(parse(light), lightSurface)).toBeGreaterThan(
        minimumAccentContrast - 0.02,
      );
      expect(contrastRatio(parse(dark), darkSurface)).toBeGreaterThan(minimumAccentContrast - 0.02);
    }
  });

  it('keeps the hue and changes the lightness only where needed', () => {
    expect(accentColors('blue')).toEqual({
      light: 'oklch(55.0% 0.170 255.0)',
      dark: 'oklch(72.0% 0.148 255.0)',
    });
    const yellow = accentColors('#ffcc00');
    expect(parse(yellow.light).l).toBeLessThan(0.6);
    expect(parse(yellow.dark).h).toBeCloseTo(oklchFromHex('#ffcc00').h, 0);
    expect(parse(yellow.dark).l).toBeCloseTo(oklchFromHex('#ffcc00').l, 2);
  });

  it('writes out the colors of the presets as the color math computes them', () => {
    for (const preset of accentPresets) {
      expect(presetAccentColors[preset]).toEqual(accentColors(preset));
      expect(isAccentPreset(preset)).toBe(true);
    }
    expect(isAccentPreset('#2a7f62')).toBe(false);
    expect(isAccentPreset('constructor')).toBe(false);
  });

  it('reads hex colors and measures contrast as WCAG does', () => {
    expect(contrastRatio(oklchFromHex('#000000'), oklchFromHex('#ffffff'))).toBeCloseTo(21, 1);
    expect(contrastRatio(oklchFromHex('#777777'), oklchFromHex('#ffffff'))).toBeCloseTo(4.48, 1);
    expect(oklchFromHex('not a color')).toEqual(oklchFromHex('#000000'));
  });
});

describe('appearanceCss', () => {
  it('sets the accent of both modes and the sizes of the density and the text size', () => {
    const css = appearanceCss({
      accent: accentColors('green'),
      density: 'compact',
      textSize: 'medium',
      font: '',
    });
    expect(css).toMatch(/^:root:root\{/);
    expect(css).toContain(`--accent-light:${accentColors('green').light}`);
    expect(css).toContain(`--accent-dark:${accentColors('green').dark}`);
    expect(css).toContain('--toolbar-height:32px;--tab-height:28px');
    expect(css).toContain('--control-height:24px');
    expect(css).toContain('--space-2:4px');
    expect(css).toContain('--font-size-ui:13px');
    expect(css).not.toContain('--font-ui');
    const roomy = appearanceCss({
      accent: accentColors('blue'),
      density: 'comfortable',
      textSize: 'larger',
      font: ' Inter Display ',
    });
    expect(roomy).toContain('--toolbar-height:48px;--tab-height:40px');
    expect(roomy).toContain('--space-7:56px');
    expect(roomy).toContain('--font-size-ui:16px');
    expect(roomy).toContain('--line-height-ui:20px');
    expect(roomy).toContain('--font-ui:"Inter Display",var(--font-system)');
    expect(roomy.length).toBeLessThan(4096);
  });

  it('keeps the font of the system for a name that could break out of the style sheet', () => {
    const css = appearanceCss({
      accent: accentColors('blue'),
      density: 'normal',
      textSize: 'medium',
      font: 'x";}body{color:red',
    });
    expect(css).not.toContain('--font-ui');
    expect(css).not.toContain('color:red');
  });
});
