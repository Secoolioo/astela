import { describe, expect, it } from 'vitest';
import { visibleBounds } from '../windows/window-bounds.ts';
import { fittedPopup, popupBounds, popupFrame } from '../windows/popup-bounds.ts';

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

  it('gives the page the size it asks for, the frame of the window around it', () => {
    const toolbar = { top: 40, right: 0, bottom: 0, left: 0 };
    expect(popupBounds('width=520,height=420', opener, [], toolbar)).toEqual({
      x: 240,
      y: 140,
      width: 520,
      height: 460,
    });
    const around = { top: 40, right: 2, bottom: 4, left: 6 };
    expect(
      popupBounds('innerWidth=600,innerHeight=500,left=10,top=20', opener, [], around),
    ).toEqual({ x: 10, y: 20, width: 608, height: 544 });
    // A size that the page does not ask for keeps the window's own size.
    expect(popupBounds('width=520', opener, [], toolbar)).toEqual({
      x: 240,
      y: 140,
      width: 520,
      height: 600,
    });
    expect(popupBounds('', opener, [], toolbar)).toEqual({
      x: 240,
      y: 140,
      width: 800,
      height: 600,
    });
  });

  it('frames the page of a popup with its toolbar and the line below it', () => {
    expect(popupFrame('normal')).toEqual({ top: 41, right: 0, bottom: 0, left: 0 });
    expect(popupFrame('compact')).toEqual({ top: 33, right: 0, bottom: 0, left: 0 });
    expect(popupBounds('width=520,height=420', opener, [], popupFrame('comfortable'))).toEqual({
      x: 240,
      y: 140,
      width: 520,
      height: 469,
    });
  });

  it('limits the window with its frame to the smallest size and to the screen', () => {
    const toolbar = { top: 40, right: 0, bottom: 0, left: 0 };
    // 300 × 200 and the toolbar are less than the smallest window.
    expect(popupBounds('width=300,height=200', opener, [], toolbar)).toEqual({
      x: 240,
      y: 140,
      width: 480,
      height: 320,
    });
    // A page of 290 and the toolbar are higher than the smallest window.
    expect(popupBounds('width=500,height=290', opener, [], toolbar).height).toBe(330);
    // The page and its frame fit the screen, and the window moves up to fit.
    expect(popupBounds('width=500,height=1020,left=100,top=0', opener, [screen], toolbar)).toEqual({
      x: 100,
      y: 0,
      width: 500,
      height: 1040,
    });
    expect(popupBounds('width=500,height=1000,left=100,top=30', opener, [screen], toolbar)).toEqual(
      { x: 100, y: 0, width: 500, height: 1040 },
    );
  });
});

describe('fittedPopup', () => {
  const opener = { x: 200, y: 100, width: 1280, height: 820 };

  it('keeps the window of a large popup with the title bar of the system on its screen', () => {
    // The page of the popup fills the work area, and the system adds its title bar of 31 pixels.
    const page = popupBounds('popup,width=6000,height=6000,left=40,top=0', opener, [screen]);
    expect(page).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    const window = { ...page, height: page.height + 31 };
    expect(fittedPopup(window, [screen])).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
    // At the bottom of the screen, the window moves up before it shrinks.
    expect(fittedPopup({ x: 100, y: 700, width: 520, height: 451 }, [screen])).toEqual({
      x: 100,
      y: 589,
      width: 520,
      height: 451,
    });
  });

  it('leaves a window that fits, and one beyond every screen, where it is', () => {
    const fits = { x: 100, y: 100, width: 520, height: 451 };
    expect(fittedPopup(fits, [screen])).toEqual(fits);
    expect(fittedPopup(fits, [])).toEqual(fits);
  });

  it('fits the window on the screen of its top left corner', () => {
    expect(fittedPopup({ x: 2000, y: 600, width: 800, height: 600 }, [screen, right])).toEqual({
      x: 2000,
      y: 400,
      width: 800,
      height: 600,
    });
  });
});
