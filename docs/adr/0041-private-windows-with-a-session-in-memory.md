# 0041. Private windows with a session in memory

## Status

Accepted.

## Date

2026-11-09

## Context

Every browser window kept its pages in the history, its tabs in the session and the data of its sites on disk. People who look something up for someone else, or sign in to a second account for a moment, expect a window that keeps none of that, as other browsers offer.

## Decision

- **A session in memory:** web pages in private windows use a session of their own whose partition has no `persist:` prefix, so cookies, storage and the cache stay in memory. All private windows share it. After the last of them closed, the browser deletes its data, and the next private window gets a new session. The session gets the same guards, request pipeline, content blocker and frame preload as the session of regular windows.
- **Nothing is kept:** private windows record no history, are not part of the session that the next start restores, and keep no zoom of a site. Sites ask for permissions again, and the answers hold only until the last private window closed. Downloads are saved in the downloads folder as usual; the list of downloads shows them in private windows only, does not store them, and cancels those that still run when the last private window closes. Links from other apps never open in private windows.
- **What a page opens stays private:** a tab, window or popup that a page of a private window opens is private as well ([ADR 0040](0040-tabs-and-popups-that-keep-their-opener.md)).
- **Its own look:** the browser's own views in a private window, the shell, the overlay and pages such as the new tab page, use the dark design tokens in both modes, and the toolbar shows a Private badge. The new tab page of a private window tells what the window keeps.
- **Opening one:** `Ctrl+Shift+N` (`Command+Shift+N` on macOS) and New private window in the browser menu. Organizations can turn private windows off with the policy `PrivateModeAvailability` set to `1`.

## Consequences

Positive:

- **Usual behavior:** private windows work as in other browsers, and the regular profile stays as it was.
- **Isolation:** sites in private windows see none of the cookies of regular windows, and the other way round.

Negative:

- **Not anonymous:** sites, the network and the organization still see what a private window loads; the user guide says so.
- **Explicit changes stay:** bookmarks and changes to the settings made in a private window are kept, as in other browsers.
- **Memory:** an emptied session object stays in memory until the browser quits; one is made for each run of private windows.

## Alternatives considered

- **One session for the whole run of the browser:** simpler, but data would survive closing the private windows until the browser quits.
- **A temporary folder on disk:** survives a crash on disk, which is what private windows must avoid.
