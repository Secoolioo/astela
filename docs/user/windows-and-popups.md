# Windows and popups

> **Status:** available from 0.1.0-beta.4.

## New windows

`Ctrl+N` (`Command+N` on macOS), or New window in the browser menu at the end of the toolbar, opens a new window with a new tab; from 0.1.0-beta.7, it shows the [workspace](workspaces.md) of the window that you opened it from. The browser menu opens at its button, also with `F10` or `Alt` alone on Windows and Linux; see [keyboard shortcuts](keyboard-shortcuts.md#the-browser-menu). Astela keeps where each window was and whether it was maximized, and opens the windows there at the next start. From 0.1.0-beta.7, a window that you put in full screen comes back in full screen, and the window you used last opens last, so it comes to the front; a page that showed a video in full screen comes back in its window. A window that would lie outside every screen, for example after a screen was disconnected, opens where the system puts it, and a window larger than its screen fits the screen, so that its title bar is on it.

## Links and popups

- A link that a page opens in a new tab opens next to the page, in front.
- A middle click on a link, or a click with Ctrl (Command on macOS), opens it in a tab in the background.
- From 0.1.0-beta.7, a tab that a page of a [tab group](tab-groups.md) opens in this way joins the group.
- From 0.1.0-beta.7, what a page opens, a popup included, stays in the [workspace](workspaces.md) of that page, with its cookies and sign-ins, also while the window shows another workspace. A link from another app opens in the workspace that the window shows.
- A click with Shift opens the link in a new window.
- A popup that a page opens with a size, such as a sign-in or payment window, gets a window of its own. It stays connected to the page that opened it, so it can send its result back and close itself when it is done. Popups are not restored at the next start. A popup lies on a screen and is at most as large as it, whatever size and position the page asks for.

The content blocker keeps popups that its filter lists name from opening; see [Content blocker](content-blocker.md).

## Private windows

`Ctrl+Shift+N` (`Command+Shift+N` on macOS), or New private window in the menu, opens a private window. It is dark and shows **Private** in the toolbar.

- Pages you open in a private window are not kept in the history, and private windows are not restored at the next start.
- Cookies and other site data of private windows stay in memory, apart from those of regular windows, and so do the icons of their pages. Astela deletes them when you close the last private window; the next private window starts empty.
- Sites ask again before they use the camera, notifications and the like, and Astela forgets the answers when the last private window closes. Changes to the zoom of a site are not kept.
- Files you download stay in your downloads folder. The list of downloads shows them only in private windows, and downloads that still run when you close the last private window are canceled.
- Bookmarks you add and settings you change in a private window are kept.
- Links, popups and tabs that a page of a private window opens stay private.
- Private windows have no [workspaces](workspaces.md).

A private window does not make you anonymous: the sites you visit, your network and your organization can still see what you load. Your organization can turn private windows off; see the policy `PrivateModeAvailability` in the [enterprise guide](../architecture/enterprise.md).
