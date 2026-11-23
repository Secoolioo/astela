# Page tools

> **Status:** available from 0.1.0-beta.4; the reader view and picture in picture from 0.1.0-beta.7.

These tools work on web pages. The [keyboard shortcuts](keyboard-shortcuts.md) list their keys for each system; the browser menu at the end of the toolbar has them too, Find, Print and Save page as with the others and Save as PDF, View source and Developer tools under More tools, and on macOS the File and View menus of the menu bar. On the browser's own pages, such as the settings, these items cannot be chosen.

## Find in the page

`Ctrl+F` (`Command+F` on macOS) opens the find bar below the toolbar. Astela marks every match on the page while you type and shows which match is selected and how many there are, or that there are none. Enter or the down arrow goes to the next match, Shift+Enter or the up arrow to the previous one, also with `F3` and `Shift+F3` (`Command+G` and `Command+Shift+G` on macOS). Escape or the close button closes the bar and leaves the last match selected. The bar also closes when you switch to another tab or close its tab. It opens again with the text you looked for last. In a [split view](tabs.md#split-view), the bar searches the side with the focus and ends where that side ends, or starts at the left edge of the window when the left side is narrower than the bar; it closes when you click into the other side.

## Zoom

`Ctrl+Plus` and `Ctrl+-` (`Command` on macOS), and on Windows and Linux Ctrl and the mouse wheel, zoom in and out in steps from 25 % to 500 %, and `Ctrl+0` returns to the default zoom, which is 100 % unless you choose another in the [settings](settings.md#appearance). The zoom applies to the whole site, also in other tabs, and Astela keeps it for the next visit. While a site is not at the default zoom, the address bar shows its zoom; a click on it returns to the default zoom. The zoom row of the browser menu has the same steps: − zooms out, + zooms in, and the zoom between them, such as 110 %, returns to the default zoom; the menu stays open while you zoom, and its buttons stop at 25 % and 500 %. Its last button shows the window in full screen.

## Full screen

`F11` (`Control+Command+F` on macOS) shows the window in full screen. When a page shows a video or another element in full screen, it covers the whole window; Escape or the page's own button ends it. From 0.1.0-beta.7, a notice at the top names the site and says to press Escape for a few seconds, as in Chrome, so a page cannot pretend to be the browser or your system without you knowing how to leave; a page that takes the mouse pointer, as games do, says the same about the pointer. A very long site name is shortened at its start, so that its end, which names the owner of the site, and the way out always show, and a page that belongs to no site, such as one that another page wrote, gets the notice without one. The notice takes neither the focus nor the keys: Escape always reaches the page, also after a click on the notice. A question that a site asks at that moment stays, and the notice follows once you answered it. In a [split view](tabs.md#split-view), it covers the whole window while its side has the focus, and the other side comes back when it ends.

## Reload without the cache

`Ctrl+Shift+R`, `Shift+F5` or `Ctrl+F5` (`Command+Shift+R` on macOS) loads the page again from the site instead of from the cache, for example after a site has changed.

## Print, save and view the source

`Ctrl+P` (`Command+P`) opens the print dialog of the system. `Ctrl+S` (`Command+S`) saves the page with its images and styles; Astela suggests the title of the page as the file name, in the downloads folder. `Ctrl+U` (`Command+Option+U`) shows the source of the page in a new tab.

From 0.1.0-beta.7, **Save as PDF…** under More tools in the browser menu (also in the File menu on macOS, and in the [command palette](command-palette.md)) saves the page as a PDF document, as it would print. Astela suggests the title of the page as the file name, in the downloads folder. The paper follows the region of your system, as the formats of dates and times do: US Letter in the United States, Canada, Mexico and the other regions that use it, A4 elsewhere, unless the page asks for a size of its own. Chrome takes the region from its language, but Astela speaks only English and German, so it would not know a British or a Canadian system; where the system names no region, the language of Astela decides. The reader view saves the article. There is no print preview with options yet: the PDF has no headers and footers, and leaves out the background colors and images of the page, as printing does by default.

## Developer tools

`F12` or `Ctrl+Shift+I` (`Command+Option+I`) opens the developer tools of the page in a window of their own, and closes them again. Inspect at the end of the context menu opens them at the element you clicked. Organizations can turn the developer tools off with the policy `DeveloperToolsAvailability`, which also takes them out of the browser menu; their keys then reach the page, and the keyboard shortcuts in the settings show none for them. See the [policy reference](../admin/policies.md#developertoolsavailability).

## Reader view

On a page with an article, such as a news story or a blog post, a button with an open book shows next to the address bar. It shows the article alone, in the colors and the font of the browser: its title, who wrote it, when it was published and how long it takes to read, then its text with its pictures, lists, quotes, code and tables, without menus, ads, comments, sidebars and cookie notices. `F9` (`Option+Command+R` on macOS) and **Reader view** in the browser menu, after Find, do the same; on macOS, the View menu has it too. The button, the key and the item end the reader view again, and so does Back, also with the back button of a mouse. The page is then where it was, as it did not load again, and gets the keys again, such as Space to scroll.

- **Look:** the reader view takes the colors of the theme and the accent color, light or dark with the color mode, and only dark ones in a private window. Its font is the font of the browser, or the serif font of web pages if you choose it under [Page tools](settings.md#page-tools) in the settings. Its text has the size of web pages.
- **Zoom:** the zoom keys change the size of its text in the steps of page zoom. The address bar shows that zoom, and a click on it, or `Ctrl+0` (`Command+0`), returns to the default zoom. The site keeps its own zoom.
- **Tools:** Find and Print work on the article. Save page as, View source and the developer tools of the keys and menus work on the page; Inspect in the context menu shows the reader view's own document.
- **Links:** a link of the article opens in its tab, which ends the reader view; a middle click or the context menu opens it in a new tab. Reload ends the reader view and opens it again once the page has loaded, without taking the focus from what you type meanwhile, such as an address.

Astela looks for the article in the page itself, in a part of the page that its scripts cannot see, and nothing leaves your computer. It shows what the page has loaded, also without a network; the pictures load from the site, with the rules of the content blocker for that site. A very long article shows its first part, with a note at its end. Pages that load their text only while you scroll may show less of it. The browser's own pages, pages that could not load and PDF documents have no reader view. A tab that went to sleep while its reader view showed shows it again when it wakes, once its page has loaded. Turn off **Offer the reader view** in the settings to remove the button, the items and the key; organizations can turn it off with the policy `ReaderViewEnabled`.

## Picture in picture

While a video of the page plays, a button with a small window in a large one shows next to the address bar. It shows the video in a small window of its own above other windows, where it goes on playing while you use other tabs and programs; the button is pressed while it does, and ends picture in picture again. **Picture in picture** in the browser menu does the same, with a check mark while a video of the page shows in it, and on macOS the View menu has it too; it has no key of its own, which you can give it under [Keyboard shortcuts](settings.md#keyboard-shortcuts) in the settings. The command palette finds it as well.

- **Which video:** a video that shows in picture in picture comes first, to end it; otherwise the video that plays with sound and is the largest on the screen, then the largest one that plays, then the largest one with a picture. Videos in frames of the page count, also those of other sites. To choose another video, right-click it: its context menu has **Picture in picture**, and **Exit picture in picture** while it shows in it.
- **The window:** it is Chromium's, with buttons to play and pause, to go back to the tab and to close it. Closing it pauses the video. Only one video shows in picture in picture at a time, also across windows: a new one takes the place of the one before. Picture in picture ends when the tab loads another page or closes.
- **Sleeping tabs:** a tab whose video shows in picture in picture does not go to sleep, also when its page showed the video there itself and also while **Offer picture in picture** is off; Astela asks the page before a tab sleeps. Once the video no longer shows there, the time until the tab sleeps begins anew. A video that plays keeps its tab awake anyway.
- **Pages with their own button:** pages that offer picture in picture themselves, such as video sites, keep it. The button of Astela shows what the page did once it looks at its videos again, such as when a video plays or pauses, when you switch to its tab or come back to the window; until then, a click shows the state first.
- **Pages that still load:** Astela looks at the videos of a page once it has loaded, also when a video began to play before; until then, the button does not show. For a video of the page itself, **Picture in picture** in its context menu waits up to a few seconds for the page, and does nothing if it loads for longer; try again once it has loaded. A video in a frame of another site shows at once.

Astela finds the videos in the page itself, and only the frame of the chosen video gets the click that picture in picture needs. Pages cannot open other windows above the others with Document Picture-in-Picture yet: Astela turns the interface off, so sites keep their player in the page. On Linux with Wayland, the window of picture in picture opens where the system puts it and may fall behind other windows, as Wayland lets no program keep a window above the others. Turn off **Offer picture in picture** in the settings to remove the button and the items; organizations can turn it off with the policy `PictureInPictureEnabled`.

## PDF documents

PDF documents open in the tab, in Chromium's PDF viewer.
