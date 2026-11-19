# 0058. Layout presets, the toolbar in the row of the tabs and top rows that hide

## Status

Accepted. Amends [ADR 0048](0048-title-bar-drawn-by-the-browser.md): with the toolbar in the row of the tabs, that one row is the top row and the title bar, as high as the toolbar; rows that hide keep an edge or a title row of the shell, which moves no window. Amends [ADR 0034](0034-overlay-view-for-popovers-and-prompts.md) and [ADR 0002](0002-electron-and-webcontentsview.md): apart from the overlay, the shell may lie above the pages, cut to the height of its rows, while rows that hide show over them. [ADR 0050](0050-browser-menus-and-popovers-in-the-overlay.md) stays as it is; its popovers, and the native menus of the shell, hold rows that hide open. Built in 0.1.0-beta.7.

## Date

2026-11-12

## Context

The roadmap promises layout presets for 0.1.0-beta.7, among them a compact layout and a zen layout. Until now, the tabs at the top and the toolbar take two rows, and the only choices are the place of the tabs and the density.

- [ADR 0048](0048-title-bar-drawn-by-the-browser.md) makes the top row the title bar: the row of the tabs with the tabs at the top, the toolbar otherwise. On Windows and Linux, Chromium draws the window controls over it (the Window Controls Overlay); `setTitleBarOverlay` changes their color, the color of their symbols and their height, but cannot hide them. On macOS, the three buttons of the window can be hidden (`setWindowButtonVisibility`) and placed (`setWindowButtonPosition`). A region that moves the window wins over the views above it.
- [ADR 0002](0002-electron-and-webcontentsview.md) and [ADR 0034](0034-overlay-view-for-popovers-and-prompts.md) rest on this: the views of web pages lie above the shell, so nothing that the shell draws covers a page, and only the overlay covers pages. Rows that hide and show over the page without moving it need the shell above the page. The overlay cannot take the rows: typing, the suggestions and the regions that move the window live in the shell ([ADR 0047](0047-address-suggestions-in-a-part-of-the-overlay.md)).
- In Electron 45, `addChildView()` of a view that the window holds already moves it to the top, whatever index it gets.
- A probe on Linux with X11 under Xvfb moved the pointer of the X server with `xdotool` over the shell ([Validation](../architecture/validation.md#layouts-and-rows-that-hide)): over a region that moves the window, the shell gets `pointerleave` and no more events of the pointer, as if the pointer had left it; over a tab again, `pointerenter`. Input events that tests send to a view (`sendInputEvent`, Playwright) skip that hit test.

## Decision

### Two settings, four presets

- **The address bar in the row of the tabs:** `toolbar.placement`, `own-row` (the default) or `tab-row`, with the policy `ToolbarPlacement`, which may also recommend. **Rows that hide:** `toolbar.autoHide`, off by default, with the policy `AutoHideToolbar`, which may also recommend. Both apply only with the tabs at the top; with the tabs elsewhere, their rows on the settings page are disabled and say _Needs the tabs at the top_. The command **Turn hiding the toolbar on or off** (`toolbar.toggleAutoHide`) follows **Show bookmarks bar** and has no shortcut at first; it can run only with the tabs at the top and without a mandatory policy.
- **Presets:** Classic (tabs at the top, the toolbar in its own row, nothing hides, normal density), Compact (the one row, compact density), Zen (the one row, which hides, normal density) and Vertical (the tabs at the left, the toolbar in its own row). A preset is no setting: it sets four settings at once, and the pages recognize it by their values (`presetOf()` in `app/src/shared/layout-presets.ts`), so people can change each of them afterwards; with other values, no preset is checked and the page says _Your own arrangement_. `settings.applyLayoutPreset` sets the four values with one `SettingsService.setMany()`, one change event and one save; it leaves out the settings that a mandatory policy sets and names them in its answer. A card whose preset would change such a setting is disabled and says _Managed by your organization_. No preset touches the title bar, which takes effect only after a restart.
- **Where:** the settings page has the row **Layout** before **Density**, with a card and a small window for each preset (`app/src/ui/ui-kit/layout-previews.ts`), and the rows **Address bar** and **Hide the tabs and the toolbar until you need them** after **Tabs**. The layout step of the setup guide shows the four cards and the switch of the bookmarks bar.

### The one row

- `app/src/domain/windows/title-bar.ts` takes where the tabs and the toolbar are (`{ side, toolbar }`): with the toolbar in the row of the tabs, the top row is as high as the toolbar, 32, 40 or 48 px; the window controls of Windows and Linux get that height, and the three buttons of macOS lie in its middle (`windowButtonsAt()`: 9, 13 and 17 px from the top). A new window places its page below that row until the shell reports its content area.
- The shell puts the toolbar first and the tabs after it into one row of its grid, and the menu button follows **New tab**. The toolbar takes 42 % of the width, but never less than its buttons, such as those of the reader view and of picture in picture, and an address bar of 96 px. The tabs never get less than their buttons, the free room that moves the window, the room of the window controls and two narrow tabs. `ShellState.layout` tells the shell where the toolbar is.
- **A narrow window:** when the window is too narrow for both, the tabs go into a row of their own above the toolbar, as high as the one row, and the window controls stay in it; the page starts below both rows. The shell decides this by itself (`data-narrow`): it lays out the one row, and keeps it only while the tabs end within the window, before the window draws. The room that the toolbar needs changes with its buttons, and the room of the controls with the system, so no fixed width would do.

### Rows that hide

- **Where:** only with the tabs at the top, and never in a popup, which shows its address as its page expects. Over a page in full screen, nothing shows them.
- **What stays:** an edge of 2 px at the compact density and 4 px otherwise, on macOS, with the title bar of the system and in full screen; on Windows and Linux with the browser's title bar, a title row as high as the top row, where Chromium draws the window controls, with the icon of the connection, the site and the title of the page. On macOS, the three buttons of the window hide with the rows, and show with them in their row again; in full screen, macOS shows them itself.
- **Hidden:** the page lies right below what stays (`pageArea()`); the rows below the page take no clicks and move no window (`pointer-events: none`, `-webkit-app-region: no-drag`), as the region of a view below would win over the page.
- **Shown:** the browser moves the shell, which is opaque, above the pages and cuts it to the height of its rows; it shrinks the shell before it moves it up, and lets it grow only once it lies below the pages again (`app/src/platform/electron/hiding-rows.ts`). The page neither moves nor changes its size. A page that the window attaches meanwhile goes below the shell, and the overlay stays above both. Rows that are no higher than what stays of them show without the move, as the page lies below them anyway.
- **Hiding again:** a change of the rows reaches the shell at once, not with the next state of the window. The shell goes below the pages only once it drew the rows hidden: below the page, the regions of rows that show would move the window from the top of the page. The shell tells it with `shell.holdTopRows` (`hidden`) in the frame after the one that drew them, as Chromium sends the regions with a frame; without a word from the shell, as while its window is minimized, the browser lowers it after 250 ms.
- **What shows them:** the pointer on what stays, at once on the edge and after 300 ms on the title row, which the pointer crosses on its way to the window controls; the pointer over the rows, until 400 ms after it left them; the focus in a control of the rows while the shell has the focus of the window, as after `Ctrl+L`, `Alt+D` and `F6`: a field, or a control that the keyboard focused (`:focus-visible`), but not a button that a click focused, such as the one of picture in picture, which Chromium focuses on a click; the find bar; a popover of a button of the shell in the overlay, such as the browser menu after `F10` or `Alt` alone, the star, the shield, the downloads, the workspaces and the popover of a group (`ShellState.popover`, which gets the kind `group`), but not the command palette, which opens in the middle of the window; the menu of a tab and the context menu of the shell; and for 1.5 s when the visible tab changes or its page shows another site. The shell tells the browser about the pointer and the focus (`shell.holdTopRows`); the browser counts the focus only while the shell's view has the focus of the window.
- **What stays takes the pointer:** it moves no window, as a region that moves the window gets no events of the pointer and would never show the rows. The free room of the rows that show moves the window. Over it, the shell loses the pointer; the browser then asks the system where the pointer is (`screen.getCursorScreenPoint()`), every 200 ms and for at most 10 s, and keeps the rows while the pointer is over them.
- **No trapped keys:** when the focus leaves the controls of the rows while the shell keeps the focus of the window, the page gets it, and the rows hide. So it does when the rows hide while the shell has the focus of the window but none of its controls has it, as after a click on the title row, the edge or the icon of the connection, which give the shell the focus. In the address bar, `Escape` brings back the address of the page, and a second `Escape` gives the page the keys.
- **Loading:** the code loads with the first window while the setting is on, or once it is turned on.

### What guards against a page that pretends to be another

While the rows hide, the address does not show. The title row of Windows and Linux shows the connection and the site next to the title, which the page sets itself. It names a site for every web page (`app/src/ui/shell/site-label.ts`): the host of a web page with its port; the host of the page that made a `blob:` or `filesystem:` address; `about:blank` for an empty page, which the page that opened it can fill; and the scheme of any other address, such as `file:` or `data:`, with a neutral icon where the connection has none. Only the browser's own pages name none, as their titles name them. The rows show for 1.5 s when the tab or the site changes; a popup never hides its rows; a page that does not cover the content area, such as a problem of the tab, shows them; and the questions for permissions name the site.

### The presets on each system

| Preset   | macOS, the browser's title bar                                                            | Windows and Linux, the browser's title bar                                   | The title bar of the system                                      |
| -------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Classic  | Buttons in the row of the tabs, 36 px, at 11 px                                           | Controls of 36 px in the color of the window                                 | Rows as always below the system's bar                            |
| Compact  | Buttons in the one row of 32 px, at 9 px                                                  | Controls of 32 px in the color of the window                                 | One row below the system's bar                                   |
| Zen      | Edge of 4 px, buttons hidden; with the rows, the buttons in the one row of 40 px at 13 px | Title row of 40 px with the controls, the connection, the site and the title | Edge of 4 px below the system's bar; the rows show over the page |
| Vertical | Buttons in the toolbar, 40 px, at 13 px                                                   | Controls of 40 px in the color of the toolbar                                | Rows as always below the system's bar                            |

In full screen, Zen keeps an edge on every system. A density changes the heights as the one row does.

### Confirmed on Linux, open on the other systems

On Linux with X11 under Xvfb, the end-to-end tests (`layouts.spec.ts`) check the one row and its narrow window, the heights of the controls, the move of the shell, its bounds, the page that keeps its place and size, the regions and clicks, the order in which the shell goes below the page, every hold, the keys after a click on the rows, the site of the title row, a split view below hidden rows, the popup, the presets and the setup guide, and the probe checked the pointer of the X server. Only the CI runners of Windows and macOS, or a check by hand, can confirm: the height of the controls that Windows draws for the one row and their color (the first test reads the title bar area of the Window Controls Overlay on every runner); on macOS, the place of the three buttons after `setWindowButtonVisibility()` (the first two tests read the place and record the calls) and that the menu bar of a native full screen lies over rows that show; that the strip at the top of a window on Windows that is not maximized, where the system resizes the window, leaves enough of the title row for the pointer; that `getCursorScreenPoint()` and the content bounds share their coordinates on both; and the policy tests of the presets and of the command, which run only on CI. The checks of the three buttons of macOS in the tests of rows that hide ran on Linux only, where they are left out; they record the buttons from the moment the rows hid after the new site. Wayland needs a check by hand: the system may not tell the browser where its pointer is, so the rows may stay for up to 10 s after the pointer left them over their free room.

### Deviations from the design

- The design numbered this record 0049, and the plan 0056; the records that came first took those numbers.
- The presets live in `app/src/shared/layout-presets.ts`, not in `app/src/shared/layout.ts`, which the start of the browser reads; only `toolbarPlacements` went there.
- The design keeps a quiet title row with the host and drops `input-event` with `getCursorScreenPoint()` because they need polling and fail on Wayland. The probe showed that a region that moves the window takes the pointer from the shell, so the title row moves no window, and the browser asks the system where the pointer is only while the shell lost it over rows that show, for at most 10 s. Without that, the rows would hide under a pointer that rests on their free room.
- The pointer that reaches rows that show for another reason, such as the moment after another site, holds them too.
- The shell tells only whether a control of it has the focus, and the browser checks that the shell's view has the focus of the window and listens to its `focus` and `blur`: Playwright makes `document.hasFocus()` of the page that it drives true, also after `Emulation.setFocusEmulationEnabled`.
- The menu of a tab and the context menu of the shell hold the rows through `window.rows?.menu()`, not a method of the window that opens menus, and the window keeps only small hooks (`rows`, `pageArea()`, `layout()`, `attachPage()`, `state()`, `publish()` of the code that loads later): the start path of the browser process had 1.5 KiB for this part. It grew by 1,741 bytes, from 146,963 to 148,704 bytes, 30 of them for the fixes after the review; the rest loads later.
- The design gives the address column at least 240 px. Next to the tabs, whose buttons and the room of the window controls never shrink, a window of 480 px would then have no room left for a tab, and the buttons after the tabs would lie under the window controls. The toolbar and the tabs both keep what they need, and a window too narrow for both puts the tabs in a row of their own.
- The design asks for the state at once when the rows change; the shell also has to draw the rows hidden before it goes below the pages, so it tells the browser when it did, which the design did not have.
- The end-to-end test gives the command `F8`, as the reader view has `F9`. The setup guide test chooses the card Vertical instead of the choices Left and Compact, and the density tests of the settings page and the tab strip find the density's radio buttons in their group, as a card is named Compact as well.
- A click on a card checks it at once; the cards follow the settings with `live()` once they change, and show them again when the browser refused the preset.

## Consequences

Positive:

- Four layouts in one click, which people can change afterwards, also in the setup guide.
- The page gets the row of the toolbar in Compact and almost the whole window in Zen, and rows that show over it neither move it nor change its size.
- The keys never get stuck in hidden rows, and every shortcut that reaches a control of the rows shows them.

Negative:

- On Windows and Linux with the browser's title bar, Zen keeps a title row, as Chromium's window controls cannot hide.
- While the rows hide, what stays of them does not move the window; the free room of the rows that show does.
- Rows that hide need the tabs at the top.
- While the shell lost the pointer over rows that show, the browser asks the system five times a second where the pointer is, for at most 10 s.
- In Zen, the address does not show; the title row, the moment after another site and the questions name the site instead.

## Alternatives considered

- **The page moves down while the rows show:** it changes its size and its content jumps.
- **A transparent shell above the page:** it renders black on Wayland ([ADR 0002](0002-electron-and-webcontentsview.md)) and takes the page's clicks.
- **`input-event` of the pages with `getCursorScreenPoint()` to show the rows:** it asks all the time while the rows hide, its typings have no coordinates, and Wayland may not tell where the pointer is. The browser asks only while the shell lost the pointer over rows that show.
- **A title row that moves the window:** the pointer would never show the rows from it.
- **Rows that show without regions that move the window:** the window could not be moved in Zen.
- **A second view for the toolbar:** the controls of the toolbar twice.
- **The overlay for the rows:** typing, the suggestions and the regions that move the window live in the shell.
