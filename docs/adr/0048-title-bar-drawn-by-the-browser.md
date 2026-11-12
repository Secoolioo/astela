# 0048. Title bar drawn by the browser

## Status

Accepted.

## Date

2026-11-10

## Context

Until 0.1.0-beta.5, every window had the title bar of the system above the tab strip: a row that shows only the name of the page and takes space from it. Current browsers put their tabs into the title bar and keep the window controls of the system in a corner of it. Electron offers this for windows without a frame of the system: on Windows and Linux, Chromium draws the window controls over the top row of the window (`titleBarOverlay`), on Windows at its right end and on Linux where the desktop puts its window buttons, which can be the left end, the right end or both; Electron tells every view of the window which part of the row the controls leave free (the title bar area of the Window Controls Overlay API). On macOS, the three buttons of the window stay at a position that the browser chooses (`trafficLightPosition`). The window then moves where a page marks a region with `-webkit-app-region: drag`, `app-region: drag` or `window-drag: move`. Electron takes such regions from every view of the window, also from web pages, and a region wins over the views above it, such as the shell and the overlay.

## Decision

- **The top row is the title bar:** with the tab strip at the top, the row of the tabs; otherwise the toolbar. Its free space moves the window, and its tabs, buttons and fields stay clickable. After its last button, the row keeps free room of at least `--space-7`, also when the tabs or the address bar fill it. While the overlay covers the window with a popover or a question, the row does not move the window, so that a click next to the popover reaches the overlay, which closes it ([ADR 0034](0034-overlay-view-for-popovers-and-prompts.md)).
- **Room for the controls:** the browser process tells the shell how high the row is at the current density, and where the controls are and how much room they need: at the start of the row on macOS, and at its end on Windows and Linux until the window reports their place. On Windows and Linux, the shell then leaves the room that the title bar area of the window leaves for the controls, at the start, at the end or at both ends of the row (`app/src/shared/window-controls.ts`). In full screen, where the system hides the controls, the row keeps no room for them.
- **Fitted controls:** the browser process gives the controls the height of the row and its color, the background of the window behind a tab strip at the top and the color of the toolbar otherwise, whenever the density, the place of the tab strip, the theme or the color mode changes (`app/src/domain/windows/title-bar.ts`, `app/src/platform/electron/browser-window.ts`).
- **No regions of web pages:** every document of a web page gets a user style sheet that sets `app-region` and `window-drag` of every element and pseudo-element to their initial value, which marks no region; the page's own declarations, also those with `!important`, have no effect. The frame preload inserts it before the page's styles and scripts ([ADR 0028](0028-content-blocker-rules-through-a-frame-preload.md)). The browser process inserts it as well: into the first, empty document of a page that a script opened, which the script can fill and in which no preload runs, and into every document of a tab once it is parsed, in case no preload ran in it (`app/src/shared/app-region.ts`).
- **A setting:** `appearance.titleBar` chooses between the title bar with the tabs, the default, and that of the system. A window gets its title bar when it opens, so the setting applies after a restart, which the settings page says.
- **Start:** a new window places its page below the rows of the shell as the density and the place of the tab strip set them, until the shell reports where its content area is.

## Consequences

Positive:

- The tabs move up into the space of the title bar, so the page gets a row more.
- People who prefer the title bar of their system keep it.
- A web page cannot move the window or take clicks from the tabs, the address bar or the questions of the browser with regions of its own.

Negative:

- Until the window reports the place of its controls, which it does when the shell has loaded, the shell leaves the room of Chromium's controls on Windows, 138 pixels, at the end of the row; on a Linux desktop with other buttons, the tabs move once when the shell has loaded.
- The room for the three buttons on macOS is a fixed value of the system's.
- Web pages read `none` as the value of `app-region` of their elements, also where they set another one.
- Window managers on Linux that decorate windows themselves may draw a second title bar; the setting turns the browser's off.

## Alternatives considered

- **A window without any frame and controls of the browser's own:** they would not look and behave like the system's, such as the snap layouts of Windows 11.
- **Only the title bar of the system:** the row of the title bar stays empty.
- **`no-drag` for every element of a web page:** it keeps pages from moving the window as well, but every element then marks a region, which Chromium collects and sends to the browser process after every layout.
