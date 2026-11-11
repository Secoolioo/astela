# 0039. Downloads without a question, and a list in the profile

## Status

Accepted. Since 0.1.0-beta.5, the settings `downloads.folder` and `downloads.ask` choose another folder and a question for each file; without them, downloads are saved as this record decides.

## Date

2026-11-09

## Context

Electron asks where to save every download unless the browser chooses a file, and it keeps no list of downloads. The browser had no handler: each download opened the system's save dialog and could not be found again afterwards.

## Decision

- **No question:** downloads of web pages go to the downloads folder of the system. A name that is taken there, also by a download that still runs, gets a number before its extension, such as `report (1).pdf`.
- **A list in the profile:** the list of downloads is a table of `profile.db` in the data service, from schema version 3. It keeps the most recent thousand downloads with their address, file, size and state; downloads that ran when the browser stopped count as interrupted.
- **Panel and button:** a button in the toolbar appears with the first download and shows the progress of the running downloads around its icon. It opens the list in the overlay ([ADR 0034](0034-overlay-view-for-popovers-and-prompts.md)), where a download can be paused, resumed, canceled, opened, shown in its folder, tried again or removed from the list; `Ctrl+J`, or `Command+Option+L` on macOS, opens it too.
- **Loads on demand:** only choosing the file is part of the start; the list, the panel and the button's progress load with the first download or the first opening of the list.

## Consequences

Positive:

- **Usual behavior:** downloads start at once and can be found again, also after a restart.
- **Start-up:** the list costs nothing until the first download.

Negative:

- **Older versions:** a profile that this version migrated opens read-only in an older version, as after every migration (see [data storage](../architecture/data.md)).
- **No choice of folder yet:** the folder and a question for every download come with the settings of `0.1.0-beta.5`, and the policies `DownloadDirectory` and `PromptForDownloadLocation` with them.

## Alternatives considered

- **The system's save dialog for every download:** what Electron does by default; other browsers ask only when the user wants them to.
- **A list in memory:** simpler, but the downloads of a session would be lost with it.
