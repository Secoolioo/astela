# Windows and popups

> **Status:** available from 0.1.0-beta.4.

## New windows

`Ctrl+N` (`Command+N` on macOS), or New window in the browser menu at the end of the toolbar, opens a new window with a new tab; from 0.1.0-beta.7, it shows the [workspace](workspaces.md) of the window that you opened it from. The browser menu opens at its button, also with `F10` or `Alt` alone on Windows and Linux; see [keyboard shortcuts](keyboard-shortcuts.md#the-browser-menu). Astela keeps where each window was and whether it was maximized, and opens the windows there at the next start. From 0.1.0-beta.7, a window that you put in full screen comes back in full screen, and the window you used last opens last, so it comes to the front; a page that showed a video in full screen comes back in its window. A window that would lie outside every screen, for example after a screen was disconnected, opens where the system puts it, and a window larger than its screen fits the screen, so that its title bar is on it.

From 0.1.0-beta.7, `Ctrl+Shift+W` (`Command+Shift+W` on macOS), or Close window in the browser menu, closes the window with all its tabs. On macOS, Close Window in the File menu closes the front window, as in other apps, which can also be a window of the developer tools. When the last tab of a regular window closes, the window stays and shows a new tab page; a private window closes with its last tab, as in other browsers.

## Links and popups

- A link that a page opens in a new tab opens next to the page, in front.
- A middle click on a link, or a click with Ctrl (Command on macOS), opens it in a tab in the background.
- From 0.1.0-beta.7, a tab that a page of a [tab group](tab-groups.md) opens in this way joins the group.
- From 0.1.0-beta.7, what a page opens, a popup included, stays in the [workspace](workspaces.md) of that page, with its cookies and sign-ins, also while the window shows another workspace. A link from another app opens in the workspace that the window shows.
- A click with Shift opens the link in a new window.
- A popup that a page opens with a size, such as a sign-in or payment window, gets a window of its own. It stays connected to the page that opened it, so it can send its result back and close itself when it is done. Popups are not restored at the next start. A popup lies on a screen and is at most as large as it, whatever size and position the page asks for, also with the title bar of the system.
- From 0.1.0-beta.7, the page in a popup gets the size that it asked for, as in other browsers, and the popup shows only that page with its toolbar: it has no tabs, no New tab button and no bookmarks bar, also when the tabs are at a side, and its address shows where the page is but cannot be edited. A tab that the popup would open, from a link of its page, `Ctrl+T` (`Command+T` on macOS), **Duplicate the tab** in the command palette, the context menu or the browser menu, opens in your regular window instead, or in a private one for a private popup, and that window comes to the front. Such tabs are restored at the next start like any other.

The content blocker keeps popups that its filter lists name from opening; see [Content blocker](content-blocker.md).

## Blocked pop-ups

From 0.1.0-beta.7, a page opens a new tab, window or popup only right after you clicked, pressed a key or tapped in it: within five seconds, and one for each click or key. A page that opens windows by itself, such as when it loads or from a timer, or that opens a second window for the same click, gets nothing, as in other browsers. The same goes for the page that a click of yours led to in the same tab, and for the keys of shortcuts, such as `Ctrl` or `Alt` before `Ctrl+T` or `Alt+Tab`. This also holds while the content blocker is off.

A click of a screen reader or of voice control counts as yours, also in embedded frames. In the embedded frames of a page that a page opened, such as a sign-in popup that embeds another site, it does not; there, open the site's windows from the chip, or always allow the site.

When a page was blocked, the address bar shows **Pop-up blocked**, or how many were blocked. Click it to see the addresses the page tried to open:

- **Open** opens one of them in a tab next to the page. An address longer than 8192 characters is counted but not listed.
- **Always allow pop-ups from** the site lets it open windows without a click from now on, the next time it tries. Reload the page if it opens its windows as it loads.

The list belongs to the page and empties when the page goes to another one. You can change or remove the decision for a site on the settings page, under **Privacy**, **Site permissions**, as **Pop-ups**, and in [site information](site-permissions.md#in-site-information) of its pages; see [Site permissions](site-permissions.md). In a private window, Astela forgets it when the last private window closes.

## Private windows

`Ctrl+Shift+N` (`Command+Shift+N` on macOS), or New private window in the menu, opens a private window. It is dark and shows **Private** in the toolbar.

- Pages you open in a private window are not kept in the history, and private windows are not restored at the next start.
- Cookies and other site data of private windows stay in memory, apart from those of regular windows, and so do the icons of their pages. Astela deletes them when you close the last private window; the next private window starts empty. From 0.1.0-beta.7, a private window closes when you close its last tab, for example with `Ctrl+W` (`Command+W` on macOS), so closing the tabs of the last private window one by one ends the private session too.
- Sites ask again before they use the camera, notifications and the like, and Astela forgets the answers when the last private window closes. Changes to the zoom of a site are not kept.
- Files you download stay in your downloads folder. The list of downloads shows them only in private windows, and downloads that still run when you close the last private window are canceled. From 0.1.0-beta.7, Astela asks first, also when you close the last tab of that window: **Keep downloading** keeps the window open, with a new tab page if you closed its last tab, and **Cancel downloads** closes it. Quitting Astela cancels them without a question.
- Bookmarks you add and settings you change in a private window are kept.
- Links, popups and tabs that a page of a private window opens stay private.
- Private windows have no [workspaces](workspaces.md).

A private window does not make you anonymous: the sites you visit, your network and your organization can still see what you load. Your organization can turn private windows off; see the policy [`PrivateModeAvailability`](../admin/policies.md#privatemodeavailability) in the admin guide.
