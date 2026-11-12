# Settings

> **Status:** available from 0.1.0-beta.3.

Open the settings from the menu button at the right end of the toolbar, then **Settings**. On macOS, the application menu has **Settings…** as well, and Cmd+, opens them. The settings open in a new tab, or in place of the new tab page when the current tab shows it; if a tab of the same window shows them already, that tab comes to the front.

Every change is kept when the browser restarts, and most apply at once, in every window. Three settings take full effect only after a restart: [Title bar](#appearance), [Block third-party cookies](#privacy) and [Language of the browser](#languages). After you change one of them, it says _Takes effect after a restart_, and the page offers **Restart now**.

## Find a setting

From 0.1.0-beta.5, the field at the top of the page finds settings by their names, their descriptions and words that people look for, such as _vertical_ for the tabs at the side. It understands English and German words in either language. A wide window shows the sections of the page at its left; a click takes you to a section, and the one in view is marked.

Every section and every setting has an address of its own, such as `app://settings/#privacy` or `app://settings/#tabs.position`. Opening it, also from a bookmark or another tab, shows that part of the page and puts the keyboard focus on it. From 0.1.0-beta.7, the links of the browser to a setting, such as **Content blocker settings** in the popover of the [content blocker](content-blocker.md), show it and give it the focus also when the settings show its address already.

## Changed settings, reset, export and import

From 0.1.0-beta.5, **Show changed settings** lists only the settings that differ from their defaults. **Reset** next to such a setting sets it back; **Reset all settings…** sets every setting back after a question.

**Export settings…** saves the settings that you changed in a file, and **Import settings…** reads such a file, on this or another computer. The file holds the values only, never passwords or browsing data, but its values tell about you: the sites that you gave permissions or turned the content blocker off for, the pages that open at start, the home page, the shortcuts of the new tab page, your search engines, and the address of a secure DNS service. The folder of downloads stays out, as it belongs to this computer. An import tells how many settings it took over; it skips settings that your organization manages, values that are not valid, a background image of the new tab page, whose file only the browser that exported it keeps, and keyboard shortcuts from a computer with another system, as macOS and Windows or Linux name the keys differently. A file that holds no settings of Astela changes nothing.

## Settings that your organization manages

A setting that a policy of your organization sets shows a lock and _Managed by your organization_; it cannot be changed, reset or imported. A setting whose value your organization only recommends shows _Recommended by your organization_; you can change it, and Reset brings the recommended value back.

## Appearance

- **Color mode:** System follows the light or dark mode of your operating system; Light and Dark always use one of them. Web pages that offer a dark design follow this choice too.
- **Theme:** from 0.1.0-beta.5, the colors of the browser's windows and pages: Astela, Paper, Forest, Ocean and Slate, each with a light and a dark mode, and True Dark, whose dark mode is black for OLED screens. **Custom** lets you choose the background, panels, fields and bars, the color under the pointer, text, secondary text and lines for each mode; every change shows at once in every window. The page warns when a text has less than 4.5:1 contrast on a surface. **Start from** copies the colors of a built-in theme, and **Export…** and **Import…** save the colors in a file and read them from one.
- **Accent color:** Astela, the violet of the logo, which shows progress in the blue of the logo, and the default; blue, teal, green, orange, red, graphite, or any color you pick. A picked color keeps its hue; Astela only makes it darker in light mode or lighter in dark mode where that is needed to stay readable.
- **Density:** Compact, Normal or Comfortable changes the height of the tabs, the toolbar, the buttons and fields, and the space between them, in the browser's own pages as well.
- **Text size:** from 0.1.0-beta.5, Small, Medium, Large or Larger changes the size of the text in the toolbar, the tabs, the popovers and the browser's own pages. The menus keep the size of the system. Web pages keep their size; zoom them with `Ctrl` and `+` (`Command` and `+` on macOS).
- **Page zoom:** from 0.1.0-beta.5, the zoom of sites that you have not zoomed yourself, from 25 to 500 %. A site that you zoomed keeps its zoom; choosing its zoom in the address bar sets it back to this one.
- **Text size of web pages** and **Fonts of web pages:** from 0.1.0-beta.5, the size of text and the standard, serif, sans serif and fixed width fonts of web pages that set none themselves, as in other browsers. Tabs that open after a change use them; tabs that are open keep what they had. An empty font field keeps the default.
- **Font of the browser:** from 0.1.0-beta.5, the name of a font installed on your computer, such as Inter, for the text of the browser itself. An empty field, the default, uses the font of the system.
- **Toolbar:** from 0.1.0-beta.5, which of the bookmark star, the content blocker and downloads show next to the address bar, and in which order; the arrows move a button to the left or the right. Downloads shows after the first download. Without the downloads button, `Ctrl+J` (`Command+Option+L` on macOS) opens the list of downloads at the menu button. Hiding the content blocker's button keeps the blocker on; **Sites without blocking** below turns it off for a site.
- **Tabs:** Top and Bottom show the tabs in a row above or below the page; Left and Right show them as a list at that side of the window.
- **Title bar:** from 0.1.0-beta.6, With the tabs makes the top row of the window, the tabs or the toolbar, its title bar: drag its free space to move the window. Some space after its last button stays free for that, also when the tabs fill the row. The buttons to minimize, maximize and close the window sit in its corner; on Windows and Linux, they take the color of the row, and on Linux they sit where your desktop puts them, at the left end, the right end or both. In full screen, the row leaves no room for them. Web pages cannot make parts of the window move it. Of the system brings back the title bar of your operating system above it. The change applies after a restart.
- **Show bookmarks bar:** shows the [bookmarks bar](bookmarks.md#bookmarks-bar) below the toolbar.

## On startup

- **Open:** Last session reopens the windows and tabs you had open when the browser closed; New tab page starts with a single new tab; Specific pages, from 0.1.0-beta.5, opens the pages of the list below it in one window. Restored tabs load when you first open them, so a start with many tabs stays fast.
- **Pages to open:** the pages that Specific pages opens, in their order. Type an address in the field below the list and press Enter to add one, or choose **Remove**. As with a restored session, only the first page loads at once; the others load when you show them.
- **Show home button:** from 0.1.0-beta.5, a home button next to Reload, which opens the home page in the current tab. `Alt+Home` (`Command+Shift+H` on macOS) does the same, also without the button.
- **Home page:** the page of the home button. An empty field opens the new tab page.

On macOS, Astela reopens its windows itself, as **Open** says, so macOS does not ask whether to reopen them, also not after Astela quit unexpectedly.

## New tab page

- **Show the search field** and **Show a clock:** from 0.1.0-beta.5, what the [new tab page](new-tab-page.md) shows. The search field is on and the clock off by default; the clock shows the time of your computer and changes once a minute while the page shows.
- **Most visited sites:** from 0.1.0-beta.5, off by default. The new tab page also shows up to 8 sites that you open most often, from the history of regular windows; private windows show none.
- **Background:** from 0.1.0-beta.5, the background of the new tab page: none, one color, a gradient of two colors, or an image of yours (PNG, JPEG, WebP, GIF or AVIF, at most 10 MB). The browser copies the image into the profile, so moving or deleting the original changes nothing.
- **Shortcuts:** up to 12 pages, each with a title, that the new tab page shows below the search field. A click opens the page in the tab.

## Downloads

- **Save downloads in:** from 0.1.0-beta.5, the folder where downloads are saved; by default the downloads folder of the system. **Change…** picks another one in the dialog of the system.
- **Ask where to save each file:** asks before each download where to save it and suggests that folder. The download starts meanwhile under the name of the file with `.part` added; a cancelled question cancels it.

## Languages

- **Language of the browser:** from 0.1.0-beta.5, the language of the menus, the dialogs and the pages of Astela, such as the settings and the new tab page. Same as the system follows the language of your operating system; English and Deutsch set one. Websites keep their own language.

The language changes when the browser starts again. Until then, the settings page says that some changes take effect after a restart and offers **Restart now**, which quits Astela and starts it again with the windows and tabs that were open, also when it otherwise starts with a new tab page.

## Search

- **Search engine:** DuckDuckGo, Google, Bing, Startpage, Ecosia, Brave Search or Qwant. The address bar and the [new tab page](new-tab-page.md) search with it.
- **Custom:** any search address that starts with `https://` and contains `%s` where the search terms go, for example `https://search.example/?q=%s`.
- **Search engines and keywords:** from 0.1.0-beta.5, a keyword and a space before a search in the address bar search with that engine, such as `@google astela`. The built-in engines have the keywords `@duckduckgo`, `@google`, `@bing`, `@startpage`, `@ecosia`, `@brave` and `@qwant`. Add an engine with a name, a keyword that starts with neither `!` nor `@`, and its search address with `%s`; it can then also be the search engine above.
- **Search sites with !shortcuts:** from 0.1.0-beta.5, a `!bang` at the start or the end of a search searches a site instead, such as `!w astela` on Wikipedia or `astela !gh` on GitHub. **All shortcuts** lists them; an unknown one searches with the search engine. It is on by default.

## Privacy

- **Block ads and trackers:** turns the [content blocker](content-blocker.md) on or off. It is on by default.
- **Hide cookie notices** and **Hide annoyances:** add the lists of EasyList and uBlock Origin against cookie notices, or against newsletter boxes, chat and social widgets, notifications and other annoyances. Both are off by default.
- **Sites without blocking:** the sites on which the content blocker is off, each with the button **Remove**. Type a site's name or address in the field below the list and choose **Add** to add one.
- **Block third-party cookies:** from 0.1.0-beta.5, on by default. Other sites than the one you visit can neither read nor store cookies on its pages: their requests go without cookies, the cookies they send back are not stored, and their scripts and workers find none. This stops the most common kind of tracking across sites; a sign-in that runs in a frame of another site may need the setting off. A change takes full effect after a restart, which **Restart now** does at once. Private windows always block third-party cookies.
- **Always use secure connections:** from 0.1.0-beta.5, on by default. The browser opens sites over HTTPS, also when a link or a bookmark names their insecure `http://` address. When a site has no secure connection, a [warning](page-problems.md#sites-without-a-secure-connection) appears first. Local addresses, such as `localhost`, IP addresses and names without a dot, keep their address.
- **Use secure DNS:** from 0.1.0-beta.5. The browser looks up the addresses of sites over an encrypted connection, so others in the network do not see which sites you open. By default it does so with the provider of your system or network where that provider offers DNS over HTTPS, and looks up addresses as before where it does not. Choosing a provider, such as Cloudflare, Google, Quad9 or Mullvad, or another service by the https address of its DNS over HTTPS service, looks up every address only there. Off looks up addresses as the system does.
- **Clear browsing data:** from 0.1.0-beta.5, **Clear…** asks for a time range and what to clear: the history of the pages you opened in that time, cookies and other site data, and cached images and files. Cookies, site data and the cache are always cleared completely, because the engine keeps no time for them; clearing cookies signs you out of most sites, also of those that asked for a user name and password in a dialog. Private windows keep nothing to clear.
- **Site permissions:** what each site may use after you answered its question, such as the camera or notifications. Change an answer between **Allowed** and **Blocked**, or choose **Remove**, and the site asks again. See [Site permissions](site-permissions.md).

## Default browser

- **Make default:** makes Astela the browser that opens links from other apps. See [Default browser](default-browser.md).

## Import from another browser

- **Import:** bookmarks and history from Chrome, Edge, Brave, Vivaldi, Opera, Firefox and other browsers on this computer, and open tabs from Firefox and the browsers based on it. See [Import from other browsers](import.md).

## Setup

- **Setup guide:** opens the [setup guide](setup-guide.md) again in a new tab.

Settings that your organization manages are shown as such and cannot be changed.
