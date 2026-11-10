# 0040. Tabs and popups that keep their opener

## Status

Accepted.

## Date

2026-11-09

## Context

The browser denied every `window.open` of a page and loaded the address in a new tab itself. The new page had no `opener`, so sign-in and payment popups that report back to the page that opened them did not work, a page could not close a window that it had opened, and popups that ask for a size opened as tabs. There was no command for a new window, and every window opened where the system put it, also after a restart.

## Decision

- **Opened pages keep their opener:** the window open handler allows what a page may open and lets Electron hand over the page that Chromium made with the opener (`createWindow`); the browser shows that page in a view of its own instead of loading the address again. A page may open http and https addresses, and `about:blank`, which the opener fills itself. The browser's own pages open nothing, and popups that the filter lists name stay blocked ([ADR 0033](0033-procedural-and-popup-filters-and-exceptions-per-domain.md)).
- **Where it opens:** a popup with a size or a position, from `window.open` with features, gets a window of its own at the size and place that the page asked for, as long as that lies on a screen; it closes with its page and is not kept in the session. A link that asks for a new window, such as a click with Shift, opens a new browser window. Everything else opens as a tab next to the page: a link with `target="_blank"` in front, and a middle click or a click with Ctrl (Command on macOS) in the background.
- **New windows:** `Ctrl+N` (`Command+N` on macOS) and New window in the browser menu open a window with a new tab.
- **Windows keep their place:** the session keeps where each window was and whether it was maximized (`bounds` and `maximized` in `session.json`). The next start opens the windows there, unless no screen shows enough of a window's top edge to move it; then the system places that window.
- **Browser menu:** the menu at the end of the toolbar has new tab and new window, the history, downloads and bookmarks, the zoom with full screen, find, print, save, more tools with the source and the developer tools, the settings, About and Quit; the menu bar of macOS gets a File menu. It stays a native menu until the menus move into the overlay in `0.1.0-beta.6`.

## Consequences

Positive:

- **Usual behavior:** sign-in, payment and share popups work as in other browsers, and pages can close what they opened.
- **Places:** after a restart, windows are where they were.

Negative:

- **Popups are full windows:** a popup has the toolbar and tabs of a browser window, not a slimmer window with only its address.
- **Frames of opened pages:** Electron creates the page that a script opens with the preferences that a child window gets, which leave out the content blocker's frame preload in its frames. The blocker blocks the requests of such a page and hides elements in its top document, but its element hiding rules and scriptlets do not reach the frames that the page embeds.
- **Older versions:** they ignore the new fields of `session.json` and open their windows where the system puts them.

## Alternatives considered

- **Keep loading the address in a new tab:** simple, but the page loses its opener, which breaks the flows above.
- **Windows that Electron creates itself:** a `BrowserWindow` per popup would have none of the browser's guards, toolbar or session.
