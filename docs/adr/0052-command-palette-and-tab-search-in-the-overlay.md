# 0052. Command palette and tab search in the overlay

## Status

Accepted. Extends [ADR 0034](0034-overlay-view-for-popovers-and-prompts.md) and [ADR 0050](0050-browser-menus-and-popovers-in-the-overlay.md). For the palette's own two shortcuts, it departs from the rule of ADR 0034 that a shortcut of the browser closes the overlay and runs. [ADR 0053](0053-sleeping-tabs-and-an-exact-session.md) shows a tab that sleeps in tab search with its icon faded, the tag _Sleeping_ and a description for screen readers.

## Date

2026-11-10

## Context

Until 0.1.0-beta.6, a command could be found only in a menu or by its shortcut, and an open tab only in the tab strip of its own window; the address bar suggests the tabs of its window only. 0.1.0-beta.7 adds many commands, such as those of split view, groups, workspaces and the reader, and more rows of the settings. People expect one field that finds them all, as Ctrl+K and Command+K open in other programs, and a search of the open tabs.

Such a field must lie above web pages, which lie above the shell, so it belongs in the overlay of ADR 0034. Its data lives in two places. The names of the commands and the texts of the rows of the settings are in the catalogs of the browser's pages, which the browser process may not import (the layers of dependency-cruiser), and the settings page already searches them in every shipped language. The open tabs of all windows, the bookmarks, the history and what the address bar would do with a text are in the browser process. Tab ids are unique only within a window. The browser process sees every key before the page, and the palette's code and its overlay page load only when it is first needed, so keys typed right after the shortcut would otherwise reach the page.

## Decision

- **One palette in the overlay:** a new kind of overlay content, `palette`, covers the window and takes the focus. It lies at the top of the area of the pages, which the browser process sends (`BrowserWindowController.contentArea()`): `min(640px, area − 32px)` wide, centred, 32 px below the top, so it sits right for every place of the tab strip and in full screen. It has its own element, `app/src/ui/overlay/command-palette.ts`, with a pure model, `app/src/ui/overlay/palette-model.ts`; `overlay-page.ts` only dispatches to it.
- **Two shortcuts, one palette:** the window commands `palette.open` (`Ctrl+K`, `Cmd+K` on macOS) and `tabs.search` (`Ctrl+Shift+A`, `Shift+Cmd+A`) come after `omnibox.focus` in the catalog. Tab search is the palette in the scope of the open tabs, not a second element. Inside the palette, the shortcut of the scope that shows closes it, and the other one switches the scope and keeps the text, through `keys.onCommand` of ADR 0050; every other shortcut closes the palette and runs, as ADR 0034 says. The menu bar of macOS offers its commands to the popover first (`WindowOverlay.offer`), so that its items toggle in the same way.
- **The search is split by where the data lives:** the overlay's page finds the commands that can run now, by both names of a command (`shortcut.<id>`, also `shortcut.tab.closeBelow`) and by keywords that never show (`palette.keywords.<id>`), and the rows of the settings index (`app/src/ui/ui-kit/settings-index.ts`), in every shipped language, as the settings page does. The browser process answers `overlay.paletteQuery` with the open tabs of the windows of the same kind, the bookmarks, the history and what the address bar would do with the text (`app/src/domain/palette/results.ts`), from the same sources as the suggestions of the address bar. Every word must be in a title or an address, or in a name or its keywords; case, accents and ß do not count. A name that starts with the text comes first, then one where each word starts a word, then the rest, each in the order of its source. An address shows once: an open tab before a bookmark, a bookmark before a visit. With everything, the groups come with at most 6 commands, 5 open tabs, 3 settings, 3 bookmarks, 5 visits and the address or the search last; a scope shows up to 200 tabs, 50 bookmarks, 50 visits and every matching command and setting.
- **The page acts only on what the browser process can check:** a command by its id, which the browser process checks again with `canRun` before it runs it; a row of the settings by its id, which the browser process only puts into `app://settings/#<id>` and which the settings page only looks up; or a place in one of the last four answers of the palette (`overlay.paletteChoose`), because the id of a tab names a tab only in its window. The browser process never takes an address or a tab id from the page.
- **Private and regular windows stay apart:** the tabs, their icons (`overlay.favicon`) and the answers come only from the windows of the same kind as the palette's.
- **Keys typed ahead:** from the shortcut until the palette's page asks for its first results, the window holds the keys typed in the window (`app/src/domain/palette/held-typing.ts`): printable characters, Backspace, which deletes the last of them, Enter, which chooses the first result, and Escape, which cancels. Keys with Ctrl or Command stay shortcuts, apart from AltGr, which Windows reports as Ctrl with Alt. Dead keys and the keys of an input method are never held. New keys are held for 2 s at most; what was held is never dropped, unless a click in the shell after the shortcut opens a tab before the palette is ready, such as on New tab: then the palette does not open, and the keys typed after the click reach the shell, so that they belong to the new tab, as after any click on New tab. The window notes the presses of the pointer in the shell while the hold lasts, so the request of a click before the shortcut that comes late leaves the palette alone (`openTab`). `intercept()` of the window checks the shortcut recorder, then the commands, then the held keys, then Alt alone (ADR 0050). The overlay holds the keys as well while the hold lasts, and an Escape among them closes the palette. The answer to the first request brings what was held, which the field puts before what it holds, also when the answer to a later request, such as of tab search, which reads no history, came first; the page then asks again for the whole text. Enter waits up to 200 ms for the answer for the text.
- **Commands from the menus:** the palette lists every window command that can run now (`availableCommands`), apart from `palette.open`; the commands that only the menus had are window commands since this release, so the palette, the menus and the editor of shortcuts share one catalog, and the commands of later features come in without a change of the palette.
- **What a choice does:** a command runs on the active tab of the window; a tab shows in its window, which comes to the front, out of the dock or the task bar if need be; a bookmark, a visited page, a search or an address opens in a new tab after the active one, or in the tab of the new tab page; a setting opens the settings at its row, also when that row was opened before (`openPage(page, fragment)` and `settings.reveal`). All choices of a tab go through one function, `revealTab`, which workspaces and collapsed groups extend later.
- **Prefixes:** a sign and a space at the start of the field narrow the search: `>` the commands, `%` the tabs, `*` the bookmarks, `^` the history and `#` the settings. The prefix becomes a chip, the placeholder changes, and Backspace in the empty field removes it. On German layouts, `^` is a dead key: `^`, a space and another space.
- **A setting and a policy:** `commandPalette.enabled`, with the policy `CommandPaletteEnabled` as mandatory or recommended policy, turns the palette off at once. Then the table of shortcuts has none for its two commands (`shortcutTable(platform, overrides, without)`), so their keys reach web pages, the browser menu and the View menu of macOS have no items for them, and `canRun` refuses them.
- **Questions of sites:** the palette does not give way to a site's question (`yieldsToQuestions: false`, ADR 0050), and it never takes the place of a question that shows. The questions for permissions, the screen picker and the sign-in prompt take the palette's two shortcuts and do nothing with them (`questionKeys` in `app/src/main/overlays.ts`), from the keys and from the menu bar of macOS (`WindowOverlay.offer`), as closing the question would refuse the site without an answer; every other shortcut closes the question and runs.
- **Closing:** Escape, which the page handles, also while an input method composes text in the field; a click next to the palette; its own shortcut; any other shortcut; and the loss of the focus of its page, as when the window loses the focus. A popover that closes while its window has no focus gives the focus back to the page when the window gets it again (`WindowOverlay.close`), so that the keys reach the page after a switch of windows.
- **Look and motion:** the palette has the look and the motion of every popover of the overlay (`popover-styles.ts`, `popover-motion.ts`, ADR 0050 and ADR 0051); nothing moves with reduced motion, and forced colors give the marked row the system's outline. The field is a combobox, the list a listbox with groups and options, and a status tells the number of results.
- **Lazy:** `app/src/main/palette.ts` and `app/src/domain/palette/results.ts` load with the first shortcut; the first palette of a window makes the overlay's view, as its first popover would. The start-up path gains the two commands, the hold of keys and some wiring. The palette matches words of local data only, and it makes no network request besides the search that people choose.

### Deviations from the design

- The design numbered this decision 0051; ADR 0049 for the logo shifted the numbers.
- The palette enters and leaves with the motion of the popovers of ADR 0050, as the plan of 0.1.0-beta.7 decided, instead of an animation of the style sheet that only enters. Its end-to-end test therefore checks the motion token and the animations that run, as `animation-duration` would read 0 s either way.
- It uses `--surface-raised` and `--line-1` of ADR 0051 instead of `--surface-1` and `--border-1`.
- The content of the palette names the settings that the browser does not offer on this system (`absent`, the core settings without a place on the settings page), so the palette leaves out rows such as Alt opening the menu on macOS. Rows that the value of another setting shows, such as the pages to open at the start, are left out.
- `WindowOverlay.offer()` lets the menu bar of macOS toggle the palette: the menu bar closed every popover before its command ran, so the palette could not hear of its own shortcut there.
- With the tab strip at a side, the name of closing the tabs to the right comes from `shortcut.tab.closeBelow` of the editor of shortcuts, not from a text of the palette of its own.
- `CommandContext` gets `palette`, so that `canRun` gives the palette's commands only while it is on, and the browser menu leaves out their items then, as it leaves out New private window.
- The items `Command palette…` and `Search tabs…` are in the model of the browser menu in the overlay (ADR 0050), which replaced the native menu of the design.
- An Escape among the held keys closes the palette at once, also before its page asks for the keys; the design only noted it.
- The held text is at most 200 UTF-16 code units, as the field and the contract count, and Backspace deletes what a person sees as one character.
- Choosing the command Search the open tabs in the palette switches the scope in the page, instead of closing the palette and opening it again.
- A text of its own, `palette.empty`, says that a scope without text has nothing, such as without bookmarks.
- The group and the workspace of a tab in tab search come with the workspaces. Until then, tab search lists the tabs of each window (`tabs.all`), as there are no strips per workspace (`allTabs()`) yet, and the tag of a tab that sleeps came with the sleeping tabs (`PaletteTab.sleeping`, ADR 0053).
- The design let every shortcut close a site's question; the palette's own two do nothing there, because the palette would take the question's place.
- The design gave the focus back only while the window had it; a palette that closed because its window lost the focus left the window without a focused view after the switch back, which an end-to-end test showed.

## Consequences

Positive:

- One field finds commands, the open tabs of every window, bookmarks, visited pages, an address or a search, and the settings, in English and German, with the keyboard alone.
- Keys typed right after the shortcut are not lost, also while the palette loads for the first time in a window.
- No new view and no new renderer: the palette uses the overlay of the window.
- The palette, the menus and the editor of shortcuts share one catalog of commands and one rule of what can run.

Negative:

- `Ctrl+K` and `Command+K` no longer reach web editors, which use them for links or a quick search, until people give the palette another shortcut or turn it off.
- The first palette of a window waits for the overlay's page, as the first popover does.
- The results do not follow changes while the palette is open; a tab that closed meanwhile shows nothing when chosen.
- A site's question that comes while the palette shows is refused without a question, as while the popover of the star shows, and the site may ask again.
- After a Ctrl+K by mistake, a word meant for the page goes to the palette, and a quick Enter runs its first result; Escape cancels, and keys reach the page again 2 s after the shortcut.

## Alternatives considered

- **The palette in the shell:** web pages lie above the shell and would cover it.
- **A view of its own:** a second renderer for every window.
- **All matching in the browser process:** it may not import the catalogs of the pages, so the texts of the settings would be there twice.
- **All matching in the page:** every bookmark and the whole history would go to the page.
- **The page first for Ctrl+K:** Electron tells of no key that a page did not handle; that would need a channel from web pages, an exception beyond ADR 0028.
- **Modes of the address bar, such as `@tabs` in Chrome:** no commands or settings, and only the tabs of one window.
