import { minimumSize, type WindowBounds } from './window-bounds.ts';

// Where the popups of pages go. Only the code that opens them reads this, not the start of
// the browser, which reads where the windows of a session were.

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
 * Tells which work areas hold a point.
 * @param point - The point, in screen pixels.
 */
function holds(point: { readonly x: number; readonly y: number }): (area: WindowBounds) => boolean {
  return (area) =>
    point.x >= area.x &&
    point.x < area.x + area.width &&
    point.y >= area.y &&
    point.y < area.y + area.height;
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
  const middle = { x: opener.x + opener.width / 2, y: opener.y + opener.height / 2 };
  const area = workAreas.find(holds(bounds)) ?? workAreas.find(holds(middle)) ?? workAreas.at(0);
  return area === undefined ? bounds : inside(bounds, area);
}
