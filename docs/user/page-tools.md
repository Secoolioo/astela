# Page tools

> **Status:** available from 0.1.0-beta.4; the reader view from 0.1.0-beta.7.

These tools work on web pages. The [keyboard shortcuts](keyboard-shortcuts.md) list their keys for each system; the browser menu at the end of the toolbar has them too, Find, Print and Save page as with the others and View source and Developer tools under More tools, and on macOS the File and View menus of the menu bar. On the browser's own pages, such as the settings, these items cannot be chosen.

## Find in the page

`Ctrl+F` (`Command+F` on macOS) opens the find bar below the toolbar. Astela marks every match on the page while you type and shows which match is selected and how many there are, or that there are none. Enter or the down arrow goes to the next match, Shift+Enter or the up arrow to the previous one, also with `F3` and `Shift+F3` (`Command+G` and `Command+Shift+G` on macOS). Escape or the close button closes the bar and leaves the last match selected. The bar also closes when you switch to another tab or close its tab. It opens again with the text you looked for last. In a [split view](tabs.md#split-view), the bar searches the side with the focus and ends where that side ends, or starts at the left edge of the window when the left side is narrower than the bar; it closes when you click into the other side.

## Zoom

`Ctrl+Plus` and `Ctrl+-` (`Command` on macOS), and on Windows and Linux Ctrl and the mouse wheel, zoom in and out in steps from 25 % to 500 %, and `Ctrl+0` returns to the default zoom, which is 100 % unless you choose another in the [settings](settings.md#appearance). The zoom applies to the whole site, also in other tabs, and Astela keeps it for the next visit. While a site is not at the default zoom, the address bar shows its zoom; a click on it returns to the default zoom. The zoom row of the browser menu has the same steps: − zooms out, + zooms in, and the zoom between them, such as 110 %, returns to the default zoom; the menu stays open while you zoom, and its buttons stop at 25 % and 500 %. Its last button shows the window in full screen.

## Full screen

`F11` (`Control+Command+F` on macOS) shows the window in full screen. When a page shows a video or another element in full screen, it covers the whole window; Escape or the page's own button ends it. In a [split view](tabs.md#split-view), it covers the whole window while its side has the focus, and the other side comes back when it ends.

## Reload without the cache

`Ctrl+Shift+R`, `Shift+F5` or `Ctrl+F5` (`Command+Shift+R` on macOS) loads the page again from the site instead of from the cache, for example after a site has changed.

## Print, save and view the source

`Ctrl+P` (`Command+P`) opens the print dialog of the system. `Ctrl+S` (`Command+S`) saves the page with its images and styles; Astela suggests the title of the page as the file name, in the downloads folder. `Ctrl+U` (`Command+Option+U`) shows the source of the page in a new tab.

## Developer tools

`F12` or `Ctrl+Shift+I` (`Command+Option+I`) opens the developer tools of the page in a window of their own, and closes them again. Inspect at the end of the context menu opens them at the element you clicked. Organizations can turn the developer tools off with the policy `DeveloperToolsAvailability`, which also takes them out of the browser menu; see the [policies](../architecture/enterprise.md).

## Reader view

On a page with an article, such as a news story or a blog post, a button with an open book shows next to the address bar. It shows the article alone, in the colors and the font of the browser: its title, who wrote it, when it was published and how long it takes to read, then its text with its pictures, lists, quotes, code and tables, without menus, ads, comments, sidebars and cookie notices. `F9` (`Option+Command+R` on macOS) and **Reader view** in the browser menu, after Find, do the same; on macOS, the View menu has it too. The button, the key and the item end the reader view again, and so does Back, also with the back button of a mouse. The page is then where it was, as it did not load again, and gets the keys again, such as Space to scroll.

- **Look:** the reader view takes the colors of the theme and the accent color, light or dark with the color mode, and only dark ones in a private window. Its font is the font of the browser, or the serif font of web pages if you choose it under [Page tools](settings.md#page-tools) in the settings. Its text has the size of web pages.
- **Zoom:** the zoom keys change the size of its text in the steps of page zoom. The address bar shows that zoom, and a click on it, or `Ctrl+0` (`Command+0`), returns to the default zoom. The site keeps its own zoom.
- **Tools:** Find and Print work on the article. Save page as, View source and the developer tools of the keys and menus work on the page; Inspect in the context menu shows the reader view's own document.
- **Links:** a link of the article opens in its tab, which ends the reader view; a middle click or the context menu opens it in a new tab. Reload ends the reader view and opens it again once the page has loaded, without taking the focus from what you type meanwhile, such as an address.

Astela looks for the article in the page itself, in a part of the page that its scripts cannot see, and nothing leaves your computer. It shows what the page has loaded, also without a network; the pictures load from the site, with the rules of the content blocker for that site. A very long article shows its first part, with a note at its end. Pages that load their text only while you scroll may show less of it. The browser's own pages, pages that could not load and PDF documents have no reader view, and a tab that went to sleep shows its page when it wakes. Turn off **Offer the reader view** in the settings to remove the button, the items and the key; organizations can turn it off with the policy `ReaderViewEnabled`.

## PDF documents

PDF documents open in the tab, in Chromium's PDF viewer.
