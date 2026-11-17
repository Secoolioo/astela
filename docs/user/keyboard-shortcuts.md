# Keyboard shortcuts

> **Status:** available from 0.1.0-beta.2; the shortcuts of the page tools and for new and private windows from 0.1.0-beta.4; your own shortcuts from 0.1.0-beta.5; the shortcuts that choose and move tabs from 0.1.0-beta.6; your own shortcuts for the commands of the menus, F10 and Alt for the browser menu, the shortcuts of the command palette, tab search, split view, workspaces and the reader view, and the moves of tabs into and out of groups, from 0.1.0-beta.7.

Astela uses the shortcuts that are usual on each operating system. They work the same way in the address bar and in web pages. The tables below list the defaults.

## Changing shortcuts

Under **Keyboard shortcuts** in the [settings](settings.md), every command shows its shortcuts. **Change** waits for the keys of a new one; press them together, or Esc to stop without a change. The new shortcut replaces those of the command. **Reset** brings back the defaults of a command, and **Reset all** those of every command. The menus show the shortcuts you chose.

A shortcut needs Ctrl or Alt, on macOS Control or Command, or it is a function key, because other keys type text in pages. Keys that edit text in pages are not possible either, such as copying and pasting, undoing, selecting all, and moving by words or to the start of a line, for example `Ctrl+V` or `Command+←`. On Windows and Linux, Ctrl and Alt together are not possible, because Windows types characters with them. Shortcuts that the system uses, such as `Alt+F4` or `Command+Q`, cannot be chosen. When another command has the keys already, the settings page asks before it moves them; the other command keeps its other shortcuts, and **Reset** on the command that took the keys gives them back.

## Commands without a shortcut

Some commands have no shortcut until you give one to them: **Duplicate the tab**, **Close the other tabs**, **Close the tabs to the right** (**Close the tabs below** while the tab strip is at a side), **Pin or unpin the tab**, **Mute or unmute the tab**, **Swap the sides of the split view**, **Add the tab to a new group**, **Next workspace**, **Previous workspace**, **Show the workspaces**, **About Astela** and **Quit Astela**. The commands of a tab act on the active tab, as the items of the [menu of a tab](tabs.md#the-menu-of-a-tab) act on their tab, and closing the other tabs or those to the right leaves pinned tabs open there too. Once a command has a shortcut, the menu of the active tab or the browser menu shows it next to the item. On macOS, `Command+Q` quits Astela in any case: the settings show it in the row of **Quit Astela**, where it stays next to a shortcut of your own.

## Windows and Linux

| Action                         | Shortcut                                        |
| ------------------------------ | ----------------------------------------------- |
| New tab                        | `Ctrl+T`                                        |
| New window                     | `Ctrl+N`                                        |
| New private window             | `Ctrl+Shift+N`                                  |
| Close the tab                  | `Ctrl+W` or `Ctrl+F4`                           |
| Reopen the last closed tab     | `Ctrl+Shift+T`                                  |
| Next tab                       | `Ctrl+Tab` or `Ctrl+Page Down`                  |
| Previous tab                   | `Ctrl+Shift+Tab` or `Ctrl+Page Up`              |
| First to eighth tab            | `Ctrl+1` to `Ctrl+8`                            |
| Last tab                       | `Ctrl+9`                                        |
| Move the tab to the left       | `Ctrl+Shift+Page Up`                            |
| Move the tab to the right      | `Ctrl+Shift+Page Down`                          |
| Open or end split view         | `Ctrl+Shift+S`                                  |
| First to ninth workspace       | `Alt+1` to `Alt+9`                              |
| Back                           | `Alt+Left Arrow` or the keyboard's Back key     |
| Forward                        | `Alt+Right Arrow` or the keyboard's Forward key |
| Reload                         | `F5` or `Ctrl+R`                                |
| Open the home page             | `Alt+Home`                                      |
| Go to the address bar          | `Ctrl+L`, `Alt+D` or `F6`                       |
| Open the command palette       | `Ctrl+K`                                        |
| Search the open tabs           | `Ctrl+Shift+A`                                  |
| Open the menu                  | `F10`, or `Alt` pressed and released alone      |
| Open the history               | `Ctrl+H`                                        |
| Open the downloads             | `Ctrl+J`                                        |
| Bookmark the page              | `Ctrl+D`                                        |
| Open the bookmarks             | `Ctrl+Shift+O`                                  |
| Show or hide the bookmarks bar | `Ctrl+Shift+B`                                  |
| Reload without the cache       | `Ctrl+Shift+R`, `Shift+F5` or `Ctrl+F5`         |
| Find in the page               | `Ctrl+F`                                        |
| Next match                     | `F3` or `Ctrl+G`                                |
| Previous match                 | `Shift+F3` or `Ctrl+Shift+G`                    |
| Zoom in                        | `Ctrl+Plus` or `Ctrl+=`                         |
| Zoom out                       | `Ctrl+-`                                        |
| Reset zoom                     | `Ctrl+0`                                        |
| Full screen                    | `F11`                                           |
| Reader view                    | `F9`                                            |
| Print                          | `Ctrl+P`                                        |
| Save the page                  | `Ctrl+S`                                        |
| View the source                | `Ctrl+U`                                        |
| Developer tools                | `F12` or `Ctrl+Shift+I`                         |

None of these shortcuts combines Ctrl and Alt. Windows reports the AltGr key as Ctrl+Alt, so AltGr keeps typing characters such as `@`, `€` or `{`.

`Ctrl+D` adds the page to the bookmarks bar and opens the popover of the star, where the bookmark gets its name and folder; on a page with a bookmark, it opens the popover of that bookmark ([bookmarks](bookmarks.md)).

## macOS

| Action                         | Shortcut                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| New tab                        | `Command+T`                                                           |
| New window                     | `Command+N`                                                           |
| New private window             | `Command+Shift+N`                                                     |
| Close the tab                  | `Command+W`                                                           |
| Reopen the last closed tab     | `Command+Shift+T`                                                     |
| Next tab                       | `Control+Tab`, `Command+Option+Right Arrow` or `Command+Shift+]`      |
| Previous tab                   | `Control+Shift+Tab`, `Command+Option+Left Arrow` or `Command+Shift+[` |
| First to eighth tab            | `Command+1` to `Command+8`                                            |
| Last tab                       | `Command+9`                                                           |
| Open or end split view         | `Control+Command+S`                                                   |
| First to ninth workspace       | `Control+1` to `Control+9`                                            |
| Back                           | `Command+[`                                                           |
| Forward                        | `Command+]`                                                           |
| Reload                         | `Command+R`                                                           |
| Open the home page             | `Command+Shift+H`                                                     |
| Go to the address bar          | `Command+L`                                                           |
| Open the command palette       | `Command+K`                                                           |
| Search the open tabs           | `Command+Shift+A`                                                     |
| Open the settings              | `Command+,`                                                           |
| Open the history               | `Command+Y`                                                           |
| Open the downloads             | `Command+Option+L`                                                    |
| Bookmark the page              | `Command+D`                                                           |
| Open the bookmarks             | `Command+Shift+O`                                                     |
| Show or hide the bookmarks bar | `Command+Shift+B`                                                     |
| Reload without the cache       | `Command+Shift+R`                                                     |
| Find in the page               | `Command+F`                                                           |
| Next match                     | `Command+G`                                                           |
| Previous match                 | `Command+Shift+G`                                                     |
| Zoom in                        | `Command+Plus` or `Command+=`                                         |
| Zoom out                       | `Command+-`                                                           |
| Reset zoom                     | `Command+0`                                                           |
| Full screen                    | `Control+Command+F`                                                   |
| Reader view                    | `Option+Command+R`                                                    |
| Print                          | `Command+P`                                                           |
| Save the page                  | `Command+S`                                                           |
| View the source                | `Command+Option+U`                                                    |
| Developer tools                | `Command+Option+I`                                                    |

`Command+Left Arrow` and `Command+Right Arrow` move the cursor to the start and the end of the line, as everywhere on macOS, so they do not go back and forward. `Command+Tab` switches between apps. **Open the menu** has no shortcut on macOS, whose menu bar opens the menus of Astela; you can give it one.

On keyboard layouts that need Option, or Option and Shift, to type `[` and `]`, such as German or French, press Command together with the keys that type the bracket.

**Reader view** shows the article of a page in the [reader view](page-tools.md#reader-view), on pages that have one, and ends it again; the key works in the page and in the reader view. While the reader view is off in the settings, the key reaches the page.

**Open or end split view** opens a new tab page beside the active tab in a [split view](tabs.md#split-view), or ends the split view of the active tab. `Command+Shift+S` stays free, as it means Save As on macOS. While split view is off in the settings, the shortcut reaches the page.

## Workspaces

`Alt+1` to `Alt+9` (`Control+1` to `Control+9` on macOS) show the first to the ninth [workspace](workspaces.md) of the list; a place without a workspace does nothing. They use the keys of the digits, also on layouts that type other characters there, such as French. The digits of the number pad stay free, as Windows types characters with Alt and them, and Option with a digit types characters on macOS; without Num Lock, the arrows of the number pad go back and forward with Alt, as the other arrows do. While workspaces are off in the settings, these keys reach the page, and so they do in private windows and popups, which have no workspaces.

## Tabs in groups

The shortcuts that switch to the next or the previous tab, or to a tab by its place, skip the tabs that a [group](tab-groups.md) hides. Moving the active tab with the keyboard takes it out of its group at the edge of the group first, and into a group next to it; a hidden group is passed as a whole. On the chip of a group, Enter or Space hide or show its tabs, and the context menu key opens its popover.

## The browser menu

On Windows and Linux, `F10` opens the browser menu at its button, with its first item chosen, and `F10` once more closes it. Pressing and releasing `Alt` alone does the same, as in other programs of these systems; `Alt` together with another key, such as `Alt+Left Arrow`, or `Alt` held while you click, scroll or drag with the mouse, does not. If a site needs the Alt key for itself, turn off **Open the menu with Alt** under **Keyboard shortcuts** in the [settings](settings.md). While a page fills the screen, such as a video in full screen, `Alt` does not open the menu.

In the menu, and in the menus of the folders of the [bookmarks bar](bookmarks.md#bookmarks-bar), the arrow keys move between the items, Home and End go to the first and the last one, and `Right Arrow`, Enter or Space open a submenu, which `Left Arrow` or Esc close again. Enter or Space choose an item, and Esc or Tab close the menu. On Windows and Linux, each item of the browser menu has an access key, the underlined letter, which chooses it; the letter shows when the keyboard opened the menu, or while you hold `Alt`. On macOS, and in folders, a letter moves to the next item that starts with it. When the keyboard opened the menu from the toolbar, closing it gives the focus back to the menu button.

## The command palette

`Ctrl+K` (`Command+K` on macOS) opens the [command palette](command-palette.md), which finds commands, open tabs, bookmarks, visited pages and settings; `Ctrl+Shift+A` (`Command+Shift+A`) opens it for the open tabs only. In the palette, its own shortcut closes it and the other one switches between everything and the tabs, and every other shortcut closes it and runs. The keys you type right after the shortcut go to the palette's field, also while it opens for the first time.

## Mouse

The back and forward buttons of a mouse go back and forward in the current tab, over the page as well as over the toolbar. On Windows and Linux, Ctrl and the mouse wheel zoom the page in and out.

## Other layouts and input methods

Letter shortcuts also work with keyboard layouts for other scripts, such as Cyrillic, Greek, Arabic or Devanagari. They use the key that carries the letter on an English keyboard. The shortcuts with `[` and `]` on macOS do the same on layouts that type letters of another script on these keys, such as Russian or Arabic. Shortcuts with a digit use the key of the digit on layouts that type a letter there, such as `Ctrl+0` on French or Czech layouts. With Ctrl or Command, the keys of the digits count as their digits on layouts that type other characters there and the digits with Shift, such as French, Belgian, Czech and Slovak layouts: `Ctrl+1` is the key that carries the 1, with or without Shift. So `Ctrl+1` switches to the first tab on Czech and Slovak layouts, where the key types `+`; `Ctrl+=` zooms in there. French layouts for Windows and Linux type the minus sign on the 6 key only, apart from the number pad, so `Ctrl+-` on that key keeps zooming out, and `Ctrl+Shift+6` switches to the sixth tab. On macOS, shortcuts with Option, such as `Command+Option+I`, use the key of the letter, whatever character Option types with it.

While an input method composes text, for example in Japanese or Chinese, its keys belong to the input method and do not run shortcuts.

## Shortcuts in web pages

The browser handles these shortcuts before the page sees the key, so a web page cannot use them for its own functions. All other keys go to the page.

This holds for `Ctrl+K` and `Command+K` too, which some web editors and apps use to add a link or to search, such as Google Docs, Gmail or Slack. To give these keys back to pages, change the shortcuts of the palette, or turn off **Command palette and tab search** under **Keyboard shortcuts** in the [settings](settings.md): then `Ctrl+K` and `Ctrl+Shift+A` (`Command+K` and `Command+Shift+A`) reach web pages again.
