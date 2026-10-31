# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org); prereleases (`-beta.N`) are published on the beta channel.

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
