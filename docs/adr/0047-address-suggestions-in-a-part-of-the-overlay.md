# 0047. Address suggestions in a part of the overlay

## Status

Accepted. Extends [ADR 0034](0034-overlay-view-for-popovers-and-prompts.md) for the overlay view.

## Date

2026-11-10

## Context

Suggestions below the address bar have to cover the page, which lies above the shell, so they belong in the overlay view. The overlay so far covers the whole window and takes the focus, which suits popovers and questions: a click next to them closes them, and the keyboard reaches their fields. Suggestions are different: typing goes on in the address bar while they show, the arrow keys move through them from there, and a click on the page or the toolbar must work at once.

## Decision

- **A part of the window:** the overlay can open over a given part of the window only, here the list below the address bar with room for its shadow, and then leaves the focus where it is. The rest of the window keeps its clicks, and the overlay closes when the address bar loses the focus, when the active tab changes and when the window changes its size.
- **The shell steers:** the address bar sends the text, its place and the height of a row; the browser process finds the suggestions and shows them in the overlay. The arrow keys, Enter and Escape stay in the address bar, which asks the browser process to mark, open or close a suggestion. A click on a suggestion goes from the overlay to the browser process.
- **Sources:** first what Enter would do, a search or an address, then open tabs, bookmarks and visited pages whose title or address contains every typed word, at most eight, each address once (`app/src/domain/navigation/suggestions.ts`). Visited pages come from the full-text search of the history in the data service.
- **Lazy:** the code loads with the first suggestion, so the start does not read it.

## Consequences

Positive:

- The suggestions lie above the page without a second view and without taking the keyboard from the address bar.
- The page and the toolbar stay usable while the list shows.

Negative:

- The list cannot grow by itself: the shell names the height of a row, and the browser process sizes the view for the number of suggestions.
- Every typed character is a request to the browser process and a search of the history; the browser drops answers that come after a newer request.

## Alternatives considered

- **The list in the shell:** the page lies above the shell, so the list would be hidden below the toolbar.
- **The whole-window overlay with the focus:** typing would have to move to the overlay, and a click on the page would only close the list.
- **A view of its own for the list:** a second transparent view per window for the same job as the overlay.
