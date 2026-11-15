# 0053. Sleeping tabs and an exact session

## Status

Accepted. Extends [ADR 0002](0002-electron-and-webcontentsview.md), [ADR 0026](0026-internal-pages-share-tabs-with-web-pages.md) and [ADR 0040](0040-tabs-and-popups-that-keep-their-opener.md). The exact session is built: the back and forward history of each tab with scroll positions and form values within limits, windows in full screen and in the order they were used, and the session after a crash. Tabs that sleep build on the same model in later changes of 0.1.0-beta.7.

## Date

2026-11-11

## Context

Until 0.1.0-beta.6, `session.json` kept the address, the title and the pinned flag of each tab, the active tab, and where each window was and whether it was maximized. After a restart, no tab could go back or forward, a page came back at its top without what was typed into it, a window in full screen came back as a window, and the windows came back in the order in which they had opened. A crash, a kill or a forced shutdown of the system followed the setting `startup.page` like a normal quit, so people who start with a new tab page lost every tab.

A restored tab got its view when it was first shown, with nothing but its address (`lazyTabs`). The roadmap plans tabs that sleep: their view closes and their history stays, as [ADR 0002](0002-electron-and-webcontentsview.md) describes. Both are tabs without a view, and both need their history back when they show again.

0.1.0-beta.6 reads `session.json` only in version 1. A version 2 would make it drop the whole session after a rollback by the boot guard.

A short experiment on Linux measured `navigationHistory.restore()` with page states across a restart, `close({ waitForBeforeUnload: true })`, the memory a closed tab frees, entries sent with POST and the title during a restore ([validation results](../architecture/validation.md#restoring-tabs-with-their-history-and-closing-pages)).

## Decision

- **One model for tabs without a view:** a dormant tab keeps its address and its history (`DormantTab` in `app/src/platform/electron/browser-window.ts`). Restored tabs that are not active and the pages of the start are dormant, and so will be tabs that sleep. Showing, navigating or reloading a dormant tab wakes it (`wake(id)`): it gets a view of the kind of the entry that it shows, a web view or the view of one of the browser's own pages, and its views of ADR 0026 come back with `navigationHistory.restore()`. `restoreInto()` waits for the handlers of an internal page, as a load does, also when Back and Forward cross views. A dormant tab without a history loads its address. Stop does nothing to a dormant tab; Back and Forward step its history first, so the page loads once. The commit of the restored entry records no visit, and the tab keeps its icon.
- **The history of a tab:** `TabHistory` (`app/src/domain/tabs/view-history.ts`) holds the views of a tab from the oldest, each with its entries (address, title and Chromium's page state) and the entry that it shows, and the view that the tab shows. An open tab gives it when the session needs it and keeps it until its page changes (`historyOf`); before the last regular window closes and when the browser quits, it reads it anew (`readHistories`, `snapshot({ fresh: true })`), so the scroll positions are those of the moment, also when people quit by closing the last window, as on Windows and Linux, where the tabs are gone by the time the browser quits. A dormant tab keeps its history in memory within 49 entries back and 49 forward, 512 KiB of page state per entry and 1 MiB per tab (`memoryLimits`).
- **`session.json` stays at version 1:** each tab may have `history`, each window `fullScreen`. Both are optional and read field by field, so 0.1.0-beta.6 ignores them and keeps every tab, and the files of 0.1.0-beta.6 read as tabs with their address alone. The windows come in the order in which they last had the focus, the window used last at the end, so it opens last and ends up in front; the session is written again when another regular window becomes the one used last. The focus of a popup or a private window, which the session does not keep, writes nothing.
- **Writes:** the session is built and written at most once a second after a change that it keeps. A new title alone, as of a page that counts down or shows unread messages in its title, waits 30 seconds, and the session is built only when it is written then (`scheduleLater` of `JsonFileSessionStore`); any other change writes it within the second, with the newest titles. A start that does not restore the session reads the file but does not parse it. Each history is cut to its limits once: `trimHistory` gives a history that it made within the same or narrower limits as it is, so a history from the file is not cut again on its way into a tab.
- **What the session keeps of a history** (`trimHistory` with `sessionLimits`, `app/src/domain/tabs/tab-history.ts`): 24 entries back and 24 forward of the current entry, counted across views. An entry stays only in a view of its kind: web pages in web views, and in the view of one of the browser's own pages only that page; the setup guide, `about:`, `data:` and `file:` never stay. Addresses are at most 8,192 characters, titles are cut to 1,024. Page states stay only as base64 text, at most 32 KiB per entry and 128 KiB per tab, from the current entry outward. A file keeps at most 4 MiB of page states: first those of the entries that the tabs do not show go, of the tabs that are not active first, then those of what the tabs that are not active show (`fitSession`). A history whose current entry is not the tab's address is not kept.
- **Full screen:** a window keeps the full screen that people chose, with the shortcut or the controls of the system, but not that of a page. It comes back after the window is maximized; the bounds stay those of the window outside full screen.
- **A crash marker:** the browser writes the empty file `session.json.running` after the shell of its first window has loaded, and removes it after the last write of the session when it quits normally. When the file is there at the start, the last run did not quit normally, and the last session comes back whatever `startup.page` says, unless a mandatory policy (`RestoreOnStartup`) sets it; a recommended one is a default that people may change, so it does not keep the session away (`sessionStart` in `app/src/domain/session/session.ts`). No dialog asks; the log notes the restore with the number of windows and tabs, without addresses. The self-test of the packages and the rollback of the boot guard quit with `app.exit()` and leave the marker, which only their own profiles see. On Windows, a sign-out or a forced shutdown counts as a crash.
- **Clearing:** clearing the whole history, on the history page or with **Clear…** in the settings for all time, clears the back and forward lists of the tabs of regular windows and of the session; each tab keeps only the entry that it shows. A shorter time range keeps them, as entries carry no time. Before the clear answers, `session.json` and `session.json.bak` are both written without the lists (`forgetHistories` of `JsonFileSessionStore`), from the session of the open windows, or from the stored one while only private windows are open, so that no backup keeps them. Chromium keeps the entries of a view while a load of one of them runs, such as a restore, Back or a reload; such a view shows neither Back nor Forward and gives the session only the entry that it shows, and drops the entries once the load ends.
- **Private windows** are never saved, as before.
- **Sleeping tabs**, which later changes build: a tab sleeps by hand from its menu, or by itself after `tabs.sleepAfter` seconds, 3,600 by default, while `tabs.sleep` is on; the policies `SleepingTabsEnabled` and `SleepingTabsTimeout` take the values of Microsoft Edge. A tab never sleeps by itself while it shows, is pinned, plays sound, shows a video in picture in picture, uses a camera, a microphone or the screen that it was granted, downloads, has the developer tools open or is linked to a live page as its opener or the page it opened, or while its page asks to stay (`will-prevent-unload`). The state of picture in picture comes from the probe of the record of the reader view and picture in picture (ADR 0056, 0055 in the plan), which runs before every sleep; the frame preload gets no channel of its own for it. The scheduler loads after the first shell, arms at most one timer, and none while no tab can become due or while `tabs.sleep` is off. `tabs.sleepAfter` also accepts 30 seconds, which only a policy or the settings file can set, so that end-to-end tests use the real mechanism instead of a switch for tests ([ADR 0022](0022-test-strategy.md)). Sleeping tabs get no thumbnail yet, unlike the plan in [performance](../architecture/performance.md).

### Deviations from the design

- The design numbered this decision 0049, and the plan 0052; ADR 0049 for the logo shifted the numbers. The design's second record, picture in picture reported by the frame preload, is not written, as the plan decided.
- `fitSession` runs when the session is written (`JsonFileSessionStore`), not in `WindowManager.snapshot`: only a file larger than 4 MiB can hold more page states than that, so the start-up path keeps one comparison, and the code that fits the session loads with the first such file (`app/src/domain/session/fit-session.ts`).
- The order of the windows is written when another window becomes the one used last, and not only with the next change of tabs, so that a crash keeps it as well.
- Full screen from the controls of the system, such as the green button on macOS, counts as people's, like the shortcut.
- Back and Forward across views record visits as before; only the page of a tab that wakes records none.
- A load that comes while a view waits for the handlers of its internal page keeps the entries that the view is to restore before it, and while it waits, the view gives those entries to the session.
- A page state that does not fit into the room of its tab is left out, and the next one, farther from the current entry, may still fit.
- The experiment showed that `will-prevent-unload` fires without sticky user activation on a `WebContentsView`: every page whose `beforeunload` handler cancels stays when the browser asks it to close, and a page that hangs closes after about a second. The automatic sleep counts every such refusal.
- The design writes the session at most once a second. A new title alone waits 30 seconds: the file holds up to 4 MiB of page states, and a page that changes its title every second would otherwise write it every second.
- The design reads the page states anew only when the browser quits. The browser also reads them before its last regular window closes, because the browser quits with its last window on Windows and Linux, and its tabs are gone then.
- Clearing the whole history also writes `session.json.bak` without the lists, and a view keeps clearing its entries until a load that runs ends, which Chromium needs and the design did not foresee.
- The start decision is the pure function `sessionStart`, so that unit tests check the exception for a mandatory policy with the real setting and its policy layers; end-to-end tests set policies of the system only on CI runners.
- The experiment ran on Linux under Xvfb only. macOS 15, Windows 2025 and Wayland with headless Weston were not measured; the end-to-end tests of the history, the scroll position, full screen and the crash run on the CI runners of macOS and Windows, and Wayland needs a run by hand.

## Consequences

Positive:

- Every tab comes back with its back and forward history after a restart, an update or a crash, also across the browser's own pages, and the active tab at its scroll position with its form values.
- Windows come back in full screen where they were, and the window used last in front.
- A crash, a kill or a forced shutdown no longer costs the tabs of people who start with a new tab page.
- 0.1.0-beta.6 still reads the session with every tab after a rollback.
- Restored tabs still cost nothing until they show, and tabs that sleep can share the same path.

Negative:

- Form values reach `session.json` on disk, as in Chromium. Chromium keeps no password in the page state, private windows are never saved, and clearing the whole history clears them.
- `session.json` grows, by up to 4 MiB of page states; the session is still built and written at most once a second while tabs change, and once in 30 seconds while only titles change, from the histories that open tabs keep until their page changes.
- Scroll positions are read only when a page changes, before the last window closes and when the browser quits: after a crash, a page comes back where it was when it last changed, and its title may be up to 30 seconds old.
- A start after the self-test of a package, a rollback of the boot guard or a sign-out on Windows restores the session as after a crash.
- After a rollback, 0.1.0-beta.6 writes the session again without the histories.
- The start-up path of the browser process grows by about 9 KiB, from 123.2 to 132.4 KiB, as the history has to be read before the first window, and the start decision, the timing of the writes and the reading of the page states before the last window closes are needed from the first window on.

## Alternatives considered

- **Hidden views for restored and sleeping tabs:** they keep their renderer, so they save no memory.
- **A history file of its own:** after a crash, it can disagree with `session.json`.
- **`session.json` version 2:** 0.1.0-beta.6 would drop the whole session after a rollback.
- **A timer that reads the page states of open tabs:** it would wake the browser while it is idle.
- **A question after a crash whether to restore:** one more step for the common case; the session comes back, and people close what they do not want.
- **A switch for tests that makes tabs sleep at once:** ADR 0022 rules out ways into the browser that only tests use.
