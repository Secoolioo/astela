# Tabs

> **Status:** available from 0.1.0-beta.6; shortcuts of your own for more items of the menu of a tab, tab search, sleeping tabs, split view, tab groups and workspaces from 0.1.0-beta.7.

## What a tab shows

- **The icon of its page,** or an icon for the browser's own pages, such as the settings and the history. Astela loads the icon of a page like an image of the page, so the content blocker blocks the icons that its lists block, but without cookies, and never from an insecure `http://` address for a secure `https://` page. It shows icons of up to 100 KB in the formats PNG, ICO, GIF, JPEG, WebP, BMP and SVG; a page without one shows a globe. An icon that could not be loaded is tried again a minute later at the earliest.
- **A turning ring** while the page loads. When the system asks for reduced motion, the ring stands still.
- **A speaker** while the page plays sound. Click it to mute the tab, and click it again to turn the sound on. A muted tab stays muted when it opens another page, until you turn its sound on or close it.
- **A faded icon** while the tab sleeps: its page is not loaded, and it loads again when you open the tab. Screen readers say _Sleeping, loads again when you open it_.

## Moving tabs

Drag a tab along the tab strip to move it; the other tabs make room for it, and it lands where you let go. Dragging a tab does not switch to it. The two tabs of a [split view](#split-view) move together: dragging either of them drags both, and the other tabs make room for both. Tabs open, close and move with a short animation, which the system's setting for reduced motion turns off. The surface of the active tab slides with it to its new place. On macOS, a Control-click on a tab opens its menu and does not drag the tab. Dropped between two tabs of a group, a tab joins the group, and dragged more than half its width past the end of its group, it leaves it; see [tab groups](tab-groups.md#moving-tabs-into-and-out-of-groups).

## Tab groups

From 0.1.0-beta.7, tabs can stand together in named, colored groups, whose tabs you can hide behind the chip of the group. **Add to new group** in the menu of a tab starts one. See [Tab groups](tab-groups.md).

## Workspaces

From 0.1.0-beta.7, each window can keep sets of tabs in workspaces and show one of them at a time; the others stay open in the background. The button at the start of the tab strip switches between them, and **Move to workspace** in the menu of a tab, or a drag onto that button, moves a tab into another workspace. See [Workspaces](workspaces.md).

## Many tabs

Tabs get narrower as you open more of them. Narrow tabs show only the icon of their page, and the active tab shows its close button instead; a middle click closes any tab. When the tabs no longer fit, the tab strip scrolls, also with the mouse wheel, and a line marks each side behind which tabs are hidden.

## Finding a tab

Tab search finds a tab in any window: press `Ctrl+Shift+A` (`Command+Shift+A` on macOS), or choose **Search tabs…** in the browser menu. With an empty field, it lists the tabs of this window in their order, the active one marked **Current tab**, and then the tabs of the other windows, the window you used last first. The tabs of this window come from every one of its [workspaces](workspaces.md), each with its group and, while you have more than one workspace, its workspace. Type words of a tab's title or address to narrow the list, and press Enter or click a tab to switch to it; a tab of another workspace shows that workspace, and a tab of another window brings its window to the front. Private windows find only the tabs of private windows, and regular windows only those of regular windows. Tab search is the [command palette](command-palette.md) for the open tabs: `%` and a space in front of the words in the palette do the same, and the palette finds open tabs among its other results too.

## Pinned tabs

Pin a tab from its menu to keep it at the start of the tab strip, where it shows only the icon of its page. Pinned tabs stay pinned at the next start, keep their place before the other tabs when you move tabs, and have no close button: close them from their menu or with the shortcut. In a tab strip at a side, pinned tabs keep their titles. Links that a pinned tab opens in the background line up after the pinned tabs, in the order you opened them.

## Tabs at the next start

From 0.1.0-beta.7, each tab comes back with its back and forward history when Astela starts again with the last session, also after a crash or an update: **Back** and **Forward** go where they went before, also to the new tab page and the browser's own pages, such as the history. The active tab of each window loads at once, at its scroll position and with what you typed into its fields; the other tabs sleep and load when you open them. Astela keeps up to 24 pages back and 24 forward for each tab. See [On startup](settings.md#on-startup) for when the last session comes back.

## Sleeping tabs

From 0.1.0-beta.7, a tab that you have not used for a while goes to sleep: its page closes and gives its memory back, and the tab keeps its title, its icon and its back and forward history. When you open the tab again, its page loads at its scroll position and with what you typed into its fields, and **Back** and **Forward** go where they went before. Opening a tab means clicking it, switching to it with the keyboard, choosing it in tab search or among the suggestions of the address bar; **Reload** in its menu loads it in the background. Waking a tab adds no visit to the history.

- **By itself:** a tab that you left an hour ago goes to sleep, while **Put inactive tabs to sleep** is on in the settings, under [Performance](settings.md#performance), where you can also choose another time. The time counts from when you last used the tab, or from when it last played sound or was busy otherwise.
- **From its menu:** **Put tab to sleep** puts a tab to sleep at once, also a pinned one.

A tab stays awake while it shows, plays sound or a video, uses the camera, the microphone or the screen, downloads a file, has the developer tools open or is linked to a page that it opened or that opened it, such as a sign-in window. Then **Put tab to sleep** cannot be chosen. A paused download, or one that stopped and waits for **Resume**, does not keep its tab awake. Pinned tabs do not go to sleep by themselves, and neither does a page that you typed into since it loaded, such as an editor with changes that are not saved yet; it may sleep once it loads another page. Astela never asks the page or you. A page that keeps something that it does not save, such as the state of a game or of a call, or a drawing made with the mouse alone, loses it when it sleeps; pin such a tab to keep it awake. A page that shows something in full screen while you look at another tab leaves full screen when it sleeps.

## Split view

From 0.1.0-beta.7, a window can show two of its tabs side by side.

- **Open a split view:** in the menu of a tab, **Open in split view** shows that tab beside the active tab, which stays where it is; the tab moves next to it, on the right, and gets the focus. When the active tab is already in a split view, the tab takes the side of the other tab there, on the left or on the right, and that tab stays open as a tab of its own next to the split view. In the menu of the active tab, **New tab in split view** opens a new tab page on the right, where you type an address. `Ctrl+Shift+S` (`Control+Command+S` on macOS) does the same, and on macOS so does **View › Split View**. Pinned tabs are never in a split view.
- **The side you work in:** the line above a side and the tab with the surface of the active tab mark the side with the focus. The address bar, the buttons of the toolbar, the star, the shield, zoom, find, print, the developer tools and every shortcut act on that side. Click into the other side, or press `Ctrl+Tab` or `Ctrl+Shift+Tab`, to work there. A page in the other side cannot take the focus by itself, also not when it loads another page. Clicking a tab outside the split view shows that tab alone; the split view comes back with either of its tabs.
- **The width of the sides:** drag the divider between them. With the keyboard, move to the divider with Tab and press the arrow keys to move it by 5 %, Home or End for its ends; a double click makes the sides equal. The left side takes 20 to 80 % of the width, and each side keeps at least 200 pixels while the window has room.
- **In the tab strip,** the two tabs stand together, the left side first, or the upper one in a tab strip at a side. Screen readers say _Left side of the split view_ or _Right side of the split view_ after the title. New tabs, copies of tabs and links that open in the background open after the two tabs, never between them. **Close other tabs** and **Close tabs to the right** leave the other side open.
- **Swap or end it:** the menu of either tab offers **Swap sides** and **End split view**. Closing either tab ends the split view, and the other tab fills the window. Pinning either tab, or `Ctrl+Shift+S` (`Control+Command+S`) in it, ends it too: the side with the focus fills the window, and the other tab stays in the tab strip.
- **At the next start,** a split view comes back with the width of its sides, and both of its pages load when it shows.

A page that could not be loaded shows why in its own side; see [When a page does not load](page-problems.md). A page in full screen covers the whole window while its side has the focus. Questions of sites show only for the side with the focus; see [Site permissions](site-permissions.md). Turn split view off with **Split view** under [Appearance](settings.md#appearance) in the settings.

## The menu of a tab

A click with the secondary button on a tab opens its menu: a new tab next to it, [split view](#split-view), [groups](tab-groups.md#making-a-group), [moving it to another workspace](workspaces.md#moving-tabs-between-workspaces), reload, duplicate, pin or unpin, mute or unmute, [put to sleep](#sleeping-tabs), close, close the other tabs and close the tabs to the right, which leave pinned tabs open, and reopen the last closed tab. In a tab strip at a side, the menu opens the new tab below the tab and closes the tabs below it. The menu of the active tab shows the shortcuts of duplicating, pinning, muting and closing it, and of closing the other tabs and those to the right, also the shortcuts that you give them in the settings. On Windows and Linux, each item has an access key of its own.

## Keyboard

`Ctrl+1` to `Ctrl+8` (`Command+1` to `Command+8` on macOS) switch to the tab at that place, and `Ctrl+9` (`Command+9`) to the last tab; they count only the tabs that the tab strip shows, not those of a [hidden group](tab-groups.md#showing-and-hiding-the-tabs-of-a-group). They use the keys of the digits, also on layouts that type the digits with Shift, such as French, Belgian, Czech and Slovak ones; see [other layouts](keyboard-shortcuts.md#other-layouts-and-input-methods). On Windows and Linux, `Ctrl+Shift+Page Up` and `Ctrl+Shift+Page Down` move the active tab, together with the other side of its split view, past the tab or the split view next to it; at the edge of a group, the tab first leaves the group or joins it, and a hidden group is passed as a whole. The settings can give these commands shortcuts of your own; see [Keyboard shortcuts](keyboard-shortcuts.md). They can also give shortcuts to duplicating, pinning and muting a tab, and to closing the other tabs and the tabs to the right (below, in a tab strip at a side), which have none at first; see [commands without a shortcut](keyboard-shortcuts.md#commands-without-a-shortcut).
