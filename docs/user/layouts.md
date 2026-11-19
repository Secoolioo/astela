# Layouts

> **Status:** available from 0.1.0-beta.7.

The layout of a window is where its tabs and its address bar are, how much room they take, and whether they stay in view. Four layouts set these at once; afterwards, you can change each part on its own.

## Choosing a layout

Open the [settings](settings.md#appearance) at **Layout**, or the layout step of the [setup guide](setup-guide.md). Each layout is a card with a small picture of a window. A click on a card, or the arrow keys among the cards, apply a layout at once in every window.

- **Classic:** the tabs above the address bar, at the normal density.
- **Compact:** the tabs and the address bar in one row, with less space, at the compact density.
- **Zen:** only the page, until you need the rest: the tabs and the address bar in one row, which hides.
- **Vertical:** the tabs as a list at the left, with the address bar in a row of its own.

A layout sets four settings: **Tabs**, **Address bar**, **Hide the tabs and the toolbar until you need them** and **Density**. The card of the layout whose four values the settings have is checked. Once you change one of them, no card is checked, and the page says _Your own arrangement_. No layout changes the title bar, which takes effect only after a restart.

When your organization sets one of the four settings, the cards of the layouts that would change it cannot be chosen and say _Managed by your organization_.

## The address bar next to the tabs

**Address bar** in the settings puts the address bar **In its own row**, below the tabs, or **Next to the tabs**, in one row with them. In one row, the address bar comes first, the tabs follow, and the menu button follows **New tab**. The row is as high as the toolbar. The address bar takes about two fifths of the row, but never less than the buttons next to it need; the tabs share the rest. In a window too narrow for both, the tabs move into a row of their own above the address bar, as high as the one row, so that no tab and no button hides under the others or under the buttons of the window. With the browser's title bar, the row is the title bar of the window: drag its free space to move the window. The buttons to minimize, maximize and close the window sit in the row and take its height.

The address bar goes next to the tabs only while the tabs are at the top. With the tabs at the bottom or at a side, the setting says _Needs the tabs at the top_ and cannot be changed.

## Tabs and toolbar that hide

**Hide the tabs and the toolbar until you need them** gives the page the room of the tabs, the address bar and the bookmarks bar. A thin edge stays at the top of the window, 2 to 4 pixels high; on Windows and Linux with the browser's title bar, a title row stays instead, as the buttons to minimize, maximize and close the window cannot hide there. In full screen, an edge stays on every system. The title row shows whether the connection is secure, the site and the title of the page. Every web page names its site there, also an empty page or a page that a site made itself, such as `about:blank`: the title is what the page says about itself, the site is what the browser knows. On macOS, the three buttons of the window hide with the rows.

The tabs and the toolbar show over the page, which neither moves nor changes its size:

- when the pointer reaches the edge at the top, or rests on the title row for a moment; they stay while the pointer is over them, and hide a moment after it left them;
- while the address bar has the keyboard focus, after `Ctrl+L`, `Alt+D` or `F6` (`Command+L` on macOS), or another of their controls after `Tab`; a button that you click keeps them only while the pointer stays;
- while the find bar is open, after `Ctrl+F` (`Command+F`);
- while a menu or popover of the toolbar or the tabs is open, such as the browser menu after `F10` or `Alt` alone on Windows and Linux, the bookmark star, the content blocker, the downloads, the workspaces, the popover of a group or the menu of a tab;
- for a moment of one and a half seconds when you switch to another tab or a page shows another site, so that you see where the page comes from.

In the address bar, `Escape` brings back the address of the page, and a second `Escape` gives the page the keys again; the rows then hide. They also hide when you click into the page. When the rows hide after you clicked them, such as on the title row to bring the window to the front, the keys go to the page.

While the rows hide, the edge and the title row do not move the window. Move the pointer to the top, and drag the free space of the row of the tabs. Popups always show their address and never hide their rows, and nothing shows over a page that fills the screen, such as a video in full screen. With the tabs at the bottom or at a side, the setting says _Needs the tabs at the top_ and cannot be changed.

The [command palette](command-palette.md) has **Turn hiding the toolbar on or off**, which has no shortcut at first; you can give it one in the [settings](keyboard-shortcuts.md#commands-without-a-shortcut).

## For organizations

The policies `ToolbarPlacement` (`own-row` or `tab-row`) and `AutoHideToolbar` (`true` or `false`) set the place of the address bar and the hiding, or recommend them; see [Enterprise](../architecture/enterprise.md). The policy `TabStripPosition` sets the place of the tabs.
