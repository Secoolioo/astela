// The geometry of a split view, which shows two tabs of a window side by side. The browser
// process lays the two pages out with it, and the shell draws the divider and the line of the
// side with the focus with it, so the two cannot drift apart. The sizes are layout widths in
// CSS pixels; the density of the interface does not scale them.

/** The width of the divider between the two sides. */
export const splitDivider = 8;

/** The height of the line above the sides, which marks the side with the focus. */
export const splitMarker = 2;

/** The width that each side keeps at least, while the content area has room for both. */
export const minPaneWidth = 200;

/**
 * The share of the width of the two sides that the left side takes: at least, at most, for a
 * new split view, and the step of the arrow keys on the divider.
 */
export const splitRatio = { min: 0.2, max: 0.8, even: 0.5, step: 0.05 } as const;

/**
 * The shortest time in ms between two shares that the pages show while the divider moves:
 * one per frame, and no more often than 125 times a second on a faster display. The previews
 * then use less of the budget of `tabs.resizeSplit` than it gives back, however long the drag
 * goes on, and the share that counts when the divider is let go always finds room in it.
 */
export const splitPreviewEvery = 8;

/** A rectangle of the content area, in CSS pixels. */
export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the two sides and the divider between them lie in the content area. */
export interface SplitPanes {
  /** The left side, which shows the first tab of the pair. */
  readonly start: PaneRect;
  /** The divider, over the whole height of the content area. */
  readonly divider: PaneRect;
  /** The right side, which shows the second tab of the pair. */
  readonly end: PaneRect;
}

/**
 * A share of the left side within its limits, to a thousandth; one that is no number gives
 * both sides the same width.
 * @param ratio - The share, such as from a stored session.
 */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return splitRatio.even;
  const clamped = Math.min(splitRatio.max, Math.max(splitRatio.min, ratio));
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Where the sides of a split view lie in the content area, in whole pixels. The left side
 * takes its share of the width without the divider, and each side keeps at least
 * {@link minPaneWidth} while the area has room for both; a narrower area is halved. The sides
 * start below the line of the side with the focus, and the pieces neither overlap nor leave a
 * gap.
 * @param area - The content area.
 * @param ratio - The share of the left side.
 */
export function splitPanes(area: PaneRect, ratio: number): SplitPanes {
  const usable = Math.max(0, Math.round(area.width) - splitDivider);
  const least = Math.min(minPaneWidth, Math.floor(usable / 2));
  const startWidth = Math.min(
    usable - least,
    Math.max(least, Math.round(usable * clampRatio(ratio))),
  );
  const top = area.y + Math.min(splitMarker, Math.max(0, area.height));
  const height = Math.max(0, area.height - splitMarker);
  const dividerX = area.x + startWidth;
  return {
    start: { x: area.x, y: top, width: startWidth, height },
    divider: { x: dividerX, y: area.y, width: splitDivider, height: Math.max(0, area.height) },
    end: { x: dividerX + splitDivider, y: top, width: usable - startWidth, height },
  };
}

/**
 * The share of the left side for a point of the pointer over the content area, as when the
 * divider is dragged: the middle of the divider follows the pointer.
 * @param area - The content area.
 * @param clientX - Where the pointer is, in the coordinates of the area.
 */
export function ratioAt(area: PaneRect, clientX: number): number {
  const usable = Math.max(1, area.width - splitDivider);
  return clampRatio((clientX - area.x - splitDivider / 2) / usable);
}
