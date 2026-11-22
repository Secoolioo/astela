# 0065. Keyboard focus between the toolbar and the page

## Status

Accepted. Amends [ADR 0054](0054-split-view-with-two-tabs-side-by-side.md): the shell's view gets `focusOnNavigation: false` too, not only the views of tabs. Extends [ADR 0028](0028-content-blocker-rules-through-a-frame-preload.md): the frame preload of the top frame tells the browser when Tab leaves the page. Built in the fixes of 0.1.0-beta.7.

## Date

2026-11-15

## Context

The shell and each page are separate `WebContentsView`s of a window. A test of the beta.7 build found that the keyboard could not move between them:

- When Tab runs past the last element of a page, or Shift+Tab past its first, Blink hands the focus to the browser (`TakeFocus`). Electron 45 sends it round the same page (`FocusThroughTabTraversal`) and emits no event, so the focus wrapped inside the page.
- The shell's own Tab order had no step into the page, and F6 always went to the address bar. After Ctrl+L, find or any button of the toolbar, a person with the keyboard alone got back into the page only with Enter in the address bar, which loaded the page again and lost its scroll position and what was typed in it.
- At the start, the shell's first navigation committed after the window had given the page of the first tab the focus, and took it, because Electron focuses a view of type `window` whose main frame commits in an active window unless `focusOnNavigation` is false. The setup guide of a new profile, a link from another program and the restored session started without the focus, and Tab went round the toolbar.
- The tab strip had a roving `tabindex` without keys: only the active tab was in the Tab order, and the arrows, Home, End, Enter and Delete did nothing on it.

Chrome, Edge and Firefox go from the end of a page to the toolbar and from the end of the toolbar into the page, and F6 moves between the panes of the window.

## Decision

- **No view takes the focus by itself:** the shell's view gets `focusOnNavigation: false`, as the views of tabs and the overlay have. The window gives the shell the focus itself, as it did, for the address bar, find and the new tab page.
- **Out of the page:** the frame preload of a web page's top frame and the preload of the browser's own pages watch Tab and Shift+Tab without other modifiers (`app/src/preload/tab-out.ts`). When nothing in the page and its frames is left to focus, Blink takes the focus from the page's frame right before `TakeFocus`, and the page's window gets `blur` while the page has no focus; a page whose frame had no focus before the key has none after it either. Either sends `page.tabOut` with whether Shift was held, unless the page handled the key itself. Every other way of the key ends differently, and sends nothing: the next element of the page gets `focusin`, and a frame of the page that takes the focus leaves the page with the focus at the window's `blur`. Blink clears the focused element of the page also before it hands the focus to a frame, and a frame of another process takes the focus only a moment later, after a round trip through the browser; while the page has the focus and no focused element, the watch waits for that frame, which takes the focus or hands it back to the page or on to the browser, for at most a second. The window listens on the `ipc` of each view of a tab, and of a cover such as the reader view, and the commands of the windows, which load once the shell has loaded, move the focus to the first or the last control of the shell when the report comes from the top frame of the view that has the focus while none of its frames has it (`leavePage` in `app/src/platform/electron/window-commands.ts`). The shell gets the command `focus.first` or `focus.last` of `shell.command`.
- **Into the page:** an element at each end of the shell's Tab order, which no one sees, hands the focus on as it gets it from a control of the shell: it asks `tabs.focusContent`, which gives the shown page the focus, also the view of the new tab page, and sends the page `page.tabIn`. The page then starts over at its start, or at its end for Shift+Tab, with nothing focused: a mark that takes the focus there and goes away leaves Blink's starting point of the next key in its place, as `blur()` alone leaves it where the focus was. The next Tab goes to the page's first element and Shift+Tab to its last, as after a click on the page. Where the shell itself shows what the content area holds, the problem of a page, the keys go round in the shell; focus that comes to an end from none of the shell's controls goes to the control next to it.
- **F6:** the commands `focus.nextPane` and `focus.previousPane`, on F6 and Shift+F6 on Windows and Linux, go from the shell to the page and from the page to the address bar; the page keeps its focused element, its scroll position and what was typed in it. The problem of the active tab's page, which the shell draws in the page's place, is the pane of the page: the command `focus.pane` of `shell.command` lets the shell move the focus from the problem to the address bar and from the rest of the shell to the problem's first control. Ctrl+L and Alt+D stay on `omnibox.focus`. macOS gives them no shortcut, as before, and people can give them one. They run with the commands of the windows, which are there once the shell has loaded.
- **Tab strip:** the strip is a list of tabs as in the tabs pattern of ARIA: the arrows, Up and Down at a side, move the focus and go round at the ends, Home and End go to the first and the last item, Enter and Space show the focused tab and Delete closes it. The `tabindex` of 0 follows the focused tab while the focus is in the strip. On macOS, the key labelled delete, which types Backspace, closes the tab too, as it removes the chosen item of a list there; Mac laptops type Delete only with fn. Enter, Space and Delete go through `tabs.key`, which changes the tabs without moving the focus out of the strip while the shell has it; Delete closes the tab with the action `close` of the window's `tabAction`, the close that the window gives the tabs that people close. Focus rings inside the scrolling strip lie within their element, as the strip cuts off what lies outside it.

## Consequences

Positive:

- The toolbar and every page, the setup guide among them, can be used with the keyboard alone, in the order of other browsers, and a screen reader starts in the page that the first window shows.
- F6 brings the keys back to the page without loading it again.
- The new code of the browser process loads with the commands of the windows and the later handlers of the shell; the start-up path grows by the listener of each view, two commands and the names of two channels.

Negative:

- Entering a page with Tab stops at the page itself before its first element, as in Firefox; Chrome goes to the element at once, which Electron offers no way to do.
- Tab past the last element of a page, or Shift+Tab past its first, while the focus is in a frame of the page, of its own site or of another, sends the focus round the page, as before: the top frame never sees the key, and a frame cannot tell whether its parent hands the focus on to the browser. Tab into and out of frames from the page's own elements works as in Chrome.
- A frame of another process that takes longer than a second to take the focus, or to hand it on, sends the focus round the page when the key left it.
- The mark that starts a page over takes the focus for a moment, which the page's own listeners of focus events can see; so does the element that had the focus before in the page or in one of its frames, which the view gives the focus back to when it gets it, right before the start-over.
- F6 has two panes; the tab strip and the bookmarks bar as further panes come later.

## Alternatives considered

- **`webContents.focus()` alone when the focus enters a page:** the page goes on from the element that Electron's wrap had focused, so Tab from the toolbar could land at the end of the page and leave it again.
- **Finding the first and the last element of a page in the preload:** a page's own order with shadow roots, frames and positive `tabindex` cannot be found reliably from outside; Blink's own order after a start-over is exact.
- **A synthetic Tab into the page after the focus:** the page would see a key press that nobody made.
- **Every `focusout` to nothing during Tab as the key leaving the page:** Blink clears the page's focused element also right before it hands the focus to a frame, so Tab into a frame, such as the field of a card payment or a captcha, went to the toolbar.
- **Waiting a fixed time in the browser before moving the focus:** a frame of another process takes the focus after a round trip of varying length, and the focus would move late on every page; the events of the page tell when the focus has settled.
