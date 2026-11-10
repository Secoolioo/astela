# Context menus

A right-click opens a context menu with the commands that fit what you clicked. It is the menu of your operating system, so it looks and works like the other menus there. On macOS, a Control-click opens it as well. On Windows and Linux, the context menu key and `Shift+F10` open it next to the focused element, and each command has an access key, such as T for Open link in new tab. The menus follow the language of the system, English or German.

## In a web page

| What you click | Commands                                              |
| -------------- | ----------------------------------------------------- |
| A link         | Open link in new tab, Copy link address               |
| An image       | Open image in new tab, Copy image, Copy image address |
| Selected text  | Copy, Search for the selection                        |
| A text field   | Undo, Redo, Cut, Copy, Paste, Select all              |
| Anything else  | Back, Forward, Reload                                 |

Menus in a web page end with Inspect, which opens the [developer tools](page-tools.md#developer-tools) at the element you clicked. Inspect is missing on the browser's own pages, and where an organization turns the developer tools off with the policy `DeveloperToolsAvailability`.

An image inside a link gets the commands of both. A command that cannot run at the moment is grayed out, such as Undo in a field you have not changed.

- **New tabs:** links and images open in a new tab next to the page, in the background. Several of them line up in the order you opened them. A search opens in a new tab in the foreground. Only web addresses (`http` and `https`) open from a page. Links and images with other addresses, such as internal pages of the browser, local files or scripts, do not open from the menu, but their address can be copied.
- **Search:** the search uses the search engine of the address bar. The menu names the engine by its address, such as `duckduckgo.com`, and shows the first 50 characters of the selection. Password fields and very long selections have no search.
- **Text fields:** on Windows and Linux, the menu also shows the keyboard shortcut of each command; context menus on macOS show none. Spell checking is not available yet; once it is, suggestions for a misspelled word appear at the top of the menu.
- **Copy image:** copies the picture itself. An image in a frame of another website cannot be copied this way; copy its address instead.

## In the address bar

The address bar has the menu of a text field: Undo, Redo, Cut, Copy, Paste and Select all.
