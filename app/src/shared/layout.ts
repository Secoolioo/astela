/** Where the tab strip is: above the page, below it, or as a vertical list at a side. */
export const tabStripPositions = ['top', 'bottom', 'left', 'right'] as const;

/** A position of the tab strip. */
export type TabStripPosition = (typeof tabStripPositions)[number];
