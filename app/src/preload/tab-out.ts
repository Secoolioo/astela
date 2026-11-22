/**
 * The keys that move the focus between a page and the toolbar, for the preloads of web pages and
 * of the browser's own pages. Chromium hands the focus to the browser when Tab runs past the
 * last element of a page, or Shift+Tab past its first, and Electron sends it round the same page
 * (`TakeFocus`) without telling anyone. The page tells the browser instead, which moves the
 * focus on to the toolbar, as other browsers do; when the focus comes back from the toolbar, the
 * page starts over at its start, or at its end for Shift+Tab, with nothing focused, so that the
 * next key goes to its first or its last element.
 */

/** What the watch reads of the document of a page. */
export interface TabOutDocument {
  /**
   * The focused element of the page, the element of a frame of the page that has the focus, or
   * its body or `null` while none has the focus.
   */
  readonly activeElement: Element | null;
  /** The body of the page. */
  readonly body: HTMLElement | null;
  /** Whether the page, or a frame of it, has the focus of the window. */
  hasFocus(): boolean;
}

/** How long the watch waits for a frame of another process that the focus went to. */
const frameWait = 1000;

/**
 * Tells when Tab or Shift+Tab leaves a page. When nothing in the page and its frames is left to
 * focus, Blink takes the focus from the page's frame, right after the key, and hands it to the
 * browser: the page's window gets `blur` while the page has no focus. The other ways of the key
 * end differently. Within the page, the next element gets `focusin`; into a frame, the window
 * gets `blur` while the page keeps the focus, at once for a frame of the page's own process and
 * for a frame of another process once that frame has taken the focus, which may also send it
 * back to the page or on to the browser. Until then the page has the focus and no focused
 * element. A page whose frame had no focus before the key, as after Electron sent the focus
 * round a page with nothing to focus, has none after it either and fires nothing. A key that the
 * page handled itself, such as in a dialog that keeps the focus, that types a character of an
 * input method, or that a script of the page made up, leaves nothing.
 * @param target - The window of the page, which sees its keys and its focus first.
 * @param document - The document of the page.
 * @param send - Tells the browser, with whether Shift+Tab left at the start.
 */
export function watchTabOut(
  target: EventTarget,
  document: TabOutDocument,
  send: (reverse: boolean) => void,
): void {
  let pressed: KeyboardEvent | undefined;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  /** Ends the watch of the key that was pressed, which left the page or not. */
  const settle = (left: boolean): void => {
    const key = pressed;
    pressed = undefined;
    clearTimeout(waiting);
    if (left && key !== undefined && !key.defaultPrevented) send(key.shiftKey);
  };
  target.addEventListener(
    'keydown',
    (key) => {
      if (!isKeyPress(key) || key.key !== 'Tab' || key.ctrlKey || key.altKey || key.metaKey) return;
      // Keys that the page's scripts made up move no focus out of the page.
      if (!key.isTrusted || key.isComposing) return;
      settle(false);
      pressed = key;
      waiting = setTimeout(() => {
        const active = document.activeElement;
        // An element, or a frame of the page's own process, has the focus now.
        if (key.defaultPrevented || (active !== null && active !== document.body)) settle(false);
        else if (!document.hasFocus()) settle(true);
        // The focus is on its way to a frame of another process, which tells the window.
        else waiting = setTimeout(() => settle(false), frameWait);
      }, 0);
    },
    true,
  );
  target.addEventListener(
    'blur',
    (event) => {
      if (pressed !== undefined && event.target === target) settle(!document.hasFocus());
    },
    true,
  );
  target.addEventListener('focusin', () => settle(false), true);
}

/** Whether an event is a key press. */
function isKeyPress(event: Event): event is KeyboardEvent {
  return 'key' in event && 'shiftKey' in event;
}

/**
 * Starts the focus of a page over, with nothing focused, so that Tab goes to its first element
 * and Shift+Tab to its last. Blink starts the next key where the focus last was, also after
 * `blur()`; a mark that takes the focus at the start or the end of the page and goes away
 * leaves the place of the next key there.
 * @param document - The document of the page.
 * @param reverse - Whether the page starts at its end, for Shift+Tab.
 */
export function startOver(document: Document, reverse: boolean): void {
  const parent = document.body ?? document.documentElement;
  if (parent === null) return;
  const mark = document.createElement('span');
  mark.tabIndex = -1;
  if (reverse) parent.append(mark);
  else parent.prepend(mark);
  mark.focus({ preventScroll: true });
  mark.remove();
}
