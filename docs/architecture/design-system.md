# Design system

> **Status:** partly implemented. The first design tokens exist; the rest of this page is design. See [implementation status](#implementation-status).

The design system keeps every surface of Astela consistent, readable and calm. It consists of the design rules below, a small set of design tokens, fixed scales and automated checks that CI runs.

The decisions behind it are recorded in ADR 0013 (theme system and design tokens) and ADR 0024 (icons and typography). See the [decision records](../adr/README.md). Themes, which override tokens, are described in [Settings, policies and themes](settings-policy-theme.md). The calm, distraction-free character of the UI follows from the [principles](principles.md).

## Design rules

Astela should look like carefully made desktop software, not like a template. These rules apply to the browser UI, the internal pages, the website, the README and the brand assets. The logo and the application icon are the only exceptions: they keep their gradient, their glow and their star ([ADR 0049](../adr/0049-logo-and-colors-of-the-brand.md)).

- **Shape:** corner radii come in four steps: 6 px for small parts, 8 px for controls, 12 px for surfaces that float or group content, and 10 px for the address bar and search fields. Only switches, badges and progress bars have round ends; there are no pill-shaped buttons.
- **Color:** flat, restrained colors with one accent color and a second color for progress. There are no gradients in the browser, its pages, the website, page headers or text. The default accent is the violet of the logo, and progress takes its blue.
- **Depth:** 1 px lines and differences in surface color separate areas. Menus and popovers that float above the page have one soft shadow; nothing else casts a shadow. There are no glow or neon effects and no glass or blur effects.
- **Hierarchy:** comes from typography (size, weight and spacing), not from effects. Sizes and spacing follow a dense 4 px grid, with 8 px steps for larger gaps.
- **Icons:** one icon set with one stroke width. There are no emojis, no sparkle symbols, and no decorative blobs or generic illustrations.
- **Platform:** the native window controls, context menus, the menu of a tab, the menu bar of macOS and the shortcuts of each operating system are respected. The browser menu and the folders of the bookmarks bar are the browser's own popovers on every system and keep the keyboard conventions of the systems: F10 and Alt alone on Windows and Linux, access keys, letters that move to an item, and Escape ([ADR 0050](../adr/0050-browser-menus-and-popovers-in-the-overlay.md)).
- **Motion:** only where it helps to follow a change, from 60 to 220 ms long, and off when the system asks for reduced motion. Only loading indicators repeat their motion, with one turn of 1 s ([ADR 0046](../adr/0046-motion-rounder-shapes-and-one-shadow.md)).
- **Website:** no standard landing page layout (a centered hero with gradient text above a grid of icon cards). It shows real screenshots of the browser, never mockups.
- **Writing:** factual and brief. No marketing phrases, no emoji lists, and dashes only where a sentence needs them.

## Design tokens

Design tokens are the only source for colors, spacing, radii, borders, shadows and motion. They live in the UI kit (`app/src/ui/ui-kit/tokens`) and reach every surface as CSS custom properties: the shell, the overlay and the internal pages.

- Components use tokens and contain no hard-coded colors, sizes, durations, easings or shadows. `pnpm verify` checks a part of this rule with `tools/design/check-tokens.ts`: it fails when a transition or an animation writes out a duration or an easing, when code gives `duration`, `delay` or `endDelay` as a number or writes out an easing, as in the options of `animate()`, and when a `box-shadow` is neither the shadow token nor a ring of 1 or 2 px in a color token. A value counts also when it continues on a later line than its property name. The check does not see colors and sizes, or durations and easings that code computes or keeps in a constant or a custom property of its own ([ADR 0046](../adr/0046-motion-rounder-shapes-and-one-shadow.md)).
- Themes override tokens and nothing else. A theme can never restyle a component directly.
- Density and typography are settings that act through tokens.

## Color

All colors are defined in OKLCH. The palette consists of:

- an accent color,
- neutral grays in 11 steps,
- status colors.

The accent and the second color come from the logo ([ADR 0049](../adr/0049-logo-and-colors-of-the-brand.md)): the violet `oklch(55% 0.24 290)` in light mode and `oklch(72% 0.157 290)` in dark mode, and the blue `oklch(55% 0.18 265)` and `oklch(72% 0.145 265)` for progress. Hover, pressed and disabled states are not defined by hand; the theme engine derives them in OKLCH from the base tokens.

The surfaces of each mode rise from the window (`--surface-0`) to the panels and the toolbar (`--surface-1`), the fields (`--surface-2`) and the color under the pointer (`--surface-hover`); the lines (`--border-1`) lie above them. In dark mode, every built-in theme but True Dark steps evenly, by 3.5 % lightness ([ADR 0051](../adr/0051-calmer-dark-mode-mixed-from-the-palette.md)). Two more tokens are mixed from the palette in `tokens.css` with `color-mix()`, so every theme, the custom one included, has them:

| Token              | Light mode    | Dark mode and private windows                       | Used for                                                                                 |
| ------------------ | ------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `--line-1`         | `--border-1`  | `--border-1` at 60 %, over the surface below it     | Lines that separate areas, and the outlines of panels, popovers, suggestions and dialogs |
| `--surface-raised` | `--surface-1` | Half a step between `--surface-1` and `--surface-2` | Popovers, suggestions and dialogs, which float above the panels                          |

The outlines of controls, such as fields, buttons, segmented controls and cards that are chosen like radio buttons, keep `--border-1`. In a list on the raised surface, such as the address suggestions and the results of the command palette, the row that the arrow keys mark carries a bar in the accent at its start, above `--surface-hover`, as the step between the two surfaces stays far below 3:1; with forced colors, the bar has the system's highlight color, and the marked row of the palette, whose focus stays in its field, also gets a 2 px outline in it. Pictures that show the colors of both modes at once, such as the window previews of the setup guide, take Astela's palette from `builtInThemes` and the opacity of the line from `lineOpacity` in `app/src/shared/themes.ts`. The danger color is `oklch(52% 0.19 25)` in light mode and `oklch(72% 0.15 25)` in dark mode (`statusColors` in `app/src/shared/themes.ts`).

Every text and UI color pair has to meet these contrast minimums, in line with WCAG 2.2 AA:

| Element                        | Minimum contrast |
| ------------------------------ | ---------------- |
| Text                           | 4.5:1            |
| UI components and their states | 3:1              |

The built-in themes, Astela, Paper, Forest, Ocean, Slate and True Dark, each with a light and a dark mode, meet these minimums, which a unit test checks for the text of every theme on every surface ([ADR 0043](../adr/0043-themes-as-palettes-edited-on-the-settings-page.md)). For the dark mode, unit tests also check that the surfaces step evenly, that the color under the pointer lies a step above the raised surface, that no surface is lighter than the one that the accent is solved against, and that the danger color and every accent preset reach 4.5:1 on every surface; every accent preset also reaches 3:1 on the color under the pointer in both modes, for the bar of the marked row, and another test checks that `tokens.css` holds the colors of `themes.ts` ([ADR 0051](../adr/0051-calmer-dark-mode-mixed-from-the-palette.md)). The settings page warns live when a custom theme falls below them. The UI is also designed to stay usable in Forced Colors mode, which is part of the accessibility baseline.

## Density

Astela offers three density levels. Density is a setting; it sets the heights of the toolbar, the tabs, the controls and the rows of lists, and the steps of spacing, in the shell, the overlay and the browser's own pages ([ADR 0042](../adr/0042-density-and-text-size-scale-the-whole-interface.md)).

| Density     | Toolbar | Tab   | Controls (small, regular, large) | Row   | Spacing steps `--space-1` to `--space-7` |
| ----------- | ------- | ----- | -------------------------------- | ----- | ---------------------------------------- |
| Compact     | 32 px   | 28 px | 24, 24, 28 px                    | 40 px | 2, 4, 8, 12, 16, 24, 32 px               |
| Normal      | 40 px   | 32 px | 24, 28, 32 px                    | 48 px | 4, 8, 12, 16, 24, 32, 48 px              |
| Comfortable | 48 px   | 40 px | 28, 32, 40 px                    | 56 px | 4, 12, 16, 20, 32, 40, 56 px             |

Sizes follow the 4 px grid; only the smallest step of the compact density is 2 px. At every density, click targets are at least 24 × 24 px, as required by WCAG 2.2.

## Typography

The UI uses the system font stack. It costs no download size and looks native on every platform.

| Platform | UI font             |
| -------- | ------------------- |
| Windows  | Segoe UI Variable   |
| macOS    | SF Pro              |
| Linux    | Cantarell or Ubuntu |
| Fallback | `system-ui`         |

The font of the UI is a setting: the name of an installed font, or empty for the system font stack above. The text size is a setting too, independent of the density; it sets a scale of font sizes and line heights in px:

| Text size | Tiny | Small | UI  | Large | Larger | Title | Display | Line heights       |
| --------- | ---- | ----- | --- | ----- | ------ | ----- | ------- | ------------------ |
| Small     | 10   | 11    | 12  | 13    | 15     | 18    | 24      | 16, 20, 20, 24, 32 |
| Medium    | 11   | 12    | 13  | 14    | 16     | 20    | 28      | 16, 20, 24, 28, 36 |
| Large     | 12   | 13    | 14  | 15    | 17     | 22    | 30      | 20, 20, 24, 28, 36 |
| Larger    | 13   | 14    | 16  | 17    | 19     | 24    | 32      | 20, 24, 24, 32, 40 |

Medium is the default. The line heights belong to the UI, Large, Larger, Title and Display text. The default fonts and the text size of web pages are separate settings, which new tabs get as web preferences. The website shows its name as text in the system font next to the application icon and loads no web font.

## Icons

- UI icons come from Lucide, which is published under the ISC license (as of October 2026).
- Icons are used at 16 and 20 px with a 1.5 px stroke.
- Only the icons the UI actually uses are bundled.
- The logo and the app icon are Astela's own. No third-party marks are used.

## Shape and depth

| Token            | Value | Used for                                               |
| ---------------- | ----- | ------------------------------------------------------ |
| `--radius-1`     | 6 px  | Small parts: icon buttons, chips, check boxes          |
| `--radius-2`     | 8 px  | Controls: buttons, inputs, tabs, rows of lists         |
| `--radius-3`     | 12 px | Floating and grouping surfaces: menus, popovers, tiles |
| `--radius-field` | 10 px | The address bar and search fields                      |
| `--radius-pill`  | round | Switches, badges and progress bars only                |

Menus and popovers that float above the page have the one shadow, `--shadow-popover`, which is darker in dark mode. Focus rings of 1 or 2 px are no shadows of depth. An item of a menu of the overlay that turns something on and off, such as the reader view or picture in picture in the browser menu, shows Lucide's check in the place of its icon while it is on, and is a `menuitemcheckbox` for screen readers. Every popover of the overlay takes its radius, shadow, surface and line from `app/src/ui/ui-kit/popover-styles.ts`, and one module places it at its button (`app/src/ui/overlay/placement.ts`): below the button, lined up with the end of a button in the right half of the window and with its start otherwise, while the menus of the folders of the bookmarks bar line up with the start of their button; above it without room below, and scrolling inside when it fits on neither side.

## Motion

| Token              | Duration | Used for                                      |
| ------------------ | -------- | --------------------------------------------- |
| `--motion-instant` | 60 ms    | Hover and press                               |
| `--motion-fast`    | 120 ms   | Small changes, such as a check mark           |
| `--motion-base`    | 180 ms   | Things that open, close or move, such as tabs |
| `--motion-slow`    | 220 ms   | Larger movements, such as a sliding indicator |
| `--motion-enter`   | 140 ms   | Popovers and menus of the overlay that open   |
| `--motion-exit`    | 100 ms   | Popovers and menus of the overlay that close  |
| `--motion-loop`    | 1 s      | One turn of a loading indicator               |

- Things that enter use `--ease-out`, things that leave `--ease-in`, and movements `--ease-standard`. A loading indicator repeats one turn of `--motion-loop`; one that turns at an even speed, such as the loading ring of a tab, uses `--ease-linear`.
- Animations use only `transform`, `opacity` and colors, so they never trigger layout.
- The buttons of the reader view and of picture in picture fade in over `--motion-fast` with `--ease-out` once the page turns out to have an article, or a video that plays, by their opacity alone; the reader view itself has no motion. Pressed, their icons take `--accent`, as the star of a bookmark does; the icon of picture in picture is Lucide's picture-in-picture-2.
- Popovers of the overlay fade in and move the last 4 px away from their button over `--motion-enter` with `--ease-out`, and fade out and move 2 px towards it over `--motion-exit` with `--ease-in`; questions in the middle of the window only fade. The overlay leaves the window once the popover has left (`app/src/ui/overlay/popover-motion.ts`, [ADR 0050](../adr/0050-browser-menus-and-popovers-in-the-overlay.md)).
- When the system requests reduced motion (`prefers-reduced-motion`), every duration is 0, so nothing moves. `tools/design/check-tokens.ts` checks that the block for reduced motion of `tokens.css` sets every motion token to 0.
- Code that animates from JavaScript reads its duration and easing from the tokens with `motionOf` and `easingOf` (`app/src/ui/ui-kit/motion.ts`), so it stops with reduced motion as well.
- No timers run while the browser is idle, which keeps idle CPU within its budget (see [Performance](performance.md)).

## Layouts

### Tab bar positions

The tab bar can sit on any of the four sides of the window. Each position has a reference layout that defines how the shell arranges itself around the web content:

| Position | Orientation | Reference layout                                                                                  |
| -------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Top      | Horizontal  | Tab bar at the top of the window, above the web content. This is the default for `tabs.position`. |
| Bottom   | Horizontal  | Tab bar at the bottom of the window, below the web content.                                       |
| Left     | Vertical    | Tab bar along the left edge, with a collapsible width.                                            |
| Right    | Vertical    | Tab bar along the right edge, with a collapsible width.                                           |

The layout manager computes the bounds of the web content from the tab bar position, the sidebar, the density, compact mode and full screen; the shell reports its insets to it. Changing the position is designed to apply live, without a restart.

In every position, the tab bar is designed to be fully operable by keyboard, and F6 cycles focus from the toolbar to the tabs to the content.

### Split view

A window can show two tabs side by side ([ADR 0054](../adr/0054-split-view-with-two-tabs-side-by-side.md)). The sizes are layout widths in `app/src/shared/split-view.ts`, which the browser process and the shell share, and the density does not scale them:

| Part                               | Size                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Divider between the sides          | 8 px, over the whole height; its grip is 2 px wide and `--control-large` high                  |
| Line above the side with the focus | 2 px in `--focus-ring`, nothing above the other side                                           |
| Each side                          | at least 200 px while the content area has room, else half of it                               |
| Share of the left side             | 20 to 80 % of the width without the divider, 50 % for a new split view, steps of 5 % with keys |

Hover, focus and a drag tint the grip with `--accent` and the divider with `--surface-hover`, over `--motion-instant`; the line changes its color over `--motion-fast`. With forced colors, the line is `Highlight` and the grip `CanvasText`. In the tab strip, the two tabs of a pair stand together without the gap between them, rounded at their outer corners, and the tab of the pair that does not have the surface of the active tab lies on `--surface-2`. The find bar ends where the side with the focus ends; a left side narrower than the bar's controls leaves them at the start of the window, and the bar is never wider than the window.

### Tab groups

Groups of tabs take one of six colors, the accent presets other than Astela's own, as the tokens `--swatch-blue`, `--swatch-teal`, `--swatch-green`, `--swatch-orange`, `--swatch-red` and `--swatch-graphite` of `tokens.css`, with the values of `presetAccentColors` for the light mode, and for the dark mode and private windows. Every theme keeps them; a unit test checks that they match the presets and stand out by 3:1 from every surface of every built-in theme in both modes ([ADR 0055](../adr/0055-tab-groups-and-workspaces-in-the-tab-model.md)).

| Part                  | Look                                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chip before the group | `--control-small` high, at most 120 px wide with an ellipsis, `--radius-1`, a dot of 8 px in the group's color and the name in `--font-size-small`, `--surface-hover` under the pointer |
| Chip at a side        | a row of the list, `--control-height` high and as wide as a tab, with a chevron that turns over `--motion-fast` while the group hides its tabs                                          |
| Line of a grouped tab | a border of 2 px in the group's color on the edge that faces the page: bottom with the strip at the top, top with the strip at the bottom, start at a side                              |
| Grouped tab at a side | indented by `--space-3`, its start corners square                                                                                                                                       |
| Collapsed chip        | the number of its tabs after the name, in `--text-2`                                                                                                                                    |
| Popover of a group    | 288 px wide on `--surface-raised`, the color as round swatches of `--control-height` with a ring of 2 px around the one chosen                                                          |

The line is a border, so forced colors keep it; there the dot and the swatches get a ring in `CanvasText`, and the chip that a dragged tab would join an outline in `Highlight`. A chip whose group a dragged tab would join lies on `--surface-hover`. The tabs of a group fade out when it collapses and grow in when it opens, with the motion of tabs that close and open, which reduced motion turns off.

### Workspaces

Workspaces take the same six colors, and one of 16 icons of Lucide's set, drawn with the stroke of the other icons (`app/src/ui/ui-kit/workspace-icons.ts`).

| Part                      | Look                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Button of the workspaces  | the first item of the tab strip, an icon button of `--control-height` with the icon in the workspace's color; at a side a full row with the name after it                            |
| List of the workspaces    | a popover of 320 px on `--surface-raised`, at the start of its button; rows of `--row-height`, the shown one on `--surface-2`, the details in `--text-2`                             |
| Workspace of its own data | a badge with a line of `--line-1` and `--radius-1`, its text in `--font-size-small` and `--text-2`                                                                                   |
| Targets of a dragged tab  | a row of targets of `--control-height` next to the button, a column at a side, on `--surface-raised` with `--shadow-popover`; the one under the pointer has `--accent` as its border |

The targets fade in over `--motion-fast`, by their opacity alone; with forced colors, the target under the pointer gets an outline in `Highlight`.

### Reader view

The [reader view](../user/page-tools.md#reader-view) shows an article in a document of its own, which loads nothing of the browser: `app/src/domain/reader/document.ts` writes the tokens that it needs into it as values ([ADR 0057](../adr/0057-reader-view-and-picture-in-picture-in-isolated-worlds.md)).

| Part     | Look                                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column   | at most 42 em wide in the middle, with 3 rem of room above it, 4 rem below it and 1.5 rem at its sides                                                           |
| Text     | 1.125 rem with a line height of 1.6, in the font of the browser or the serif font of web pages (setting `reader.font`), at the text size of web pages            |
| Header   | the name of the site above the title in 2.25 rem, and who wrote it, the date and the reading time below it, in 0.875 rem and `--text-2`                          |
| Headings | 1.5, 1.25 and 1.125 rem, with more room above than below                                                                                                         |
| Colors   | `--surface-1` and `--text-1`, `--text-2` for captions and quotes, `--surface-2` under code and the heads of tables, `--accent` for links                         |
| Lines    | rules, the cells of tables and the bar at the start of a quote in `--line-1`, which the document mixes from `--border-1` with `lineOpacity` as `tokens.css` does |
| Corners  | `--radius-1` for code, `--radius-2` for pictures                                                                                                                 |

The palette is that of the theme in light and dark mode, and only the dark one in a private window. The sizes and the spacing are in `rem` and `em`, outside the 4 px grid of the browser's own views: the zoom of the reader view sets the size of its root font, in the steps of page zoom, and the whole document grows with it. The document has no motion, prints black text on white with gray lines, and with forced colors takes the colors of the system, as web pages do. Unit tests compare its palette, its line, its radii and its font with the tokens.

### Layout presets

Presets give users a good layout without having to assemble it from individual settings. From 0.1.0-beta.7, four presets set the place of the tabs, the place of the toolbar, whether the rows at the top hide and the density at once ([ADR 0058](../adr/0058-layout-presets-and-top-rows-that-hide.md)):

| Preset   | Tabs | Toolbar                | Rows that hide | Density |
| -------- | ---- | ---------------------- | -------------- | ------- |
| Classic  | Top  | In its own row         | No             | Normal  |
| Compact  | Top  | In the row of the tabs | No             | Compact |
| Zen      | Top  | In the row of the tabs | Yes            | Normal  |
| Vertical | Left | In its own row         | No             | Normal  |

The settings page offers them in the row **Layout**, before the density, and the setup guide in its layout step: a card for each, as a radio button with a small window drawn with the tokens (`app/src/ui/ui-kit/layout-previews.ts`), its name and a note. The window of each card shows the page and the address field in `--surface-2`, the bars in `--surface-1` and the tabs in `--accent`, so the cards follow the theme, the accent color and the color mode; Zen shows only the edge that stays. The card whose values the settings have is checked; with other values, none is, and the row says _Your own arrangement_. Bottom and Right are one choice away in **Tabs**.

- **The one row:** with the toolbar in the row of the tabs, the toolbar comes first, the tabs follow, and the menu button follows **New tab**. The row is `--toolbar-height` high, its cells lie on `--surface-0` with a line of `--line-1` below, the toolbar takes 42 % of the row but never less than its buttons and an address field of 96 px, the tabs never less than their buttons, the free room, the room of the window controls and two tabs of `--space-7`, and the tabs keep `--control-large` with rounded corners at the bottom. In a window too narrow for both, the tabs take a row of their own above the toolbar, as high as the one row. The window controls of Windows and Linux take the row's height, and the buttons of macOS lie in its middle.
- **Rows that hide:** what stays is an edge of 2 px at the compact density and 4 px otherwise, or the title row, as high as the one row, on `--surface-0` with a line of `--line-1`, which shows the icon of the connection, or a globe for an address without one, the site in `--text-1`, which every web page names, and the title in `--text-2` at `--font-size-small`, both cut with an ellipsis before the room of the window controls. Rows that show over the page fade in over `--motion-fast` with `--ease-out`, by their opacity alone; with reduced motion, they show at once. The page below neither moves nor changes its size.

### Site information

From 0.1.0-beta.7, the chip of the connection at the start of the address field opens site information for a web page ([ADR 0059](../adr/0059-site-information-with-checked-certificates.md)). The chip is a button of `--control-small` with the corners of `--radius-1`, as the chips of the address bar have, not a pill; it lies on `--surface-hover` under the pointer and while its popover is open, and shows the ring of `--focus-ring` for the keyboard. **Not secure** keeps its text in `--danger` on `--surface-1`. A page on this computer shows the icon of information of Lucide. The browser's own pages keep their icon, which is no button.

The popover is 320 px wide and lies below the chip, at its start, with the look of every popover (`--surface-raised`, `--line-1`, `--radius-3`, `--shadow-popover`). The host comes first at `--font-size-larger`; then the connection with its icon, in `--danger` for a connection that is not secure, its note in `--text-2`, and its button; then the certificate, the permissions with a switch each, the cookies and site data and the content blocker, each below a line of `--line-1` with its heading. The fingerprint uses the monospace font of the system at `--font-size-small` and can be selected. **Delete** of the question in place has the outline and the text in `--danger`, and takes the focus; once the data is deleted, the focus goes back to the button that asks, and other changes of the popover, such as the count of the content blocker, leave the question open. Buttons keep the outline of controls, `--border-1`.

## Logo

The logo is the owner's own: a letter A in a gradient from violet to blue, an orbit around it and a four-pointed star, with a glow, above the name on a dark indigo background ([ADR 0049](../adr/0049-logo-and-colors-of-the-brand.md)). It lives in `assets/brand/` (`logo.webp`), with the application icon that `tools/brand/render-icon.ts` renders from it: the mark without the name on a plate in the dark color of the logo (`app-icon.png`, and `app/build/icon.png` for the packages). Its gradient, its glow and its star stay in the logo and the icon; the interface has none of them.

## Acceptance

Design quality will be checked automatically in every pull request and reviewed by maintainers once per minor release.

Automated checks:

- **Contrast:** every built-in theme is checked against the contrast minimums above.
- **Accessibility:** axe-core runs in component and end-to-end tests and must report no serious or critical issues. Accessibility tree snapshots serve as regression tests.
- **Screenshot diff:** screenshots of all four tab bar positions in light and dark are generated in every pull request and compared with the reference. Each layout preset is compared with its reference layout the same way.

Design review: once per minor release, maintainers review the generated screenshot gallery (all tab bar positions, light and dark) against the design rules and approve it.

How these checks fit into the overall test strategy is described in [Testing](testing.md).

## Implementation status

Switches are tracks whose knob slides when they change, segmented controls change their colors softly, buttons of the toolbar give way while they are pressed, and the bookmark star pops when a page becomes a bookmark (`app/src/ui/ui-kit/choice-styles.ts`). The popovers of the overlay, the browser menu among them, enter and leave with `--motion-enter` and `--motion-exit`, and a button of the toolbar looks pressed while its popover is open. The tokens exist in `app/src/ui/ui-kit/tokens.css`: OKLCH colors for light and dark mode, the line and the raised surface mixed from them, spacing, the radii, the shadow of popovers, font weights and the motion durations and easings, with every duration 0 for `prefers-reduced-motion`. The browser's own views in a private window use the dark colors in both modes. The shell uses them, with inline Lucide-style icons. The reader view's document takes the palette, the line, the radii and the font of the tokens as values (see [Reader view](#reader-view)). The logo and the application icon exist in `assets/brand/` and are described in its README. The website applies the same rules to its documentation theme in `website/src/styles/theme.css`. The default [keyboard shortcuts](../user/keyboard-shortcuts.md) follow the conventions of each operating system; on Windows and Linux, F6 moves the focus to the address bar.

The three density levels, the text size, the font of the UI and the accent color are settings; components take every size, space and font from the tokens; the accent presets are Astela, the violet of the logo with its blue for progress and the default, and blue, teal, green, orange, red and graphite, and a custom color keeps its hue at a contrast of at least 4.5:1 (see [settings, policies and themes](settings-policy-theme.md#implementation-status)).

The tab bar sits at the top, at the bottom, or as a 240 px wide vertical list on the left or the right (setting `tabs.position`, policy `TabStripPosition`); the shell lays out the toolbar, the tab bar and the content area in a grid and reports where the content area is, so the page fills exactly that area. By default, the top row of the shell is the title bar of the window, with the window controls of the system in its corner, on Linux at the ends where the desktop puts them, in the color of the row; the row keeps `--space-7` free after its last button, so that it can move the window when the tabs fill it ([ADR 0048](../adr/0048-title-bar-drawn-by-the-browser.md)). The setting `appearance.titleBar` brings back the title bar of the system after a restart.

The chip of the connection opens [site information](#site-information) from 0.1.0-beta.7. The four [layout presets](#layout-presets) Classic, Compact, Zen and Vertical exist from 0.1.0-beta.7, with the toolbar in the row of the tabs (`toolbar.placement`) and the rows at the top that hide until they are needed (`toolbar.autoHide`), on the settings page and in the setup guide ([ADR 0058](../adr/0058-layout-presets-and-top-rows-that-hide.md)).

Not implemented yet: a single-color version of the logo, the social preview image, collapsing the vertical tab bar, the F6 cycle from the toolbar to the tabs to the content, and automated accessibility and screenshot checks.
