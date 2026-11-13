import { describe, expect, it } from 'vitest';
import { parseColor } from '../../shared/color.ts';
import { builtInThemes, themeIds } from '../../shared/themes.ts';
import {
  accentColors,
  accentPresets,
  accentSurfaces,
  contrastRatio,
  minimumAccentContrast,
  oklchFromHex,
} from '../appearance/accent.ts';
import { isAccentPreset, presetAccentColors } from '../appearance/accent-presets.ts';
import { appearanceCss, webFontPreferences } from '../appearance/appearance.ts';

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

  it("pairs Astela's violet with the blue of its logo for progress, and no other accent", () => {
    const { secondary } = accentColors('astela');
    expect(secondary).toEqual({
      light: 'oklch(55.0% 0.180 265.0)',
      dark: 'oklch(72.0% 0.145 265.0)',
    });
    if (secondary === undefined) throw new Error('Astela has a second color');
    expect(contrastRatio(parse(secondary.light), lightSurface)).toBeGreaterThan(
      minimumAccentContrast - 0.02,
    );
    expect(contrastRatio(parse(secondary.dark), darkSurface)).toBeGreaterThan(
      minimumAccentContrast - 0.02,
    );
    expect(accentColors('blue').secondary).toBeUndefined();
    expect(accentColors('#2a7f62').secondary).toBeUndefined();
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

/**
 * The surfaces of a theme's dark palette, with the raised surface of popovers, which
 * `tokens.css` mixes half way between the panels and the fields in OKLCH.
 */
function darkSurfaces(id: (typeof themeIds)[number]) {
  const dark = builtInThemes[id].dark;
  const color = (token: 'surface-0' | 'surface-1' | 'surface-2' | 'surface-hover') => {
    const parsed = parseColor(dark[token]);
    if (parsed === undefined) throw new Error(`Not a color: ${dark[token]}`);
    return parsed;
  };
  const [panel, field] = [color('surface-1'), color('surface-2')];
  return {
    'surface-0': color('surface-0'),
    'surface-1': panel,
    'surface-2': field,
    'surface-hover': color('surface-hover'),
    raised: { l: (panel.l + field.l) / 2, c: (panel.c + field.c) / 2, h: panel.h },
  };
}

describe('accents on the dark surfaces of the built-in themes', () => {
  it.each(themeIds)('are solved against a surface that none of %s is lighter than', (id) => {
    for (const [name, surface] of Object.entries(darkSurfaces(id))) {
      expect(surface.l, `lightness of ${name}`).toBeLessThanOrEqual(accentSurfaces.dark.l);
    }
  });

  it.each(themeIds)('stay readable on every surface of %s', (id) => {
    for (const [name, surface] of Object.entries(darkSurfaces(id))) {
      for (const accent of accentPresets) {
        // Rounding to one decimal of a percent costs at most a hundredth of the ratio.
        expect(
          contrastRatio(parse(accentColors(accent).dark), surface),
          `${accent} on ${name}`,
        ).toBeGreaterThan(minimumAccentContrast - 0.02);
      }
    }
  });
});

describe('the accent bar of the row that the arrow keys mark', () => {
  it.each(themeIds)('stands out from the color under the pointer of %s in both modes', (id) => {
    for (const mode of ['light', 'dark'] as const) {
      const row = parseColor(builtInThemes[id][mode]['surface-hover']);
      if (row === undefined) throw new Error(`No color under the pointer in ${id}`);
      for (const accent of accentPresets) {
        // UI components and their states need 3:1 (docs/architecture/design-system.md).
        expect(
          contrastRatio(parse(accentColors(accent)[mode]), row),
          `${accent} in the ${mode} mode`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
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

  it('sets the color of progress only for an accent that has one', () => {
    const astela = appearanceCss({
      accent: accentColors('astela'),
      density: 'normal',
      textSize: 'medium',
      font: '',
    });
    expect(astela).toContain('--accent-secondary-light:oklch(55.0% 0.180 265.0)');
    expect(astela).toContain('--accent-secondary-dark:oklch(72.0% 0.145 265.0)');
    const green = appearanceCss({
      accent: accentColors('green'),
      density: 'normal',
      textSize: 'medium',
      font: '',
    });
    expect(green).not.toContain('--accent-secondary');
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

describe('webFontPreferences', () => {
  it('gives web pages the named fonts and the text size, and keeps the others', () => {
    expect(
      webFontPreferences(
        { standard: 'DejaVu Serif', serif: '', sansSerif: '', fixed: 'Fira Code' },
        20,
      ),
    ).toEqual({
      defaultFontFamily: { standard: 'DejaVu Serif', monospace: 'Fira Code' },
      defaultFontSize: 20,
    });
    expect(webFontPreferences({ standard: '', serif: '', sansSerif: '', fixed: '' }, 16)).toEqual({
      defaultFontFamily: {},
      defaultFontSize: 16,
    });
  });
});

describe('appearanceCss with a theme', () => {
  it('sets the colors of the theme for both modes and private windows', () => {
    const css = appearanceCss({
      accent: presetAccentColors.blue,
      density: 'normal',
      textSize: 'medium',
      font: '',
      theme: builtInThemes.forest,
    });
    expect(css).toContain(`--surface-0:${builtInThemes.forest.light['surface-0']}`);
    expect(css).toContain(
      `@media (prefers-color-scheme: dark){:root:root{--surface-0:${builtInThemes.forest.dark['surface-0']}`,
    );
    expect(css).toContain(
      `:root:root[data-private]{--surface-0:${builtInThemes.forest.dark['surface-0']}`,
    );
    expect(
      appearanceCss({
        accent: presetAccentColors.blue,
        density: 'normal',
        textSize: 'medium',
        font: '',
      }),
    ).not.toContain('--surface-0');
  });
});
