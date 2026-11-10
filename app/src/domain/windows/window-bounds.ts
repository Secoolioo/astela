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
 * The bounds of a window if enough of its top edge lies on one of the screens to grab it,
 * cut to the smallest size; otherwise nothing, and the window opens where the system puts it.
 * @param bounds - Where the window was.
 * @param workAreas - The work areas of the screens now.
 */
export function visibleBounds(
  bounds: WindowBounds,
  workAreas: readonly WindowBounds[],
): WindowBounds | undefined {
  const width = Math.max(bounds.width, minimumSize.width);
  const height = Math.max(bounds.height, minimumSize.height);
  const grabbed = workAreas.some((area) => {
    const left = Math.max(bounds.x, area.x);
    const right = Math.min(bounds.x + width, area.x + area.width);
    const top = Math.max(bounds.y, area.y);
    const bottom = Math.min(bounds.y + visibleEdge.height, area.y + area.height);
    return right - left >= visibleEdge.width && bottom - top >= visibleEdge.height;
  });
  return grabbed ? { x: bounds.x, y: bounds.y, width, height } : undefined;
}

/**
 * Where a popup that a page opens goes: the size and position that the page asked for in
 * the features of `window.open`, or else beside the window of the page.
 * @param features - The features, such as `width=500,height=600,left=20,top=40`.
 * @param opener - The bounds of the window of the page.
 */
export function popupBounds(features: string, opener: WindowBounds): WindowBounds {
  const asked = new Map<string, number>();
  for (const feature of features.split(/[\s,;]+/)) {
    const [name = '', value = ''] = feature.split('=');
    const number = Number.parseInt(value, 10);
    if (Number.isFinite(number)) asked.set(name.trim().toLowerCase(), number);
  }
  const width = Math.max(asked.get('width') ?? asked.get('innerwidth') ?? 800, minimumSize.width);
  const height = Math.max(
    asked.get('height') ?? asked.get('innerheight') ?? 600,
    minimumSize.height,
  );
  return {
    x: asked.get('left') ?? asked.get('screenx') ?? opener.x + 40,
    y: asked.get('top') ?? asked.get('screeny') ?? opener.y + 40,
    width,
    height,
  };
}
