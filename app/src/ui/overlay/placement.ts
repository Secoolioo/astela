/** A rectangle in CSS pixels of the overlay, which covers the window. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The size of a popover, or of the overlay. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where a popover goes. */
export interface Placement {
  /** Its left edge. */
  readonly x: number;
  /** Its top edge. */
  readonly y: number;
  /** The height that it may take; a taller popover scrolls inside. */
  readonly maxHeight: number;
  /** Whether it lies above its anchor, because there is no room below it. */
  readonly above: boolean;
}

/** How a popover lines up with its anchor. */
export interface PopoverPlacing {
  /** Distance to the edges of the window. */
  readonly margin?: number;
  /** Distance to the anchor. */
  readonly gap?: number;
  /**
   * The edge of the anchor that the popover lines up with: its end, its start, or `auto`,
   * the end of an anchor in the right half of the window and the start otherwise.
   */
  readonly align?: 'start' | 'end' | 'auto';
}

/**
 * Where a popover of a button goes: below the button, or above it when there is no room
 * below, lined up with an edge of the button and inside the window. A popover that fits on
 * neither side goes where there is more room, and scrolls.
 * @param anchor - The button.
 * @param size - The popover's size.
 * @param viewport - The size of the overlay.
 * @param placing - Margins and the edge to line up with.
 */
export function placePopover(
  anchor: Rect,
  size: Size,
  viewport: Size,
  placing: PopoverPlacing = {},
): Placement {
  const { margin = 8, gap = 4, align = 'auto' } = placing;
  const end =
    align === 'end' || (align === 'auto' && anchor.x + anchor.width / 2 >= viewport.width / 2);
  const wanted = end ? anchor.x + anchor.width - size.width : anchor.x;
  const x = Math.max(margin, Math.min(wanted, viewport.width - size.width - margin));
  const below = Math.max(0, viewport.height - margin - (anchor.y + anchor.height + gap));
  const aboveRoom = Math.max(0, anchor.y - gap - margin);
  const above = size.height > below && (size.height <= aboveRoom || aboveRoom > below);
  if (!above) return { x, y: anchor.y + anchor.height + gap, maxHeight: below, above: false };
  const height = Math.min(size.height, aboveRoom);
  return { x, y: anchor.y - gap - height, maxHeight: aboveRoom, above: true };
}

/**
 * Where a submenu goes: next to its item, to the right unless it would leave the window,
 * with its first item level with the item, and moved up as far as it needs to fit.
 * @param item - The item that opens the submenu.
 * @param size - The submenu's size.
 * @param viewport - The size of the overlay.
 * @param placing - Distance to the edges of the window, and how far the submenu reaches
 *   above its item to line up its first item, the padding of the menu.
 */
export function placeSubmenu(
  item: Rect,
  size: Size,
  viewport: Size,
  placing: { readonly margin?: number; readonly inset?: number } = {},
): Placement {
  const { margin = 8, inset = 4 } = placing;
  const right = item.x + item.width;
  const fitsRight = right + size.width <= viewport.width - margin;
  const x = fitsRight ? right : Math.max(margin, item.x - size.width);
  const maxHeight = Math.max(0, viewport.height - 2 * margin);
  const lowest = viewport.height - margin - Math.min(size.height, maxHeight);
  const y = Math.max(margin, Math.min(item.y - inset, lowest));
  return { x, y, maxHeight, above: false };
}
