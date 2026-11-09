# 0034. Overlay view for popovers and prompts

## Status

Accepted. Implements the overlay view of the [architecture overview](../architecture/overview.md).

## Date

2026-11-09

## Context

Web content lies in views above the shell, so nothing that the shell draws can cover a page. Native menus can, but they offer only items in a list. The content blocker's shield needs a popover with a count, a switch and a link, and later steps need prompts for permissions, sign-in and downloads that look like the browser and work with the keyboard. A view on top of a window takes all clicks and the focus of what lies below it, also where it draws nothing.

## Decision

- **One overlay per window:** a `WebContentsView` with a transparent background shows the page `app://overlay` from the session of the browser's own views, sandboxed and with context isolation. It is made with the first popover of the window. It uses the preload of the internal pages with the scope `overlay`, so its page reaches only the channels of the capability `overlay`.
- **Only while open:** the view is part of the window only while it shows something and covers the whole window then. The page draws the popover at the rectangle that the shell reports for its button and leaves the rest see-through.
- **Closing:** a click next to the popover, Escape, a shortcut of the browser, a change of the window's size and a change of the visible tab close it; a shortcut runs after it closed. The focus then goes back to the page, or to the shell for the new tab page.
- **Content:** the browser process sends what the overlay shows over `overlay.changed` and answers `overlay.get` for a page that just loaded. Each kind of content has its own schema in `overlay-contracts.ts`: the content blocker's popover, and the prompt for the user name and password that a site or a proxy asks for, which a click next to it does not close and whose closing cancels the request. The code of the overlay loads with the first popover, not at the start.

## Consequences

Positive:

- **Above the page:** popovers can cover web content and still look and work like the rest of the browser, including the design tokens, both languages and the keyboard.
- **Base for later prompts:** permission prompts, sign-in dialogs and the download panel get a place without new views.

Negative:

- **Clicks next to a popover:** a click that closes the popover does not reach the page or the shell below it, as with the bubbles of other browsers.
- **Memory:** the overlay's page costs a renderer once a window opened a popover.

## Alternatives considered

- **Native menus:** they cannot show switches, numbers or text fields.
- **Resizing the overlay to the popover:** a click next to it would not close it, and each popover would need its size before it is drawn.
- **A view per popover:** each would start a renderer and load its page again.
