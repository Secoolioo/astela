import { describe, expect, it } from 'vitest';
import { placePopover, placeSubmenu } from '../overlay/placement.ts';

const window = { width: 1200, height: 800 };
const popover = { width: 280, height: 300 };

describe('placePopover', () => {
  it('lines a popover up with the end of a button in the right half of the window', () => {
    const button = { x: 1100, y: 8, width: 28, height: 28 };
    expect(placePopover(button, popover, window)).toEqual({
      x: 1128 - 280,
      y: 40,
      maxHeight: 800 - 8 - 40,
      above: false,
    });
  });

  it('lines a popover up with the start of a button in the left half of the window', () => {
    const button = { x: 120, y: 70, width: 80, height: 24 };
    expect(placePopover(button, popover, window)).toMatchObject({ x: 120, y: 98, above: false });
  });

  it('lines a popover up with the edge that it asks for, wherever its button is', () => {
    const button = { x: 400, y: 70, width: 80, height: 24 };
    expect(placePopover(button, popover, window, { align: 'end' }).x).toBe(480 - 280);
    expect(placePopover({ ...button, x: 800 }, popover, window, { align: 'start' }).x).toBe(800);
  });

  it('keeps the popover inside the window, 8 px from its edges', () => {
    expect(placePopover({ x: 1180, y: 8, width: 20, height: 20 }, popover, window).x).toBe(912);
    expect(placePopover({ x: 1150, y: 8, width: 28, height: 20 }, popover, window).x).toBe(898);
    expect(placePopover({ x: 2, y: 8, width: 20, height: 20 }, popover, window).x).toBe(8);
    // A popover wider than the window starts at the margin.
    expect(
      placePopover({ x: 500, y: 8, width: 20, height: 20 }, { width: 1300, height: 50 }, window).x,
    ).toBe(8);
  });

  it('opens above its button when there is no room below', () => {
    const button = { x: 100, y: 700, width: 30, height: 30 };
    expect(placePopover(button, popover, window)).toEqual({
      x: 100,
      y: 700 - 4 - 300,
      maxHeight: 700 - 4 - 8,
      above: true,
    });
  });

  it('takes the larger side and scrolls when the popover fits on neither side', () => {
    const tall = { width: 280, height: 900 };
    expect(placePopover({ x: 100, y: 200, width: 30, height: 30 }, tall, window)).toEqual({
      x: 100,
      y: 234,
      maxHeight: 800 - 8 - 234,
      above: false,
    });
    expect(placePopover({ x: 100, y: 600, width: 30, height: 30 }, tall, window)).toEqual({
      x: 100,
      y: 8,
      maxHeight: 600 - 4 - 8,
      above: true,
    });
  });
});

describe('placeSubmenu', () => {
  const submenu = { width: 220, height: 120 };

  it('opens to the right of its item with its first item level with it', () => {
    const item = { x: 900, y: 300, width: 260, height: 32 };
    expect(placeSubmenu(item, submenu, { width: 1600, height: 800 })).toEqual({
      x: 1160,
      y: 296,
      maxHeight: 784,
      above: false,
    });
  });

  it('opens to the left at the edge of the window', () => {
    const item = { x: 900, y: 300, width: 260, height: 32 };
    expect(placeSubmenu(item, submenu, window).x).toBe(900 - 220);
  });

  it('moves up as far as it needs to fit, and starts at the margin when it is taller', () => {
    const item = { x: 100, y: 760, width: 260, height: 32 };
    expect(placeSubmenu(item, submenu, window).y).toBe(800 - 8 - 120);
    expect(placeSubmenu(item, { width: 220, height: 1000 }, window)).toMatchObject({
      y: 8,
      maxHeight: 784,
    });
  });
});
