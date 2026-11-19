/** Where the tab strip is: above the page, below it, or as a vertical list at a side. */
export const tabStripPositions = ['top', 'bottom', 'left', 'right'] as const;

/** A position of the tab strip. */
export type TabStripPosition = (typeof tabStripPositions)[number];

/**
 * Where the toolbar with the address bar is: in a row of its own below the tabs, or in the
 * row of the tabs, which works with the tab strip at the top only.
 */
export const toolbarPlacements = ['own-row', 'tab-row'] as const;

/** A place of the toolbar. */
export type ToolbarPlacement = (typeof toolbarPlacements)[number];

/**
 * The buttons of the toolbar that can be hidden and moved: the reader view, picture in picture,
 * the star, the shield and downloads.
 */
export const toolbarItems = [
  'reader',
  'pictureInPicture',
  'bookmark',
  'shield',
  'downloads',
] as const;

/** A button of the toolbar that can be hidden and moved. */
export type ToolbarItem = (typeof toolbarItems)[number];
