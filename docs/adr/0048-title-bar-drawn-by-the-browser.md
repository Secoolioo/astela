# 0048. Title bar drawn by the browser

## Status

Accepted.

## Date

2026-11-10

## Context

Until 0.1.0-beta.5, every window had the title bar of the system above the tab strip: a row that shows only the name of the page and takes space from it. Current browsers put their tabs into the title bar and keep the window controls of the system in a corner of it. Electron offers this for windows without a frame of the system: on Windows and Linux, Chromium draws the window controls over the top right corner of the window (`titleBarOverlay`), and on macOS the three buttons of the window stay at a position that the browser chooses (`trafficLightPosition`). The window then moves where the page marks a region with `-webkit-app-region: drag`.

## Decision

- **The top row is the title bar:** with the tab strip at the top, the row of the tabs; otherwise the toolbar. Its free space moves the window, and its tabs, buttons and fields stay clickable.
- **Room for the controls:** the browser process tells the shell where the controls are and how much room they need, at the start of the row on macOS and at its end elsewhere, and how high the row is at the current density. It fits the controls to the row and to the background of the theme when either changes (`app/src/domain/windows/title-bar.ts`).
- **A setting:** `appearance.titleBar` chooses between the title bar with the tabs, the default, and that of the system. A window gets its title bar when it opens, so the setting applies after a restart, which the settings page says.
- **Start:** a new window places its page below the rows of the shell as the density and the place of the tab strip set them, until the shell reports where its content area is.

## Consequences

Positive:

- The tabs move up into the space of the title bar, so the page gets a row more.
- People who prefer the title bar of their system keep it.

Negative:

- The width of the window controls on Windows and Linux is a fixed value of Chromium's; a change in Chromium needs a change of that value.
- Window managers on Linux that decorate windows themselves may draw a second title bar; the setting turns the browser's off.

## Alternatives considered

- **A window without any frame and controls of the browser's own:** they would not look and behave like the system's, such as the snap layouts of Windows 11.
- **Only the title bar of the system:** the row of the title bar stays empty.
