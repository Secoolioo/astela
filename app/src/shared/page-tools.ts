/**
 * Whether the page of a tab has a reader view: `none` for pages without an article and while
 * the reader view is off, `available` for an article, `open` while the reader view shows it.
 */
export const readerStates = ['none', 'available', 'open'] as const;

/** Whether the page of a tab has a reader view. */
export type ReaderState = (typeof readerStates)[number];

/** The fonts of the reader view: that of the browser, or the serif font of web pages. */
export const readerFonts = ['browser', 'serif'] as const;

/** A font of the reader view. */
export type ReaderFont = (typeof readerFonts)[number];
