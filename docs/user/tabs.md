# Tabs

> **Status:** available from 0.1.0-beta.6; shortcuts of your own for more items of the menu of a tab, and tab search, from 0.1.0-beta.7.

## What a tab shows

- **The icon of its page,** or an icon for the browser's own pages, such as the settings and the history. Astela loads the icon of a page like an image of the page, so the content blocker blocks the icons that its lists block, but without cookies, and never from an insecure `http://` address for a secure `https://` page. It shows icons of up to 100 KB in the formats PNG, ICO, GIF, JPEG, WebP, BMP and SVG; a page without one shows a globe. An icon that could not be loaded is tried again a minute later at the earliest.
- **A turning ring** while the page loads. When the system asks for reduced motion, the ring stands still.
- **A speaker** while the page plays sound. Click it to mute the tab, and click it again to turn the sound on. A muted tab stays muted when it opens another page, until you turn its sound on or close it.

## Moving tabs

Drag a tab along the tab strip to move it; the other tabs make room for it, and it lands where you let go. Dragging a tab does not switch to it. Tabs open, close and move with a short animation, which the system's setting for reduced motion turns off. The surface of the active tab slides with it to its new place. On macOS, a Control-click on a tab opens its menu and does not drag the tab.

## Many tabs

Tabs get narrower as you open more of them. Narrow tabs show only the icon of their page, and the active tab shows its close button instead; a middle click closes any tab. When the tabs no longer fit, the tab strip scrolls, also with the mouse wheel, and a line marks each side behind which tabs are hidden.

## Finding a tab

Tab search finds a tab in any window: press `Ctrl+Shift+A` (`Command+Shift+A` on macOS), or choose **Search tabs…** in the browser menu. With an empty field, it lists the tabs of this window in their order, the active one marked **Current tab**, and then the tabs of the other windows, the window you used last first. Type words of a tab's title or address to narrow the list, and press Enter or click a tab to switch to it; a tab of another window brings its window to the front. Private windows find only the tabs of private windows, and regular windows only those of regular windows. Tab search is the [command palette](command-palette.md) for the open tabs: `%` and a space in front of the words in the palette do the same, and the palette finds open tabs among its other results too.

## Pinned tabs

Pin a tab from its menu to keep it at the start of the tab strip, where it shows only the icon of its page. Pinned tabs stay pinned at the next start, keep their place before the other tabs when you move tabs, and have no close button: close them from their menu or with the shortcut. In a tab strip at a side, pinned tabs keep their titles. Links that a pinned tab opens in the background line up after the pinned tabs, in the order you opened them.

## Tabs at the next start

From 0.1.0-beta.7, each tab comes back with its back and forward history when Astela starts again with the last session, also after a crash or an update: **Back** and **Forward** go where they went before, also to the new tab page and the browser's own pages, such as the history. The active tab of each window loads at once, at its scroll position and with what you typed into its fields; the other tabs load when you open them. Astela keeps up to 24 pages back and 24 forward for each tab. See [On startup](settings.md#on-startup) for when the last session comes back.

## The menu of a tab

A click with the secondary button on a tab opens its menu: a new tab next to it, reload, duplicate, pin or unpin, mute or unmute, close, close the other tabs and close the tabs to the right, which leave pinned tabs open, and reopen the last closed tab. In a tab strip at a side, the menu opens the new tab below the tab and closes the tabs below it. The menu of the active tab shows the shortcuts of duplicating, pinning, muting and closing it, and of closing the other tabs and those to the right, also the shortcuts that you give them in the settings. On Windows and Linux, each item has an access key of its own.

## Keyboard

`Ctrl+1` to `Ctrl+8` (`Command+1` to `Command+8` on macOS) switch to the tab at that place, and `Ctrl+9` (`Command+9`) to the last tab. They use the keys of the digits, also on layouts that type the digits with Shift, such as French, Belgian, Czech and Slovak ones; see [other layouts](keyboard-shortcuts.md#other-layouts-and-input-methods). On Windows and Linux, `Ctrl+Shift+Page Up` and `Ctrl+Shift+Page Down` move the active tab. The settings can give these commands shortcuts of your own; see [Keyboard shortcuts](keyboard-shortcuts.md). They can also give shortcuts to duplicating, pinning and muting a tab, and to closing the other tabs and the tabs to the right (below, in a tab strip at a side), which have none at first; see [commands without a shortcut](keyboard-shortcuts.md#commands-without-a-shortcut).
