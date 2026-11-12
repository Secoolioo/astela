import { describe, expect, it } from 'vitest';
import { controlsOverlay, startInsets, titleBarArea } from '../windows/title-bar.ts';

describe('title bar', () => {
  it('puts the window controls at the start on macOS and at the end elsewhere, in the top row', () => {
    expect(titleBarArea('darwin', 'normal', 'top')).toEqual({
      side: 'start',
      size: 76,
      height: 36,
    });
    expect(titleBarArea('win32', 'compact', 'top')).toEqual({ side: 'end', size: 138, height: 30 });
    // Without tabs at the top, the toolbar is the top row.
    expect(titleBarArea('linux', 'comfortable', 'left')).toEqual({
      side: 'end',
      size: 138,
      height: 48,
    });
  });

  it('starts the content area below the rows of the shell, or next to a vertical tab strip', () => {
    expect(startInsets('normal', 'top')).toEqual({ top: 76, right: 0, bottom: 0, left: 0 });
    expect(startInsets('compact', 'bottom')).toEqual({ top: 32, right: 0, bottom: 30, left: 0 });
    expect(startInsets('comfortable', 'left')).toEqual({ top: 48, right: 0, bottom: 0, left: 240 });
  });

  it('gives the window controls the color and the height of the row that they sit on', () => {
    const light = { window: '#f5f7f9', toolbar: '#fdfdff' };
    const dark = { window: '#14161a', toolbar: '#1f2226' };
    // Behind a tab strip at the top lies the background of the window.
    expect(controlsOverlay(titleBarArea('win32', 'normal', 'top'), light, 'top')).toEqual({
      color: '#f5f7f9',
      symbolColor: '#1f2329',
      height: 36,
    });
    // Otherwise, the toolbar is the top row.
    expect(controlsOverlay(titleBarArea('linux', 'compact', 'left'), dark, 'left')).toEqual({
      color: '#1f2226',
      symbolColor: '#e8eaed',
      height: 32,
    });
    expect(controlsOverlay(titleBarArea('win32', 'normal', 'bottom'), light, 'bottom').color).toBe(
      '#fdfdff',
    );
  });
});
