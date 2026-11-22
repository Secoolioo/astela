# Bookmarks

> **Status:** available from 0.1.0-beta.3; the popover of the star and the folders of the bookmarks bar as menus of the browser from 0.1.0-beta.7.

To bookmark a web page, click the star at the right end of the address bar or press Ctrl+D (Command+D on macOS). The star fills in, the page is added to the bookmarks bar folder, and a popover opens at the star, titled **Bookmark added**:

- **Name** has the title of the page, all of it selected, so that typing replaces it.
- **Folder** lists the bookmarks bar and the other bookmarks with the folders in them; choose the folder that the bookmark goes to.
- **Done**, Enter or a click next to the popover keep the name and the folder. Esc closes the popover without these changes; the bookmark stays.
- **Remove** removes every bookmark of the page, and the star is empty again.

On a page that has a bookmark, the star and the shortcut open the same popover, titled **Edit bookmark**, with the name and the folder of its first bookmark. Without the star in the [toolbar](settings.md#appearance), the shortcut opens the popover at the menu button. The browser's own pages, such as the settings, have no star, and the shortcut does nothing there.

To see and organize your bookmarks, open the menu at the right end of the toolbar and choose **Bookmarks**, or press Ctrl+Shift+O (Command+Shift+O on macOS). The bookmarks page shows two folders, **Bookmarks bar** and **Other bookmarks**, with the folders you create in them:

- Click a bookmark to open it, or Ctrl-click (Command-click on macOS) to open it in a new tab. Click a folder to show or hide what it contains.
- **New folder** adds a folder; type its name, which is selected already, and press Enter or choose **Save**.
- The ✎ button renames a bookmark or folder, changes the address of a bookmark, and moves either into another folder. Its name has the focus, all of it selected.
- The × button removes a bookmark. Removing a folder that is not empty asks first, because everything in it is removed as well.
- Type in the search field to find bookmarks by words of their title or address.

## Bookmarks bar

The bookmarks bar shows the bookmarks of the **Bookmarks bar** folder below the toolbar. To show or hide it, press Ctrl+Shift+B (Command+Shift+B on macOS), or go to [Settings](settings.md) → Appearance → Show bookmarks bar; the setup guide offers it too. It is hidden at first.

Click a bookmark on the bar to open it in the current tab, or Ctrl-click (Command-click on macOS) or middle-click it to open it in a new tab. A folder on the bar opens a menu below it with what it contains, its folders as submenus that open when the pointer rests on them or with the right arrow key, and **(empty)** for an empty folder. Bookmarks that do not fit in the bar are in the menu of its » button. In these menus, a bookmark opens in the current tab, or with Ctrl or Command, or the middle button, in a new tab; with the keyboard, Enter opens it and Ctrl+Enter (Command+Enter) opens it in a new tab. A letter moves to the next bookmark or folder that starts with it, and Esc closes the menu.

Bookmarks are stored on your computer only, in the profile database. See [Data storage](../architecture/data.md).
