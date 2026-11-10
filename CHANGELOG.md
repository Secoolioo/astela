# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org); prereleases (`-beta.N`) are published on the beta channel.

## [0.1.0-beta.4] - 2026-11-10

The fourth beta fixes what a test of 0.1.0-beta.3 on real websites found and adds the basics of a browser for every day. Sites that the content blocker broke, such as YouTube, load again; the browser's own pages scroll; pages that cannot load say why; and find in page, zoom, full screen, the developer tools, printing, site permissions, downloads, popups and private windows work as in other browsers. Installed copies of 0.1.0-beta.3 receive it as an update.

### Fixes

- Content blocker: sites whose pages stayed empty or broke with the blocker on, such as YouTube, load again. Each scriptlet runs in its own scope and in the world it was written for, with its arguments as the filter lists give them, and element hiding rules apply as user style sheets, which pages cannot override. The first requests of a page count for that page, not for the page before it.
- Content blocker status: when its filter data is missing or cannot be read, the shield in the address bar and the settings page say that the blocker does not work, instead of showing it as active.
- The browser's own pages, such as the settings, the history and the bookmarks, scroll when they are taller than the window.
- Policies are read again whenever a window gets the focus, as the guide for administrators says, not only every 15 minutes.
- The menu bar of macOS shows all of its menus in German on German systems, and with no window open, New Window and New Tab open one window.

### Security

- On Windows, the browser starts the registry tool of the system by its full path, so that a file of the same name in the working directory, such as one that a site saved in the downloads folder, never runs.

### Features

- Content blocker: serves the replacement resources of uBlock Origin for `$redirect` filters, applies `$removeparam`, `$csp`, procedural element hiding filters such as `:has-text()` and `:remove()`, and `$popup` filters, and turns it off for a whole site, such as every subdomain of `example.com`, while each site of a hosting platform such as `github.io` stays a site of its own. The shield opens a popover with the number of blocked requests, a switch for the site and a reload button. The settings list the sites without blocking and offer two optional lists, against cookie notices and against annoyances.
- Problem pages: a page that cannot load shows the reason and Try again; a page whose process crashed offers Reload; the browser asks whether to wait for a page that stops responding. A certificate that is not trusted shows a warning, and only Continue anyway opens the site, for the rest of the session. A site or proxy that wants a user name and password asks in a dialog.
- Page tools: find in page (`Ctrl+F`, `F3` and `Shift+F3`), zoom per site (`Ctrl+Plus`, `Ctrl+-`, `Ctrl+0`, and on Windows and Linux Ctrl with the mouse wheel, shown in the address bar and in every tab of the site), full screen (`F11`, and videos in full screen), reload without the cache, printing, saving pages, the page source and the developer tools (`F12`, and Inspect in the context menu), and PDF documents in the tab. macOS uses the usual Command shortcuts.
- Site permissions: sites ask before they use the camera, the microphone, the location, notifications or the clipboard, and share a screen or a window only after you picked it. The question takes clicks a moment after it shows, so a double click answers no question by accident, and only the tab in front asks. The answers are kept per site, and the settings list them, to change or remove.
- Downloads: files are saved in the downloads folder without a question, under a free name; on macOS they carry the mark of files from the internet, so the system checks them before they open. A button in the toolbar shows their progress and opens the list, where downloads can be paused, resumed, canceled, opened, shown in their folder, tried again or removed; `Ctrl+J` (`Command+Option+L` on macOS) opens it.
- Windows and popups: pages that a script opens keep their opener, so sign-in and payment popups work; a popup with a size gets a window of its own. A middle click opens a link in the background, a click with Shift in a new window. Pages that a page opened stay open when it closes. `Ctrl+N` opens a new window, and windows open where they were at the last start, fitted to their screen.
- Private windows: `Ctrl+Shift+N` (`Command+Shift+N` on macOS) opens a dark private window that keeps no history and no session; its cookies and site data stay in memory and are deleted when the last private window closes.
- Browser menu: new windows and private windows, the downloads, the zoom, find, print, save, the source and the developer tools, About and Quit; macOS gets a File menu.
- Policies: `SSLErrorOverrideAllowed`, `DeveloperToolsAvailability`, `PrivateModeAvailability`, `ContentBlockerCookieNoticesEnabled` and `ContentBlockerAnnoyancesEnabled`.

### Performance

- More code loads when it is first needed, such as the handlers of the browser's own pages, the code of the filter engine, the policy readers of each system, the rollback, the bookmarks, the color solver for a custom accent and the code that shuts the browser down, so the start stays within its budget with the new features.
- The browser's own pages, such as the shell and the new tab page, load in the renderer that their view started instead of in a second one, and the policies are read only once while the first window opens, so the window is ready sooner, on Windows in particular.

## [0.1.0-beta.3] - 2026-11-01

The third beta makes the browser usable for everyday testing: a setup guide, a new tab page, settings, a content blocker, history, bookmarks, the restore of the last session and the import from other browsers. Installed copies of 0.1.0-beta.2 receive it as an update, and the setup guide opens once after the update.

### Features

- Setup guide: on the first start of every profile, also after this update, a guide in the first tab sets the color mode and accent color, where the tabs are, the density and the bookmarks bar, the search engine, the import from other browsers, the content blocker and the default browser. Every choice applies at once, every step can be skipped, and the settings page opens the guide again.
- New tab page: new tabs show a start page with a search field for the chosen search engine.
- Settings page: the color mode (System, Light or Dark), the accent color from presets or any color, the density, the tab strip at the top, bottom, left or right, the bookmarks bar, what opens on startup, the search engine (DuckDuckGo, Google, Bing, Startpage, Ecosia, Brave Search, Qwant or a custom search address), the content blocker, the default browser and the import. Settings that a policy sets are shown as managed. The menu at the right end of the toolbar opens the settings, the history and the bookmarks.
- Content blocker: blocks ads and trackers with the filter lists that uBlock Origin enables by default, except Peter Lowe's list, whose terms do not allow redistribution, including their element hiding rules and scriptlets, also in frames. It is on by default; the shield in the address bar shows how many requests it blocked on a page, and its menu turns it off for a site.
- Session restore: the browser reopens the windows and tabs of the last session; restored tabs load when they are first shown.
- History: the history page lists the visited pages by day, finds them by words of their title or address, and removes single pages or all of them.
- Bookmarks: the star in the address bar bookmarks a page (Ctrl+D, or Command+D on macOS); the bookmarks page organizes bookmarks in folders; the bookmarks bar shows them below the toolbar (Ctrl+Shift+B, or Command+Shift+B on macOS).
- Import: bookmarks, history and open tabs from Google Chrome, Microsoft Edge, Brave, Vivaldi, Opera, Chromium, Firefox, Zen, LibreWolf, Floorp and Waterfox, with one click per profile, while the other browser keeps running. Open tabs come from Firefox-based browsers.
- Default browser: links from other apps open in a new tab of the window used last, and the browser can become the default browser on Windows, macOS and Linux, except as an AppImage or an MSI installation.
- Policies: `ContentBlockerEnabled`, `TabStripPosition`, `BookmarkBarEnabled`, `SetupGuideEnabled`, `ImportEnabled` and `DefaultBrowserSettingEnabled`.

### Performance

- The policies are read while Electron starts instead of before, which shortens the start on Windows.
- The bundles leave out documentation comments, and code that only some starts need, such as the update feed, loads when it is needed, so less code loads at the start.

## [0.1.0-beta.2] - 2026-11-01

The second beta adds context menus and the keyboard shortcuts that are usual on each system. Installed copies of 0.1.0-beta.1 receive it as an update: through the update feed for the Windows installer, the AppImage and macOS, and with the system updates for deb and rpm packages.

### Features

- Context menus for links, images, selected text, text fields and the page itself, shown as native menus of the operating system in English or German. Links and images open in a new tab in the background, link and image addresses and images can be copied, and selected text can be searched with the search engine of the address bar. Text fields, including the address bar, have Undo, Redo, Cut, Copy, Paste and Select all.

### Fixes

- Keyboard shortcuts follow the conventions of each system. On macOS, Command+[ and Command+] go back and forward, and Command+Left Arrow and Command+Right Arrow move the cursor in text as everywhere on macOS. New shortcuts include Ctrl+Page Up and Ctrl+Page Down to switch tabs and F6 or Alt+D for the address bar on Windows and Linux, and Command+Option+Left Arrow and Command+Option+Right Arrow to switch tabs on macOS. The back and forward buttons of a mouse go back and forward over the page and over the toolbar.
- The website shows the screenshots of the current release again; the light screenshot of 0.1.0-beta.1 was blank.

### Security

- Electron 45.2.1 instead of 45.0.0, with Chromium 156.0.8078.75 (was 156.0.8078.48) and Node.js 24.22.1 (was 24.22.0). They bring the security fixes released since the first beta.

## [0.1.0-beta.1] - 2026-10-29

The first beta: a minimal browser that already runs through the complete package, update, release and website chain. It is meant for testing, not for daily use yet.

### Features

- Browser windows with tabs and an address bar that tells addresses from searches. Tabs open, close, switch and reopen after closing; pages go back, forward and reload, from the toolbar or with keyboard shortcuts.
- Security baseline: every page runs sandboxed and isolated, permission requests are denied, and web pages cannot open the browser's internal pages. The browser sends no telemetry.
- Policies from the Windows registry, macOS configuration profiles and JSON files on Linux, read before the first window opens.
- Signed updates on the beta channel with delta downloads. If a new version fails to start twice, the previous version comes back on its own.

### Packaging

- Windows installer (NSIS), macOS disk image and Linux AppImage, deb and rpm packages, each for x64 and arm64. MSI packages start with 0.1.0, the first stable release. The Windows installer closes a running browser without PowerShell or WMI, whose queries took minutes on some systems.
- APT and DNF repositories for the deb and rpm packages. Installing a package adds its repository, so the browser updates with the system.
- Every release ships `SHA256SUMS` with two signatures, a software bill of materials and build provenance attestations, so every download can be verified.

### Documentation

- Website with a download page, the roadmap, the architecture documentation and decision records, the maintainer workflow, an API reference and this changelog.
