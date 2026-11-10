# Settings

> **Status:** available from 0.1.0-beta.3.

Open the settings from the menu button at the right end of the toolbar, then **Settings**. On macOS, the application menu has **Settings…** as well, and Cmd+, opens them. The settings open in a new tab, or in place of the new tab page when the current tab shows it; if a tab of the same window shows them already, that tab comes to the front.

Every change applies at once, in every window, and is kept when the browser restarts; only the [language](#languages) waits for a restart.

## Find a setting

From 0.1.0-beta.5, the field at the top of the page finds settings by their names, their descriptions and words that people look for, such as _vertical_ for the tabs at the side. It understands English and German words in either language. A wide window shows the sections of the page at its left; a click takes you to a section, and the one in view is marked.

Every section and every setting has an address of its own, such as `app://settings/#privacy` or `app://settings/#tabs.position`. Opening it, also from a bookmark or another tab, shows that part of the page and puts the keyboard focus on it.

## Changed settings, reset, export and import

From 0.1.0-beta.5, **Show changed settings** lists only the settings that differ from their defaults. **Reset** next to such a setting sets it back; **Reset all settings…** sets every setting back after a question.

**Export settings…** saves the settings that you changed in a file, and **Import settings…** reads such a file, on this or another computer. The file holds the values only, never passwords or browsing data, but its lists of sites tell which sites you gave permissions or turned the content blocker off for. An import tells how many settings it took over; it skips settings that your organization manages and values that are not valid, and a file that holds no settings of Astela changes nothing.

## Settings that your organization manages

A setting that a policy of your organization sets shows a lock and _Managed by your organization_; it cannot be changed, reset or imported. A setting whose value your organization only recommends shows _Recommended by your organization_; you can change it, and Reset brings the recommended value back.

## Appearance

- **Color mode:** System follows the light or dark mode of your operating system; Light and Dark always use one of them. Web pages that offer a dark design follow this choice too.
- **Accent color:** blue, teal, green, orange, red, graphite, or any color you pick. A picked color keeps its hue; Astela only makes it darker in light mode or lighter in dark mode where that is needed to stay readable.
- **Density:** Compact, Normal or Comfortable changes the height of the tabs and the toolbar.
- **Tabs:** Top and Bottom show the tabs in a row above or below the page; Left and Right show them as a list at that side of the window.
- **Show bookmarks bar:** shows the [bookmarks bar](bookmarks.md#bookmarks-bar) below the toolbar.

## On startup

- **Open:** Last session reopens the windows and tabs you had open when the browser closed; New tab page starts with a single new tab. Restored tabs load when you first open them, so a start with many tabs stays fast.

## Languages

- **Language of the browser:** from 0.1.0-beta.5, the language of the menus, the dialogs and the pages of Astela, such as the settings and the new tab page. Same as the system follows the language of your operating system; English and Deutsch set one. Websites keep their own language.

The language changes when the browser starts again. Until then, the settings page says that some changes take effect after a restart and offers **Restart now**, which quits Astela and starts it again with the windows and tabs that were open, also when it otherwise starts with a new tab page.

## Search

- **Search engine:** DuckDuckGo, Google, Bing, Startpage, Ecosia, Brave Search or Qwant. The address bar and the [new tab page](new-tab-page.md) search with it.
- **Custom:** any search address that starts with `https://` and contains `%s` where the search terms go, for example `https://search.example/?q=%s`.

## Privacy

- **Block ads and trackers:** turns the [content blocker](content-blocker.md) on or off. It is on by default.
- **Hide cookie notices** and **Hide annoyances:** add the lists of EasyList and uBlock Origin against cookie notices, or against newsletter boxes, chat and social widgets, notifications and other annoyances. Both are off by default.
- **Sites without blocking:** the sites on which the content blocker is off, each with the button **Remove**. Type a site's name or address in the field below the list and choose **Add** to add one.
- **Site permissions:** what each site may use after you answered its question, such as the camera or notifications. Change an answer between **Allowed** and **Blocked**, or choose **Remove**, and the site asks again. See [Site permissions](site-permissions.md).

## Default browser

- **Make default:** makes Astela the browser that opens links from other apps. See [Default browser](default-browser.md).

## Import from another browser

- **Import:** bookmarks and history from Chrome, Edge, Brave, Vivaldi, Opera, Firefox and other browsers on this computer, and open tabs from Firefox and the browsers based on it. See [Import from other browsers](import.md).

## Setup

- **Setup guide:** opens the [setup guide](setup-guide.md) again in a new tab.

Settings that your organization manages are shown as such and cannot be changed.
