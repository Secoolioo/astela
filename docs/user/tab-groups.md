# Tab groups

> **Status:** available from 0.1.0-beta.7.

A group keeps tabs that belong together side by side in the tab strip, under a name and a color of your choice. You can hide the tabs of a group behind its chip when you do not need them, and show them again with a click.

## Making a group

- In the [menu of a tab](tabs.md#the-menu-of-a-tab), **Add to new group** puts the tab in a new group, in its place. The popover of the group opens at once, where you type its name.
- When the window has groups already, the menu offers **Add to group** instead: **New group** makes a new one, and each group of the window takes the tab at its end. A group without a name is listed as _Group with “…”_, after the title of its first tab; a long title is cut after 300 characters.
- **Remove from group** takes a tab out of its group, right after the group.

Pinned tabs are never in a group: pinning a tab takes it out of its group. The two tabs of a [split view](tabs.md#split-view) are always in the same group. When the last tab of a group closes or leaves it, the group is gone.

## What a group shows

A chip comes before the first tab of each group: a dot in the group's color and its name. Each tab of the group has a line in that color along its edge toward the page: below the tab with the tab strip at the top, above it with the tab strip at the bottom. In a tab strip at a side, the chip is a row of its own with an arrow, and the tabs of the group are indented below it, with the line at their start. A new group takes the color that the groups of the window use least.

Screen readers say _In group …_ after the title of each tab of a group, or _In a group without a name_.

## Showing and hiding the tabs of a group

Click the chip, or press Enter or Space while it has the focus, to hide the tabs of the group; the chip then shows how many tabs it hides. Click it again to show them. When the active tab is in the group, the tab after the group becomes active, or the one before it; without any tab left to show, a new tab opens after the group. With Enter or Space, the chip keeps the focus, also when another tab becomes active, so the next key shows the tabs again; after a click, the page of that tab gets the focus, as after a click on a tab.

The tabs of a hidden group stay open. Switching to one of them, from [tab search](tabs.md#finding-a-tab) or from the suggestions of the [address bar](address-bar.md), shows the group again. `Ctrl+Tab`, `Ctrl+Page Up` and `Ctrl+Page Down`, and `Ctrl+1` to `Ctrl+9` (`Command+1` to `Command+9` on macOS) skip the tabs that a group hides. So do their commands in the [command palette](command-palette.md), which lists **Next tab**, **Second tab** and the others only while there is such a tab to go to.

## Naming, coloring, ungrouping and closing a group

A click with the secondary button on the chip opens the popover of the group; so does the context menu key, or a Control-click on macOS. With the tab strip at the bottom, it opens above the chip. When the keyboard opened the popover, from the chip or with **Add to new group** in a menu of a tab that the context menu key opened, the focus goes back to the tab strip when the popover closes.

- **Name:** type it; the chip shows it while you type. A name has up to 50 characters, and a group may have none.
- **Color:** blue, teal, green, orange, red or graphite, the colors of the accent besides Astela's own.
- **New tab in group** opens a new tab at the end of the group.
- **Ungroup** ends the group; its tabs stay where they are.
- **Close group** closes all tabs of the group. **Reopen closed tab**, or `Ctrl+Shift+T` (`Command+Shift+T`), opens them again as the group they were, with its name and color.

Changes count at once. Escape, or a click next to the popover, closes it.

## New tabs and groups

- A link, a middle click on a link or a page that opens a tab by itself, in a tab of a group, opens the new tab in the same group. So do **New tab to the right** and **Duplicate** in the menu of a tab.
- The New tab button and `Ctrl+T` (`Command+T`) open a new tab after the group of the active tab, outside it.
- A closed tab that you open again goes back into its group while the group is there.

## Moving tabs into and out of groups

- **Dragging:** drop a tab between two tabs of a group, or on the chip of a group, and it joins the group. Drag a tab of a group more than half its width past the first or the last tab of its group, and it leaves the group. While you drag, the chip of the group that the tab would join is marked. A group whose tabs are hidden moves as a whole, and no tab joins it by a drag.
- **Keyboard:** on Windows and Linux, `Ctrl+Shift+Page Up` and `Ctrl+Shift+Page Down` move the active tab. At the edge of its group, the first press takes the tab out of the group where it is, also at the start or the end of the tab strip, and the next one moves it. A tab next to a group joins the group at that edge first. A group whose tabs are hidden is passed as a whole. **Move the tab to the left** and **Move the tab to the right** in the command palette do the same, on every system.

## At the next start

Groups come back with their tabs when Astela starts again with the last session, also hidden ones; only the active tab loads. See [tabs at the next start](tabs.md#tabs-at-the-next-start). Private windows keep no groups after they close.
