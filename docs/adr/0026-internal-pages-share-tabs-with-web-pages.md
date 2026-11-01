# 0026. Internal pages share tabs with web pages

## Status

Accepted

## Date

2026-11-01

## Context

[ADR 0008](0008-internal-pages-via-app-protocol.md) serves the browser's own pages from `app://` and opens them as tabs with a preload scoped to each page. A tab can therefore show a web page and, after a navigation, an internal page, and back. The two kinds of pages cannot share a view: a `WebContents` keeps the session it was created with, web sessions refuse every `app://` request, and only views of the internal session may get a preload ([ADR 0007](0007-ipc-contracts-and-validation.md)).

A spike on 2026-11-01 measured views on Linux with Electron 45.2.1 and software rendering:

- Every internal view gets a renderer process of its own, also for the same host; three views of `app://newtab` used three processes. Each used 21 MB PSS, a web view 25 MB.
- Creating a view takes 1 ms and loading the new tab page from `app://` 23 to 31 ms. Replacing the view of the active tab takes about 1 ms; the new view shows its second frame 8 to 15 ms later.
- A view that is no longer attached keeps its history and its form values. Recreating a closed view with `navigationHistory.restore()` takes 24 to 26 ms and keeps the history; form values come back once Chromium has saved the page state, about a second after a change.

## Decision

- **One view per tab.** A tab shows one `WebContentsView` at a time: a web view in the web session without a preload, or for an internal page a view in the internal session whose preload offers only that page's channels, registered with the IPC gate for the page's origin and capability.
- **Switching kinds replaces the view.** When a tab navigates from a web page to an internal page, or between internal pages, a new view of the right kind takes the old one's place and the old view closes. Inside one kind, the view navigates as usual.
- **History across views.** Before a view closes, its entries and position are kept in the tab's view history. Back and Forward first move within the current view; at its first or last entry they recreate the previous or next view from its entries. A navigation to a new page drops the views ahead, as Chromium drops entries ahead.
- **Internal pages that open in tabs** are listed by host in `app/src/shared/internal-pages.ts`; the first is the new tab page, `app://newtab/`. Other hosts, such as `app://shell`, never open in a tab: their URLs load in a web view, where the web session refuses them.
- **Pages never navigate themselves.** An internal page cannot leave its origin, submit forms or open windows. To open a page or a search, it asks the browser process through its bridge, which navigates the tab.

## Consequences

Positive:

- Web pages and internal pages keep their separate sessions, so web content can never reach a preload or an `app://` resource, and no page can reach the channels of another page.
- Only one renderer per tab exists, so internal pages cost no more memory than a web page.
- Back from the first page of a tab returns to the new tab page, as users expect from other browsers.

Negative:

- Going back across a switch reloads the page instead of showing the old view, and form values typed less than a second before the switch are lost.
- A page that played media or held other live state loses it when its tab switches to an internal page.
- Tab state now comes from whichever view is current; events of a view that was replaced are ignored.

## Alternatives considered

- **Keep the old view hidden for Back:** instant, but every tab would hold a second renderer of about 21 to 25 MB for as long as the switch is in its history.
- **Internal pages in the web session:** the web session would have to serve `app://` and give some views a preload, which removes the strict separation of web content and browser UI.
- **Internal pages only in tabs of their own:** simpler, but searching from the new tab page would open a second tab, and Back could not return to the new tab page.
