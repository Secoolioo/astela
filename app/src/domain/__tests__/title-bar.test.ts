import { describe, expect, it } from 'vitest';
import { startInsets, titleBarArea } from '../windows/title-bar.ts';

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
});
