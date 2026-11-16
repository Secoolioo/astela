# 0054. Split view with two tabs side by side

## Status

Accepted. Amends [ADR 0002](0002-electron-and-webcontentsview.md): a window attaches the views of two tabs while it shows a split view. Amends [ADR 0036](0036-problem-pages-drawn-by-the-shell.md): the shell draws the problem of a page in the side of a split view that it belongs to. Amends [ADR 0038](0038-site-permissions-asked-in-the-overlay.md): of the two pages that a split view shows, only the side with the focus asks. The roadmap's layouts of two to four panes come later; this decision covers two tabs side by side. [ADR 0055](0055-tab-groups-and-workspaces-in-the-tab-model.md) keeps both tabs of a split view in one group of tabs: the tab that joins takes the group of the tab that stays.

## Date

2026-11-11

## Context

People compare two pages, read one while they write in another, or keep a call next to a document. Until 0.1.0-beta.6, a window showed one tab at a time: only the view of the active tab was attached (ADR 0002), the shell drew the problem of that tab across the whole content area (ADR 0036), and only the page of that tab could ask for permissions or a password (ADR 0038). The browser process and the shell share one content area, which the shell reports with `shell.setInsets`, and the views of pages lie above the shell.

Two pages in one window raise questions that one page did not:

- Which page gets the keys. The address bar, the toolbar, find, zoom and every shortcut act on the active tab; with two pages, the active tab must be the one people work in. Chromium focuses a web page when its main frame commits in an active window (`focusOnNavigation`), so a page that navigates by itself could take the keys, such as a password, from the other side.
- Where the pages lie. The browser process places the views, and the shell draws the divider and the line that marks the side with the focus. Two sources of the same geometry drift apart.
- What a page in full screen, a problem of a page and a question of a site cover: the whole window, or one side.

A spike on Electron 45.2.3 (see [Validation](../architecture/validation.md#focus-between-two-views-of-a-window)) showed that with `focusOnNavigation: false` neither `window.focus()`, nor a navigation that a page starts, nor Tab past the end of a page moves the native focus between two attached views; a click and the browser's own `webContents.focus()` do, and both emit the `focus` event of the web contents.

## Decision

- **Pairs in the tab strip:** the `TabStrip` of a window keeps pairs of neighbouring tabs, `SplitPair { start, end, ratio }`. `start` is the left side and comes right before `end`; `ratio` is the share of the width of the left side, from 0.2 to 0.8. Pinned tabs are never in a pair, and a tab is in one pair at most. A pair is a unit of the strip: `unitOf` gives both tabs, `shown` gives both while one of them is active, and moving, stepping, opening new tabs after a tab and closing the other tabs treat the pair as one; nothing comes between its tabs. `TabService` has `splits`, `splitOf`, `split`, `unsplit`, `swapSplit` and `resizeSplit`, and every change of a pair is kept by the session. `TabViewPort.show(id, split?)` shows the active tab and, in a split view, the other tab beside it.
- **The active tab is the side with the focus:** a click into the other side gives its page the focus, and the `focus` event of its web contents makes its tab the active one, without focusing anything else. Ctrl+Tab and Ctrl+Shift+Tab reach the other side too, as the two tabs are neighbours. Everything that acts on the active tab acts on that side: the address bar, which keeps a draft per tab, the buttons of the toolbar, the star, the shield, zoom, find, print, save, the source, the developer tools and the shortcuts. Closing either tab ends the split view; the other tab shows alone and keeps or gets the focus.
- **No page takes the focus by itself:** every tab view, of web pages and of the browser's own pages, gets `focusOnNavigation: false`. The browser gives the page the focus where it did before: when a tab shows, when an address loads, when its view is replaced, and after Back, Forward and Reload while the window has the focus.
- **One geometry:** the pure `app/src/shared/split-view.ts` gives the sizes and divides the content area: an 8 px divider, a 2 px line above the sides, at least 200 px per side while the area has room, and 20 to 80 % for the left side, in whole pixels that neither overlap nor leave a gap. The browser process lays the two views out with `splitPanes`, and the shell draws the divider and the line with the same function from the content area that it reports. The sizes are layout widths; density does not scale them.
- **The divider:** an ARIA separator between the sides, which the pointer drags and the keys move: the arrows by 5 %, Home and End to the limits, and a double click makes the sides equal. While it moves, the shell sends `tabs.resizeSplit` once per frame and at most every 8 ms (`splitPreviewEvery`), and the browser process only moves the pages; the share counts for the state of the shell and the session once the divider is let go. The shell draws that share until a state brings it, or another pair, and for a second at most. The channel loads with the later handlers of the shell.
- **Problems per side:** the shell draws the problem of a page in the side of its tab, with ids of their own per tab, and the buttons of a problem act on the tab of that side; a press into a side with a problem gives that side the focus.
- **Full screen while focused:** a page in full screen covers the window while its tab is the active one, and the other side hides meanwhile; both sides come back when the page leaves full screen.
- **Questions only from the side with the focus:** the side without the focus is treated like a tab in the background: a site there gets no permission without a question, and its sign-in waits until that side has the focus. The questions of the side with the focus, its sign-in and the screen picker show over its side (`pane` of the overlay's content, `paneOf` of the window).
- **Find in the side with the focus:** the find bar ends where the side with the focus ends, and closes when the other side gets the focus, as when another tab becomes active. A left side narrower than the bar leaves its controls at the start of the window, so that the bar is never wider than the window.
- **Opening and ending:** the menu of a tab opens it beside the active tab, which keeps its place and side ('Open in split view'), or a new tab page beside the active tab itself ('New tab in split view'), and swaps or ends the split view of a tab in one. The window command `split.toggle` (Ctrl+Shift+S; Control+Command+S on macOS, where Shift+Command+S means Save As) opens a new tab page beside the active tab or ends its split view, and `split.swap` swaps the sides without a default shortcut; both come after `tab.mute` in the catalog. The View menu of macOS has Split View after Full Screen.
- **The tab strip:** the two tabs of a pair stand together, without the gap between them, rounded at their outer corners, on a surface of their own where the active tab's surface does not lie. A screen reader hears which side a tab is. Dragging either tab drags both.
- **Session:** the session keeps the pairs of each window in the optional field `splits`, `{ start, ratio }` with the index of the left tab among the tabs that the session keeps; the format stays at version 1, and earlier versions read the session without it. At the start, both pages of the split view of the active tab load; the other tabs stay without a view until they show.
- **A setting and a policy:** `splitView.enabled`, with the policy `SplitViewEnabled` as mandatory or recommended policy, turns split view off at once: the split views that show end, the items of the tab menu and of the View menu of macOS are gone, the shortcuts reach the pages, and a restore drops the pairs.
- **Lazy:** the menu items load with the tab menu, the View menu with the menu bar, the handler of the divider with the later handlers of the shell, and the panes of the questions with the prompts. Opening and ending a split view with the shortcut runs in the window, so the first press waits for no chunk.

### Deviations from the design

- The design numbered this decision 0049, and the plan of 0.1.0-beta.7 0053; ADR 0049 for the logo shifted the numbers.
- The pairs live in the `TabStrip` of the tab foundations, and the active tab with its partner is `shown`, as the plan decided, instead of private fields and `visible` of `TabService`. The units of the shell's drag come from `strip-items.ts`, which replaced the design's `tab-units.ts`; a dragged pair moves as a whole, and the units close up without the gap that a pair has not between its tabs.
- The access keys of the tab menu are those of the plan: `Open in split v&iew`, `New tab in split v&iew`, `End split v&iew` and `Sw&ap sides`, in German `&geteilte Ansicht` and `Seiten ta&uschen`, as `s` belongs to putting a tab to sleep.
- The two commands come after `tab.mute`, as the plan placed them, not after `tab.pin`.
- With the setting off, the shortcuts of split view are not in the table of shortcuts, so their keys reach the pages, and the View menu of macOS has no item, as for the command palette; the design let them do nothing.
- The browser focuses a page after Back, Forward and Reload only while its window has the focus, as Chromium did when a page committed.
- The question of a page in a split view lies in the middle of its side, but no closer than 8 px to the edges of the window, so that a narrow side does not push it out of the window.
- The rule that a pair lies inside one tab group comes with the groups, which are not built yet.
- The share and the text of the divider for screen readers follow the pointer while it drags, through the attributes of the element, not through the template, which renders only when the state changes.
- The find bar ends at the edge of the side with the focus also with the tab strip on the right, where the edge of the right side is not the edge of the window.
- The back and forward buttons of a mouse over the problem of a side act on that side's tab.
- The tab strip's rule for a vertical list applies to the tab list alone, since the divider is a vertical separator as well.
- The menu of the browser in the overlay gets no item for split view in this release.
- The pages follow the divider at most every 8 ms, not in every frame: on a display faster than 120 Hz, one preview per frame used up the budget of `tabs.resizeSplit` (240 per second) in a long drag, and the share that counts when the divider is let go could be refused.
- The share that the shell draws after the divider was let go, or moved by a key, ends with the state that brings it or with another pair, as the design has it, and also after a second without such a state, so that a share that the browser did not take is not drawn on. A state that the browser made before it took the share, such as of a page that loads, leaves it as it is.
- Only in a split view does the address bar of a new tab page wait until the shell has the focus of the window, so that a new tab page that took the focus with a click keeps it. Alone, the new tab page gives the address bar the focus also in a window behind another one, as before, and what people type there goes to it once the window comes to the front. A new tab page that becomes the side with the focus of a split view while its window is behind another one gets the keys once people click into it.
- The find bar is never wider than the window (`min-width: 0` and `justify-content: safe flex-end`): the room after its controls in a narrow left side made the grid of the shell wider than the window.

## Consequences

Positive:

- Two pages of a window side by side, with the shortcut, the tab menu or the View menu of macOS, which come back after a restart with the width of their sides.
- No page can take the keys from the page that people work in, also not in a window with one page.
- The browser process and the shell place the pages and the divider from one function, so they cannot drift apart.
- Pairs are units of the tab strip, which groups and workspaces extend.

Negative:

- A site in the side without the focus gets no permission without a question, such as a call that asks for the microphone before people click into it. They click into its side, and it asks again.
- Two pages render at once, and a drag of the divider lays both out in each frame; on software rendering, as on virtual machines, the drag may lag.
- The divider is 8 px wide, narrower than the 24 px that WCAG 2.5.8 asks of a target; the keys, the double click and the menu items reach the same.
- At fractional scaling, two views and the divider round to device pixels on their own, so a seam of 1 px may show at the edge of a side.
- After Back, Forward or Reload in a window without the focus, the page gets the focus only when people come back to it. Screen readers need a check in the test of each minor version.

## Alternatives considered

- **A window of the system per side:** no shared tab strip, address bar or session, and Wayland lets no program place its windows.
- **The shell reporting a rectangle per side:** two sources of the same geometry, which race with the changes of a pair.
- **Letting the side without the focus ask, with the question over that side:** a site could time its question so that it borrows the trust of the site in the address bar.
- **A gate on mouse presses through `before-mouse-event` before the other side becomes active:** the spike showed that only a click and the browser move the focus while no page takes it on navigation.
- **Two to four panes in a tree of layouts now:** beyond 0.1.0-beta.7; the pairs of the strip can grow into it.
- **Dimming the side without the focus:** a view cannot be dimmed without a view above it, which would take the clicks; the line above the side with the focus marks it instead.
