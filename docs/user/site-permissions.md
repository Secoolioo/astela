# Site permissions

> **Status:** available from 0.1.0-beta.4.

Some sites want more than to show a page: the camera and the microphone for a call, your location for a map, notifications, or the text that you copied. Astela asks you first, in a small window above the page that names the site and what it wants.

- **Allow** gives the site what it asked for, and **Block** refuses it. Astela keeps your answer for the site, so the site does not ask again.
- If you close the question without an answer, for example with Escape or a click next to it, the site gets nothing this time and can ask again.
- Only the tab that you see can ask. A site in a tab in the background gets nothing.

Full screen, locking the mouse pointer, for example for a game, and copying to the clipboard need no question, as in other browsers.

## Sharing the screen

When a site wants to see your screen, for example to share it in a call, Astela shows your screens and windows with a small picture of each. The site sees only the screen or the window that you choose and **Share**; **Cancel** shares nothing. Astela asks every time. On macOS 15 and later, the picker of macOS asks instead.

## Change your answers

The settings page lists every site that you answered under **Privacy**, **Site permissions**, with what it may use. There you can change an answer from allowed to blocked or back, or remove it; the site then asks again the next time.

## Good to know

- Until you answer, a site that only checks whether it may show notifications sees that it may not, because the browser cannot report that the question is still open. Such sites usually offer a button that asks.
- On Linux, a site may still not learn your location after you allowed it, if the system has no location service that the browser can use.
