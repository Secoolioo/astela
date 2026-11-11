# Page tools

> **Status:** available from 0.1.0-beta.4.

These tools work on web pages. The [keyboard shortcuts](keyboard-shortcuts.md) list their keys for each system; on macOS, the File and View menus of the menu bar have them too.

## Find in the page

`Ctrl+F` (`Command+F` on macOS) opens the find bar below the toolbar. Astela marks every match on the page while you type and shows which match is selected and how many there are, or that there are none. Enter or the down arrow goes to the next match, Shift+Enter or the up arrow to the previous one, also with `F3` and `Shift+F3` (`Command+G` and `Command+Shift+G` on macOS). Escape or the close button closes the bar and leaves the last match selected. The bar opens again with the text you looked for last.

## Zoom

`Ctrl+Plus` and `Ctrl+-` (`Command` on macOS), and on Windows and Linux Ctrl and the mouse wheel, zoom in and out in steps from 25 % to 500 %, and `Ctrl+0` returns to the default zoom, which is 100 % unless you choose another in the [settings](settings.md#appearance). The zoom applies to the whole site, also in other tabs, and Astela keeps it for the next visit. While a site is not at the default zoom, the address bar shows its zoom; a click on it returns to the default zoom.

## Full screen

`F11` (`Control+Command+F` on macOS) shows the window in full screen. When a page shows a video or another element in full screen, it covers the whole window; Escape or the page's own button ends it.

## Reload without the cache

`Ctrl+Shift+R`, `Shift+F5` or `Ctrl+F5` (`Command+Shift+R` on macOS) loads the page again from the site instead of from the cache, for example after a site has changed.

## Print, save and view the source

`Ctrl+P` (`Command+P`) opens the print dialog of the system. `Ctrl+S` (`Command+S`) saves the page with its images and styles; Astela suggests the title of the page as the file name, in the downloads folder. `Ctrl+U` (`Command+Option+U`) shows the source of the page in a new tab.

## Developer tools

`F12` or `Ctrl+Shift+I` (`Command+Option+I`) opens the developer tools of the page in a window of their own, and closes them again. Inspect at the end of the context menu opens them at the element you clicked. Organizations can turn the developer tools off with the policy `DeveloperToolsAvailability`; see the [policies](../architecture/enterprise.md).

## PDF documents

PDF documents open in the tab, in Chromium's PDF viewer.
