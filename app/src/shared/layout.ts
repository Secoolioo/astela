/** Where the tab strip is: above the page, below it, or as a vertical list at a side. */
export const tabStripPositions = ['top', 'bottom', 'left', 'right'] as const;

/** A position of the tab strip. */
export type TabStripPosition = (typeof tabStripPositions)[number];

/** The buttons of the toolbar that can be hidden and moved: the star, the shield and downloads. */
export const toolbarItems = ['bookmark', 'shield', 'downloads'] as const;

/** A button of the toolbar that can be hidden and moved. */
export type ToolbarItem = (typeof toolbarItems)[number];
