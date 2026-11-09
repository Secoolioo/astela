/**
 * Tells whether a URL that comes from a web page may open in a new tab, whether the page
 * asked for a window or the user picked a link in its context menu. Only http and https
 * qualify: internal `app://` pages, local files and `data:`, `blob:` or `javascript:`
 * URLs never open on behalf of a page.
 * @param url - The URL from the page.
 */
export function mayOpenInNewTab(url: string): boolean {
  return /^https?:/i.test(url);
}

/**
 * Tells whether a page may open a window or tab with a script, which then keeps the page as
 * its opener: what a new tab may open, and a blank page that the opener fills itself.
 * @param url - The URL from the page.
 */
export function mayOpenWindow(url: string): boolean {
  return mayOpenInNewTab(url) || /^about:blank(?:[?#].*)?$/i.test(url);
}
