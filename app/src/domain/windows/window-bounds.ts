/** Where a window is on the screens, in screen pixels. */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The smallest window that the browser opens. */
export const minimumSize = { width: 480, height: 320 } as const;

/** How much of a window's top edge must lie on a screen, so that it can be moved. */
const visibleEdge = { width: 120, height: 40 };

/**
 * The bounds of a window if enough of its top edge lies on one of the screens to grab it, at
 * least at the smallest size; otherwise nothing, and the window opens where the system puts
 * it. A window larger than that screen, such as one from a larger screen before, fits the
 * screen, so that its title bar and the buttons on it are on the screen.
 * @param bounds - Where the window was.
 * @param workAreas - The work areas of the screens now.
 */
export function visibleBounds(
  bounds: WindowBounds,
  workAreas: readonly WindowBounds[],
): WindowBounds | undefined {
  const width = Math.max(bounds.width, minimumSize.width);
  const height = Math.max(bounds.height, minimumSize.height);
  const area = workAreas.find((candidate) => {
    const left = Math.max(bounds.x, candidate.x);
    const right = Math.min(bounds.x + width, candidate.x + candidate.width);
    const top = Math.max(bounds.y, candidate.y);
    const bottom = Math.min(bounds.y + visibleEdge.height, candidate.y + candidate.height);
    return right - left >= visibleEdge.width && bottom - top >= visibleEdge.height;
  });
  if (area === undefined) return undefined;
  return {
    x: width > area.width ? area.x : bounds.x,
    y: height > area.height ? area.y : bounds.y,
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
  };
}
