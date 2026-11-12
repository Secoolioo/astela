import { describe, expect, it } from 'vitest';
import { controlsRoom } from '../window-controls.ts';

describe('controlsRoom', () => {
  it('keeps the side and the room of the browser process until the window tells where', () => {
    expect(controlsRoom({ side: 'start', size: 76 })).toEqual({ side: 'start', start: 76, end: 0 });
    expect(controlsRoom({ side: 'end', size: 138 })).toEqual({ side: 'end', start: 0, end: 138 });
    // In full screen on Linux, the window reports no free area.
    expect(
      controlsRoom({ side: 'end', size: 138 }, { x: 0, width: 0, height: 0, viewport: 1280 }),
    ).toEqual({ side: 'end', start: 0, end: 138 });
  });

  it('leaves room where the window has its controls', () => {
    const area = { side: 'end', size: 138 } as const;
    // Windows, and Linux desktops with the buttons at the end.
    expect(controlsRoom(area, { x: 0, width: 1142, height: 36, viewport: 1280 })).toEqual({
      side: 'end',
      start: 0,
      end: 138,
    });
    // A Linux desktop with the buttons at the start, or at both ends.
    expect(controlsRoom(area, { x: 104, width: 1176, height: 36, viewport: 1280 })).toEqual({
      side: 'start',
      start: 104,
      end: 0,
    });
    expect(controlsRoom(area, { x: 38, width: 1172, height: 36, viewport: 1280 })).toEqual({
      side: 'both',
      start: 38,
      end: 70,
    });
    // A desktop without window buttons leaves the whole row free.
    expect(controlsRoom(area, { x: 0, width: 1280, height: 36, viewport: 1280 })).toEqual({
      side: 'end',
      start: 0,
      end: 0,
    });
  });
});
