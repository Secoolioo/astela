import { describe, expect, it } from 'vitest';
import {
  controlsOverlay,
  startInsets,
  titleBarArea,
  toolbarRow,
  windowButtonsAt,
} from '../windows/title-bar.ts';

/** The heights of the row of the tabs with the toolbar in it, at the three densities. */
const oneRowHeights = (platform: string): number[] =>
  (['compact', 'normal', 'comfortable'] as const).map(
    (density) => titleBarArea(platform, density, { side: 'top', toolbar: 'tab-row' }).height,
  );

/** Where the three buttons of a macOS window are with the tabs at the top. */
const buttonsAt = (
  density: 'compact' | 'normal' | 'comfortable',
  toolbar: 'own-row' | 'tab-row',
): { x: number; y: number } =>
  windowButtonsAt(titleBarArea('darwin', density, { side: 'top', toolbar }));

describe('title bar', () => {
  it('puts the window controls at the start on macOS and at the end elsewhere, in the top row', () => {
    expect(titleBarArea('darwin', 'normal', { side: 'top', toolbar: 'own-row' })).toEqual({
      side: 'start',
      size: 76,
      height: 36,
    });
    expect(titleBarArea('win32', 'compact', { side: 'top', toolbar: 'own-row' })).toEqual({
      side: 'end',
      size: 138,
      height: 30,
    });
    // Without tabs at the top, the toolbar is the top row.
    expect(titleBarArea('linux', 'comfortable', { side: 'left', toolbar: 'own-row' })).toEqual({
      side: 'end',
      size: 138,
      height: 48,
    });
  });

  it('makes the row of the tabs as high as the toolbar when the toolbar is in it, at every density', () => {
    expect(oneRowHeights('linux')).toEqual([32, 40, 48]);
    expect(oneRowHeights('win32')).toEqual([32, 40, 48]);
    expect(oneRowHeights('darwin')).toEqual([32, 40, 48]);
    // The toolbar keeps its own row with the tabs elsewhere, whatever the setting says.
    expect(titleBarArea('win32', 'normal', { side: 'bottom', toolbar: 'tab-row' }).height).toBe(40);
  });

  it('puts the toolbar into the row of the tabs only with the tabs at the top', () => {
    expect(toolbarRow('top', 'tab-row')).toBe('tab-row');
    expect(toolbarRow('top', 'own-row')).toBe('own-row');
    for (const side of ['bottom', 'left', 'right'] as const) {
      expect(toolbarRow(side, 'tab-row')).toBe('own-row');
    }
  });

  it('centers the three buttons of a macOS window in the top row', () => {
    // In one row with the toolbar, at 9, 13 and 17 px from the top.
    expect([
      buttonsAt('compact', 'tab-row'),
      buttonsAt('normal', 'tab-row'),
      buttonsAt('comfortable', 'tab-row'),
    ]).toEqual([
      { x: 14, y: 9 },
      { x: 14, y: 13 },
      { x: 14, y: 17 },
    ]);
    expect(buttonsAt('normal', 'own-row')).toEqual({ x: 14, y: 11 });
    expect(windowButtonsAt({ side: 'start', size: 76, height: 4 })).toEqual({ x: 14, y: 0 });
  });

  it('starts the content area below the rows of the shell, or next to a vertical tab strip', () => {
    expect(startInsets('normal', { side: 'top', toolbar: 'own-row' })).toEqual({
      top: 76,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(startInsets('compact', { side: 'bottom', toolbar: 'own-row' })).toEqual({
      top: 32,
      right: 0,
      bottom: 30,
      left: 0,
    });
    expect(startInsets('comfortable', { side: 'left', toolbar: 'own-row' })).toEqual({
      top: 48,
      right: 0,
      bottom: 0,
      left: 240,
    });
  });

  it('starts the content area below the one row of the tabs and the toolbar, at every density', () => {
    const tops = (['compact', 'normal', 'comfortable'] as const).map(
      (density) => startInsets(density, { side: 'top', toolbar: 'tab-row' }).top,
    );
    expect(tops).toEqual([32, 40, 48]);
    // With the tabs elsewhere, the toolbar keeps its row.
    expect(startInsets('normal', { side: 'left', toolbar: 'tab-row' })).toEqual({
      top: 40,
      right: 0,
      bottom: 0,
      left: 240,
    });
  });

  it('gives a popup without a tab strip only its toolbar, which is its top row', () => {
    const popup = { side: 'none', toolbar: 'own-row' } as const;
    expect(startInsets('normal', popup)).toEqual({ top: 40, right: 0, bottom: 0, left: 0 });
    expect(startInsets('compact', popup)).toEqual({ top: 32, right: 0, bottom: 0, left: 0 });
    expect(titleBarArea('linux', 'normal', popup)).toEqual({ side: 'end', size: 138, height: 40 });
    const colors = { window: '#f5f7f9', toolbar: '#fdfdff' };
    expect(controlsOverlay(titleBarArea('win32', 'normal', popup), colors, 'none').color).toBe(
      '#fdfdff',
    );
    // The toolbar of a popup keeps a row of its own, also where the settings put it in the row of
    // the tabs.
    expect(toolbarRow('none', 'tab-row')).toBe('own-row');
  });

  it('gives the window controls the color and the height of the row that they sit on', () => {
    const light = { window: '#f5f7f9', toolbar: '#fdfdff' };
    const dark = { window: '#14161a', toolbar: '#1f2226' };
    // Behind a tab strip at the top lies the background of the window.
    expect(
      controlsOverlay(
        titleBarArea('win32', 'normal', { side: 'top', toolbar: 'own-row' }),
        light,
        'top',
      ),
    ).toEqual({
      color: '#f5f7f9',
      symbolColor: '#1f2329',
      height: 36,
    });
    // Also with the toolbar in the row of the tabs, as high as the toolbar.
    expect(
      controlsOverlay(
        titleBarArea('linux', 'normal', { side: 'top', toolbar: 'tab-row' }),
        dark,
        'top',
      ),
    ).toEqual({
      color: '#14161a',
      symbolColor: '#e8eaed',
      height: 40,
    });
    // Otherwise, the toolbar is the top row.
    expect(
      controlsOverlay(
        titleBarArea('linux', 'compact', { side: 'left', toolbar: 'own-row' }),
        dark,
        'left',
      ),
    ).toEqual({
      color: '#1f2226',
      symbolColor: '#e8eaed',
      height: 32,
    });
    expect(
      controlsOverlay(
        titleBarArea('win32', 'normal', { side: 'bottom', toolbar: 'own-row' }),
        light,
        'bottom',
      ).color,
    ).toBe('#fdfdff');
  });
});
