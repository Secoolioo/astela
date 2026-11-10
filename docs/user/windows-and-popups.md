# Windows and popups

> **Status:** available from 0.1.0-beta.4.

## New windows

`Ctrl+N` (`Command+N` on macOS), or New window in the menu at the end of the toolbar, opens a new window with a new tab. Astela keeps where each window was and whether it was maximized, and opens the windows there at the next start. A window that would lie outside every screen, for example after a screen was disconnected, opens where the system puts it.

## Links and popups

- A link that a page opens in a new tab opens next to the page, in front.
- A middle click on a link, or a click with Ctrl (Command on macOS), opens it in a tab in the background.
- A click with Shift opens the link in a new window.
- A popup that a page opens with a size, such as a sign-in or payment window, gets a window of its own. It stays connected to the page that opened it, so it can send its result back and close itself when it is done. Popups are not restored at the next start.

The content blocker keeps popups that its filter lists name from opening; see [Content blocker](content-blocker.md).
