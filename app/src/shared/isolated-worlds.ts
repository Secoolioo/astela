/**
 * The isolated worlds that the browser runs its own scripts in, inside web pages. Each world has
 * its own globals and its own wrappers of the DOM, which the page's scripts cannot reach;
 * Electron's preloads run in world 999.
 */

/** The scriptlets of the content blocker that must not run in the page's own world. */
export const scriptletWorld = 1001;

/** The tools of the browser for pages, such as the reader view (ADR 0057). */
export const pageToolsWorld = 1002;
