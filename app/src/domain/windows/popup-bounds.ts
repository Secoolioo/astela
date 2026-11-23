import { startInsets, type Density } from './title-bar.ts';
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

/** The room that the browser's own rows take around the page of a window, in pixels. */
export interface WindowFrame {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const noFrame: WindowFrame = { top: 0, right: 0, bottom: 0, left: 0 };

/** The line that the shell draws below its toolbar, between the toolbar and the page. */
const toolbarLine = 1;

/**
 * The room that the window of a popup takes around its page: the toolbar with its line, as a
 * popup has no tab strip and no bookmarks bar.
 * @param density - The density of the interface, which sets the height of the toolbar.
 */
export function popupFrame(density: Density): WindowFrame {
  const toolbar = startInsets(density, { side: 'none', toolbar: 'own-row' });
  return { ...toolbar, top: toolbar.top + toolbarLine };
}

/**
 * Where a popup that a page opens goes: the size and position that the page asked for in
 * the features of `window.open`, or else beside the window of the page. The size that a page
 * asks for is that of its page, as in other browsers, so the window is larger by its frame;
 * one that asks for no size gets a window of 800 × 600. As in other browsers, the popup lies on
 * a screen and is at most as large as it: on the screen of the position that the page asked for,
 * or else on the screen of the page's window. The smallest size and the screen limit the window.
 * @param features - The features, such as `width=500,height=600,left=20,top=40`.
 * @param opener - The bounds of the window of the page.
 * @param workAreas - The work areas of the screens.
 * @param frame - The room that the rows of the popup's window take around its page.
 */
export function popupBounds(
  features: string,
  opener: WindowBounds,
  workAreas: readonly WindowBounds[] = [],
  frame: WindowFrame = noFrame,
): WindowBounds {
  const asked = new Map<string, number>();
  for (const feature of features.split(/[\s,;]+/)) {
    const [name = '', value = ''] = feature.split('=');
    const number = Number.parseInt(value, 10);
    if (Number.isFinite(number)) asked.set(name.trim().toLowerCase(), number);
  }
  const pageWidth = asked.get('width') ?? asked.get('innerwidth');
  const pageHeight = asked.get('height') ?? asked.get('innerheight');
  const width = Math.max(
    pageWidth === undefined ? 800 : pageWidth + frame.left + frame.right,
    minimumSize.width,
  );
  const height = Math.max(
    pageHeight === undefined ? 600 : pageHeight + frame.top + frame.bottom,
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

/**
 * Where a popup's window goes once it is open, with the frame of the system: the size that a page
 * asks for is that of its page, so a title bar of the system adds to the window that
 * {@link popupBounds} placed. The window stays on the screen of its top left corner, and shrinks
 * and moves to fit it, as the page did, so that the bottom of the page does not lie under the
 * taskbar or the Dock.
 * @param window - The bounds of the window, its frame included.
 * @param workAreas - The work areas of the screens.
 */
export function fittedPopup(
  window: WindowBounds,
  workAreas: readonly WindowBounds[],
): WindowBounds {
  const area = workAreas.find(holds(window)) ?? workAreas.at(0);
  return area === undefined ? window : inside(window, area);
}
