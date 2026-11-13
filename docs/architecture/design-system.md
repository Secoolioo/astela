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
- **Platform:** the native window controls, menus, context menus and shortcuts of each operating system are respected.
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

The outlines of controls, such as fields, buttons, segmented controls and cards that are chosen like radio buttons, keep `--border-1`. In a list on the raised surface, such as the address suggestions, the row that the arrow keys mark carries a bar in the accent at its start, above `--surface-hover`, as the step between the two surfaces stays far below 3:1; with forced colors, the bar has the system's highlight color. Pictures that show the colors of both modes at once, such as the window previews of the setup guide, take Astela's palette from `builtInThemes` and the opacity of the line from `lineOpacity` in `app/src/shared/themes.ts`. The danger color is `oklch(52% 0.19 25)` in light mode and `oklch(72% 0.15 25)` in dark mode (`statusColors` in `app/src/shared/themes.ts`).

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

Menus and popovers that float above the page have the one shadow, `--shadow-popover`, which is darker in dark mode. Focus rings of 1 or 2 px are no shadows of depth.

## Motion

| Token              | Duration | Used for                                      |
| ------------------ | -------- | --------------------------------------------- |
| `--motion-instant` | 60 ms    | Hover and press                               |
| `--motion-fast`    | 120 ms   | Small changes, such as a check mark           |
| `--motion-base`    | 180 ms   | Things that open, close or move, such as tabs |
| `--motion-slow`    | 220 ms   | Larger movements, such as a sliding indicator |
| `--motion-loop`    | 1 s      | One turn of a loading indicator               |

- Things that enter use `--ease-out`, things that leave `--ease-in`, and movements `--ease-standard`. A loading indicator repeats one turn of `--motion-loop`; one that turns at an even speed, such as the loading ring of a tab, uses `--ease-linear`.
- Animations use only `transform`, `opacity` and colors, so they never trigger layout.
- When the system requests reduced motion (`prefers-reduced-motion`), every duration is 0, so nothing moves.
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

### Layout presets

Presets give users a good layout without having to assemble it from individual settings:

- Classic
- Vertical left
- Vertical right
- Bottom
- Compact

On first start, the new tab page is designed to offer the choice of presets without a modal dialog; the settings offer it later as well. After choosing a preset, users can adjust every part of the layout freely. Each preset has a reference layout as well.

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

Switches are tracks whose knob slides when they change, segmented controls change their colors softly, buttons of the toolbar give way while they are pressed, and the bookmark star pops when a page becomes a bookmark (`app/src/ui/ui-kit/choice-styles.ts`). The tokens exist in `app/src/ui/ui-kit/tokens.css`: OKLCH colors for light and dark mode, the line and the raised surface mixed from them, spacing, the radii, the shadow of popovers, font weights and the motion durations and easings, with every duration 0 for `prefers-reduced-motion`. The browser's own views in a private window use the dark colors in both modes. The shell uses them, with inline Lucide-style icons. The logo and the application icon exist in `assets/brand/` and are described in its README. The website applies the same rules to its documentation theme in `website/src/styles/theme.css`. The default [keyboard shortcuts](../user/keyboard-shortcuts.md) follow the conventions of each operating system; on Windows and Linux, F6 moves the focus to the address bar.

The three density levels, the text size, the font of the UI and the accent color are settings; components take every size, space and font from the tokens; the accent presets are Astela, the violet of the logo with its blue for progress and the default, and blue, teal, green, orange, red and graphite, and a custom color keeps its hue at a contrast of at least 4.5:1 (see [settings, policies and themes](settings-policy-theme.md#implementation-status)).

The tab bar sits at the top, at the bottom, or as a 240 px wide vertical list on the left or the right (setting `tabs.position`, policy `TabStripPosition`); the shell lays out the toolbar, the tab bar and the content area in a grid and reports where the content area is, so the page fills exactly that area. By default, the top row of the shell is the title bar of the window, with the window controls of the system in its corner, on Linux at the ends where the desktop puts them, in the color of the row; the row keeps `--space-7` free after its last button, so that it can move the window when the tabs fill it ([ADR 0048](../adr/0048-title-bar-drawn-by-the-browser.md)). The setting `appearance.titleBar` brings back the title bar of the system after a restart.

Not implemented yet: a single-color version of the logo, the social preview image, collapsing the vertical tab bar, layout presets, the F6 cycle from the toolbar to the tabs to the content, and automated accessibility and screenshot checks.
