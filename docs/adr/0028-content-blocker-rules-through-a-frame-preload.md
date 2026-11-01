# 0028. Content blocker rules through a frame preload

## Status

Accepted

## Date

2026-11-01

## Context

Network rules cannot remove what a page draws from its own domain, and many filters of uBlock Origin's lists are element hiding rules and scriptlets ([ADR 0027](0027-blocker-with-the-default-lists-of-ublock-origin.md)). A scriptlet only works if it runs before the page's own scripts, in the page's world, in every frame of the page.

[ADR 0018](0018-content-blocker-engine.md) planned a frame preload that receives its rules over a validated IPC contract, and [ADR 0007](0007-ipc-contracts-and-validation.md) allows no synchronous IPC and no IPC from web content. Spike S1 on 2026-11-01 (Electron 45.2.1) showed that a frame preload registered with `session.registerPreloadScript({ type: 'frame' })` runs in top frames and cross-origin iframes when `nodeIntegrationInSubFrames` is set; that `ipcRenderer.sendSync` took 0.1 to 0.8 ms; and that `webFrame.executeJavaScript` from the preload runs before the first inline script of the page. An asynchronous request returns too late for that.

## Decision

- **Frame preload:** `app/src/preload/frame.ts` is registered on every web session and runs in every web frame, sandboxed, with context isolation and without Node. Web views set `nodeIntegrationInSubFrames` only so that it runs in iframes. It exposes nothing to the page.
- **One synchronous call per frame:** when a frame starts, the preload sends `blocker.frame` with `sendSync` and receives the hiding rules of the frame's address as a style sheet and its scriptlets. It inserts the style sheet with `webFrame.insertCSS` and runs the scriptlets with `webFrame.executeJavaScript` in the page's world. This is the only synchronous IPC in Astela; before the engine has loaded, the answer is empty and nothing waits.
- **Rules for the page's elements:** after the document is parsed, and for elements added later, the preload reports classes, ids and link targets once each through `blocker.elements` (`invoke`) and inserts the generic hiding rules that match them.
- **Validation:** both channels answer only frames of web sessions, read the frame's address from the frame itself instead of the message, and accept at most 1,000 short strings per list. They return only rules from the filter lists, and nothing when the blocker is off.
- **Extended selectors** (procedural rules such as `:has-text`) are not applied yet.

This record is an exception to ADR 0007 for these two channels.

## Consequences

Positive:

- Element hiding and scriptlets work in every frame, as in uBlock Origin, and scriptlets win the race against the page's scripts.
- Web content still cannot reach any channel of the browser's own UI; the two blocker channels give out public filter data at most.

Negative:

- Each web frame start waits for one synchronous message, well under a millisecond in the spike.
- Procedural rules of the lists have no effect until extended selectors are supported.

## Alternatives considered

- **Asynchronous rules only:** scriptlets would often run after the page's scripts and fail.
- **Injecting from the browser process after navigation:** `executeJavaScript` from the browser process arrives after the page has started.
- **Rules in the preload's command line:** the rules depend on each frame's address, which is not known when the view is created.
