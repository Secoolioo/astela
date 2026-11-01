# 0029. Import from other browsers in the data service

## Status

Accepted

## Date

2026-11-01

## Context

People who switch browsers want their bookmarks, history and open tabs to come along, ideally with one click and also from the setup guide. Chromium-based browsers (Chrome, Edge, Brave, Vivaldi, Opera, Chromium) keep bookmarks in a JSON file and the history in SQLite; Firefox-based browsers (Firefox, Zen, LibreWolf, Floorp, Waterfox) keep both in `places.sqlite` and their open tabs in `mozLz4`-compressed session files. A browser that is running keeps its databases open. Reading SQLite blocks, and the browser process must never block ([ADR 0009](0009-storage-with-node-sqlite.md)).

## Decision

- **Where:** the import runs in the data service (`app/src/platform/import/`), next to `profile.db`. The browser process only passes calls on, opens imported tabs and updates the shells.
- **Finding browsers:** the import looks only in the folders where the supported browsers keep their profiles on each system, including the Flatpak and Snap folders on Linux, and lists the profiles that their `Local State` or `profiles.ini` names. A page refers to a profile only by the id that this search returned, so no page can make the import read any other file.
- **Reading:** databases are copied, with their write-ahead log, to a temporary folder and read there, so a running browser keeps working and its files are never written. Each kind of data is read on its own; what cannot be read is reported, and the rest is imported.
- **What:** bookmarks go into a folder of the other bookmarks named after the browser; a later import of the same browser replaces that folder. History merges by address and keeps the newer visit and the higher count, so importing again changes nothing. Open tabs come from Firefox-based browsers and open in new windows, where only the active tab loads. Chromium's session files are not read yet. Cookies and passwords are never imported; passwords follow with the password manager.
- **Limits:** at most 100,000 pages of history and 500 tabs, and only `http` and `https` addresses.
- **Policy:** `ImportEnabled` set to `false` as a mandatory policy hides the import and refuses it.

## Consequences

Positive:

- One click imports from every supported browser on all three systems, while the other browser keeps running.
- Importing twice does not duplicate bookmarks or history.

Negative:

- A browser that holds its database exclusively, such as Chrome on Windows, may have to be closed before its history can be read; the page says so.
- Open tabs of Chromium-based browsers are not imported yet.
