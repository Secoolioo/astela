import { describe, expect, it } from 'vitest';
import { ResizeSplit } from '../ipc/shell-later-contracts.ts';
import {
  clampRatio,
  minPaneWidth,
  ratioAt,
  splitDivider,
  splitMarker,
  splitPanes,
  splitPreviewEvery,
  splitRatio,
} from '../split-view.ts';

describe('splitPanes', () => {
  it('divides the area into whole pixels that leave no gap and do not overlap', () => {
    const area = { x: 10, y: 80, width: 1001, height: 600 };
    for (const ratio of [0.2, 0.33, 0.5, 0.61, 0.8]) {
      const { start, divider, end } = splitPanes(area, ratio);
      expect(start.width + splitDivider + end.width).toBe(area.width);
      expect(start.x).toBe(area.x);
      expect(divider.x).toBe(start.x + start.width);
      expect(end.x).toBe(divider.x + splitDivider);
      for (const pane of [start, end]) {
        expect(Number.isInteger(pane.width)).toBe(true);
        expect(pane.y).toBe(area.y + splitMarker);
        expect(pane.height).toBe(area.height - splitMarker);
      }
      expect(divider).toMatchObject({ y: area.y, height: area.height, width: splitDivider });
    }
    expect(splitPanes(area, 0.5).start.width).toBe(497);
  });

  it('keeps each side at least 200 px wide while the area has room, and halves a narrow one', () => {
    const area = { x: 0, y: 0, width: 600, height: 400 };
    expect(splitPanes(area, 0.2).start.width).toBe(minPaneWidth);
    expect(splitPanes(area, 0.8).end.width).toBe(minPaneWidth);
    const narrow = { x: 0, y: 0, width: 300, height: 400 };
    expect(splitPanes(narrow, 0.2).start.width).toBe(146);
    expect(splitPanes(narrow, 0.8).end.width).toBe(146);
    const none = splitPanes({ x: 0, y: 0, width: 0, height: 0 }, 0.5);
    for (const pane of [none.start, none.end]) {
      expect(pane.width).toBe(0);
      expect(pane.height).toBe(0);
    }
  });

  it('clamps shares outside their limits', () => {
    const area = { x: 0, y: 0, width: 2008, height: 400 };
    expect(splitPanes(area, 0.05).start.width).toBe(400);
    expect(splitPanes(area, 0.99).start.width).toBe(1600);
    expect(splitPanes(area, Number.NaN).start.width).toBe(1000);
  });
});

describe('clampRatio and ratioAt', () => {
  it('keeps a share between 0.2 and 0.8, to a thousandth', () => {
    expect(clampRatio(0.1)).toBe(splitRatio.min);
    expect(clampRatio(0.95)).toBe(splitRatio.max);
    expect(clampRatio(0.55 + 0.05)).toBe(0.6);
    expect(clampRatio(0.12345 + 0.2)).toBe(0.323);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(splitRatio.even);
  });

  it('follows the pointer with the middle of the divider', () => {
    const area = { x: 100, y: 0, width: 1008, height: 500 };
    expect(ratioAt(area, 100 + 4 + 500)).toBe(0.5);
    expect(ratioAt(area, 100 + 4 + 250)).toBe(0.25);
    expect(ratioAt(area, 0)).toBe(0.2);
    expect(ratioAt(area, 5000)).toBe(0.8);
    // The share of the pointer gives the divider back under the pointer.
    const { divider } = splitPanes(area, ratioAt(area, 700));
    expect(divider.x + splitDivider / 2).toBe(700);
  });
});

describe('splitPreviewEvery', () => {
  it('sends fewer previews than the budget of the channel gives back, on any display', () => {
    const budget = ResizeSplit.ratePerSecond ?? 0;
    // A second of a drag holds no more previews than this, so the budget never runs out.
    expect(1000 / splitPreviewEvery).toBeLessThan(budget - 100);
    // Still one per frame on a display of 120 Hz.
    expect(splitPreviewEvery).toBeLessThanOrEqual(1000 / 120);
  });
});
