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

  it('fits a window larger than its screen to the screen, so its title bar buttons are on it', () => {
    expect(visibleBounds({ x: 300, y: 50, width: 2560, height: 1400 }, [screen])).toEqual(screen);
    expect(visibleBounds({ x: 2000, y: 50, width: 1600, height: 900 }, [screen, right])).toEqual({
      x: 1920,
      y: 50,
      width: 1280,
      height: 900,
    });
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

  it('keeps a popup on the screen, at most as large as the screen', () => {
    expect(popupBounds('width=500,height=400,left=1800,top=900', opener, [screen])).toEqual({
      x: 1420,
      y: 640,
      width: 500,
      height: 400,
    });
    expect(popupBounds('width=3000,height=500,left=-50,top=10', opener, [screen, right])).toEqual({
      x: 0,
      y: 10,
      width: 1920,
      height: 500,
    });
    // On the screen that the page asks for, when it has one there.
    expect(popupBounds('width=500,height=400,left=2000,top=10', opener, [screen, right])).toEqual({
      x: 2000,
      y: 10,
      width: 500,
      height: 400,
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
