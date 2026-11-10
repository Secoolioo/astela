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

/**
 * Bounds that lie in a work area, at most as large as it.
 * @param bounds - The bounds wanted.
 * @param area - The work area.
 */
function inside(bounds: WindowBounds, area: WindowBounds): WindowBounds {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

/**
 * Where a popup that a page opens goes: the size and position that the page asked for in
 * the features of `window.open`, or else beside the window of the page. As in other
 * browsers, the popup lies on a screen and is at most as large as it: on the screen of the
 * position that the page asked for, or else on the screen of the page's window.
 * @param features - The features, such as `width=500,height=600,left=20,top=40`.
 * @param opener - The bounds of the window of the page.
 * @param workAreas - The work areas of the screens.
 */
export function popupBounds(
  features: string,
  opener: WindowBounds,
  workAreas: readonly WindowBounds[] = [],
): WindowBounds {
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
  const bounds = {
    x: asked.get('left') ?? asked.get('screenx') ?? opener.x + 40,
    y: asked.get('top') ?? asked.get('screeny') ?? opener.y + 40,
    width,
    height,
  };
  const holds = (point: { readonly x: number; readonly y: number }) => (area: WindowBounds) =>
    point.x >= area.x &&
    point.x < area.x + area.width &&
    point.y >= area.y &&
    point.y < area.y + area.height;
  const middle = { x: opener.x + opener.width / 2, y: opener.y + opener.height / 2 };
  const area = workAreas.find(holds(bounds)) ?? workAreas.find(holds(middle)) ?? workAreas.at(0);
  return area === undefined ? bounds : inside(bounds, area);
}
