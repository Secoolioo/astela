# Site permissions

> **Status:** available from 0.1.0-beta.4; changing the answers of a site in site information from 0.1.0-beta.7.

Some sites want more than to show a page: the camera and the microphone for a call, your location for a map, notifications, or the text that you copied. Astela asks you first, in a small window above the page that names the site and what it wants.

- **Allow** gives the site what it asked for, and **Block** refuses it. Astela keeps your answer for the site, so the site does not ask again. The buttons take clicks a moment after the question shows, as in other browsers, so the second click of a double click meant for something before does not answer it.
- If you close the question without an answer, for example with Escape or a click next to it, the site gets nothing this time and can ask again.
- While a question shows, the shortcuts of the [command palette](command-palette.md) do nothing; any other shortcut of the browser closes the question without an answer.
- Only the tab that you see can ask. A site in a tab in the background gets nothing. In a [split view](tabs.md#split-view), only the side with the focus can ask, and the question shows over that side; a site in the other side gets nothing until you click into it and it asks again.

Full screen, locking the mouse pointer, for example for a game, and copying to the clipboard need no question, as in other browsers.

## Sharing the screen

When a site wants to see your screen, for example to share it in a call, Astela shows your screens and windows with a small picture of each. The site sees only the screen or the window that you choose and **Share**; **Cancel** shares nothing. Astela asks every time. On macOS 15 and later, the picker of macOS asks instead, and under Wayland on Linux, the picker of the system asks first, once for screens and windows together.

## Change your answers

The settings page lists every site that you answered under **Privacy**, **Site permissions**, with what it may use. There you can change an answer from allowed to blocked or back, or remove it; the site then asks again the next time.

## In site information

From 0.1.0-beta.7, a click on the connection in the [address bar](address-bar.md#site-information) shows the permissions that you answered for the site, each with a switch: on allows it, off blocks it. A site that asked for nothing yet shows none. **Reset permissions** forgets every answer of the site, which then asks again. A change counts at once for what the site asks next; what it uses already, such as a camera that runs, changes once the page loads again, and **Reload** does that.

In a private window, site information shows and changes the answers of the private windows, which never reach the settings and which they forget when the last private window closes.

## Good to know

- Until you answer, a site that only checks whether it may show notifications sees that it may not, because the browser cannot report that the question is still open. Such sites usually offer a button that asks.
- On Linux, a site may still not learn your location after you allowed it, if the system has no location service that the browser can use.
- From 0.1.0-beta.7, your answers count in every [workspace](workspaces.md), also in one that keeps its cookies and sign-ins apart.
