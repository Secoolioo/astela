import { describe, expect, it } from 'vitest';
import { popupBounds, visibleBounds } from '../windows/window-bounds.ts';

const screen = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 1000 };

describe('visibleBounds', () => {
  it('keeps a window whose top edge lies on a screen', () => {
    const bounds = { x: 100, y: 50, width: 1200, height: 800 };
    expect(visibleBounds(bounds, [screen])).toEqual(bounds);
    expect(visibleBounds({ ...bounds, x: 2000 }, [screen, right])).toEqual({ ...bounds, x: 2000 });
  });

  it('drops a window on a screen that is gone, or whose top edge is out of reach', () => {
    expect(visibleBounds({ x: 2000, y: 50, width: 800, height: 600 }, [screen])).toBeUndefined();
    expect(visibleBounds({ x: 1850, y: 50, width: 800, height: 600 }, [screen])).toBeUndefined();
    expect(visibleBounds({ x: 100, y: 1020, width: 800, height: 600 }, [screen])).toBeUndefined();
  });

  it('opens a window at least at the smallest size', () => {
    expect(visibleBounds({ x: 10, y: 10, width: 100, height: 50 }, [screen])).toEqual({
      x: 10,
      y: 10,
      width: 480,
      height: 320,
    });
  });
});

describe('popupBounds', () => {
  const opener = { x: 200, y: 100, width: 1280, height: 820 };

  it('opens a popup where and as large as the page asks', () => {
    expect(popupBounds('width=500,height=600,left=20,top=40', opener)).toEqual({
      x: 20,
      y: 40,
      width: 500,
      height: 600,
    });
    expect(popupBounds('popup, innerWidth=520 ; innerHeight=640', opener)).toEqual({
      x: 240,
      y: 140,
      width: 520,
      height: 640,
    });
  });

  it('opens a popup without features beside its opener, at least at the smallest size', () => {
    expect(popupBounds('', opener)).toEqual({ x: 240, y: 140, width: 800, height: 600 });
    expect(popupBounds('width=10,height=abc', opener)).toEqual({
      x: 240,
      y: 140,
      width: 480,
      height: 600,
    });
  });
});
