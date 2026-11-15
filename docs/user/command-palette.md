# Command palette

> **Status:** available from 0.1.0-beta.7.

The command palette finds what you want to do or open in one field: the commands of the browser, the open tabs of every window, your bookmarks, the pages you visited, the address bar's search, and the settings. It matches words only; nothing that you type leaves your computer, unless you choose a search.

## Opening the palette

- Press `Ctrl+K` (`Command+K` on macOS), also while a web page or the address bar has the focus.
- Or choose **Command palette…** in the browser menu, or **View › Command Palette…** in the menu bar of macOS.

**Search the open tabs** opens the palette for the tabs only: press `Ctrl+Shift+A` (`Command+Shift+A`), or choose **Search tabs…** in the browser menu or **View › Search Tabs…** on macOS. See [finding a tab](tabs.md#finding-a-tab).

The palette opens at the top of the page, in the middle. What you type right after the shortcut goes to its field, also while it opens for the first time in a window, and never to the page; an Enter typed then opens the first result, and an Escape opens nothing. A click on **New tab** before the palette shows opens nothing either: what you type after the click goes to the new tab.

While a site asks you something, such as for the camera, or asks you to sign in, the shortcuts of the palette do nothing, so that the question stays until you answer it.

## What it shows

While the field is empty, the palette lists the commands you ran from it since the browser started, under **Recently used**, and then every command that can run now. A command that cannot run, such as **Back** on a page without history or **View the source** on the browser's own pages, does not show.

As you type, the palette shows, in this order:

- **Commands**, with their shortcut, at most 6;
- **Open tabs** of every window, apart from the active tab, at most 5;
- **Settings**, with the section they are in, at most 3;
- **Bookmarks**, at most 3;
- **History**, the pages you visited, at most 5;
- **Web**: a search for what you typed, or the address you typed.

Every word you type must be in the name, the title or the address. Upper and lower case and accents do not count, and English and German words both work, whatever the language of the browser, so `vergrößern` finds **Zoom in**. Some commands have more words that find them, such as `incognito` for **New private window** or `console` for **Developer tools**. The best matches come first: a name that starts with what you typed, then one in which each word starts a word. An address shows once: an open tab before a bookmark, and a bookmark before a visited page.

## Narrowing the search

Type one of these signs and then a space at the start of the field to search only one kind:

| Sign | Searches    |
| ---- | ----------- |
| `>`  | Commands    |
| `%`  | Open tabs   |
| `*`  | Bookmarks   |
| `^`  | The history |
| `#`  | Settings    |

The sign becomes a chip in front of the field. Backspace in the empty field, or a click on the chip, searches everything again. With a sign, the palette lists more: up to 200 tabs, 50 bookmarks, 50 visited pages and every matching command or setting; with an empty field, the first 50 bookmarks or the 50 pages you visited last. On German keyboards, `^` is a dead key: press `^`, then the space twice.

## Keys and the mouse

- The arrow keys move the marked row and go round at the ends; Page Down and Page Up move by eight rows.
- Enter acts on the marked row. If the results for what you just typed are still on their way, Enter waits a moment for them.
- Esc closes the palette, and the focus goes back to the page, or to the address bar on the new tab page.
- Tab stays in the field.
- A click on a row acts on it; a click next to the palette closes it, and so does switching to another window.
- In the palette, its own shortcut closes it: `Ctrl+K` in the palette, `Ctrl+Shift+A` in tab search (`Command` on macOS). The other one switches between everything and the open tabs and keeps what you typed. Every other shortcut of the browser closes the palette and runs, such as `Ctrl+T` for a new tab.
- While an input method composes text in the field, its keys belong to it.

## What a row does

- A **command** runs on the active tab of the window.
- A **tab** shows; a tab of another window brings that window to the front, also when it was minimized.
- A **bookmark**, a **visited page**, a **search** or an **address** opens in a new tab after the active one, or in the active tab when it shows the new tab page.
- A **setting** opens the settings at its row, whose control gets the focus, also when the settings are open already.

## Private windows

In a private window, the palette finds only the tabs of private windows, and in a regular window only those of regular windows.

## Turning the palette off

Some web editors and apps use `Ctrl+K` or `Command+K` themselves, for example to add a link. To leave these keys to web pages, turn off **Command palette and tab search** under **Keyboard shortcuts** in the [settings](settings.md#keyboard-shortcuts). Then `Ctrl+K` and `Ctrl+Shift+A` (`Command+K` and `Command+Shift+A`) reach web pages, unless you gave these keys to another command, shortcuts that you gave the palette do nothing, and the menus have no items for the palette. You can also give the palette other shortcuts there, see [keyboard shortcuts](keyboard-shortcuts.md#changing-shortcuts). Your organization can turn the palette off or on with the policy `CommandPaletteEnabled`.
