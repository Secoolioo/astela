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

/**
 * Whether a video of the page of a tab can show in picture in picture: `none` without a video
 * that plays and while picture in picture is off, `available` while a video plays, `open` while
 * a video of the page shows in picture in picture.
 */
export const pictureInPictureStates = ['none', 'available', 'open'] as const;

/** Whether a video of the page of a tab can show, or shows, in picture in picture. */
export type PictureInPictureState = (typeof pictureInPictureStates)[number];
