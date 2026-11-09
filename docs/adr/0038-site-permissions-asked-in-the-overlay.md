# 0038. Site permissions asked in the overlay

## Status

Accepted. Puts into practice the prompt per origin that [security](../architecture/security.md#permission-handlers) planned, which until now refused every request.

## Date

2026-11-09

## Context

Every session refused every permission. Sites could not use the camera or the microphone for calls, show notifications, know the location, read the clipboard or share the screen. Electron grants everything unless a handler decides, and it reports a check either as granted or as denied: it has no state for a question that was not asked yet.

## Decision

- **What is asked:** the camera, the microphone, the location, notifications and reading the clipboard. The tab's window asks in its overlay ([ADR 0034](0034-overlay-view-for-popovers-and-prompts.md)) and names the site.
- **Kept per site:** an answer holds for the origin of the page in the tab, which also covers the frames that the page lets use a permission; it is kept in the setting `permissions.sites`. The settings page lists the answers per site, changes them and removes them.
- **No answer, no permission:** a question that closes without an answer, such as with Escape, refuses the request once, and the site may ask again. Only the visible tab of a window asks; a page in the background gets nothing. A further question waits for the one before it.
- **Granted without a question:** full screen, pointer lock and writing to the clipboard, as in other browsers. Sharing the screen is granted as a permission, because its own picker asks for every request.
- **Sharing the screen:** a picker in the overlay shows the screens and the windows with pictures of them; the site sees only what the user picks. On macOS 15 and later, the picker of the system is used.
- **Everything else is refused,** such as MIDI, sensors, the local network and window management; the browser's own pages get no permissions at all.

## Consequences

Positive:

- **Sites work:** calls, maps and notifications work once the user agrees, and stay refused where the user says no.
- **One place:** the settings page shows and changes every answer.

Negative:

- **Checks without a question:** before the user answered, Chromium's checks, such as `Notification.permission`, report the permission as denied, not as not decided yet. Sites still ask, but a site that only checks first may not ask at all.
- **Canceled sharing:** Electron reports a canceled screen picker to the page as an aborted capture, `AbortError`, where Chrome reports `NotAllowedError`.
- **Modal question:** the overlay takes the clicks while it asks; a click next to the question closes it without an answer.
- **Location on Linux:** without a location service of the system that Chromium can use, the location stays unknown even after the user agreed.

## Alternatives considered

- **Asking in the shell:** the page lies above the shell, so a question there would be hidden behind it.
- **Answers for the session only:** sites would ask at every start, which other browsers do only when the user wants it.
- **A question kept until the tab is shown again:** it needs the questions to outlive the overlay's closing; the site can ask again instead.
