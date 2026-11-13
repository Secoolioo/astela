# 0051. A calmer dark mode mixed from the palette

## Status

Accepted. Amends [ADR 0013](0013-theme-system-and-design-tokens.md) on derived colors and [ADR 0043](0043-themes-as-palettes-edited-on-the-settings-page.md) on the dark palettes of the built-in themes.

## Date

2026-11-10

## Context

In dark mode, and in the private windows, which are dark in both modes, the surfaces of Astela step unevenly: the window is at 20 % lightness, the panels and the toolbar at 25 %, fields at 29 %, the color under the pointer at 33 % and the lines at 36 %. The toolbar stands out from the window, fields and hover states jump, and every line is drawn at full strength, so the lines look harsh next to the dark surfaces. The other built-in themes step in the same way, by 4.5 % and then by 4 %.

The accent of the dark mode is solved for a contrast of at least 4.5:1 against the lightest dark surface that it appears on, 33 % (`app/src/domain/appearance/accent.ts`). The color under the pointer of Paper's dark mode is 33.5 %, so the red accent reaches only 4.49:1 there.

Popovers, address suggestions and dialogs have the color of the panels, `--surface-1`. In dark mode, a popover above a panel stands out only by its line and its shadow. Every popover of 0.1.0-beta.7, such as the command palette, the menus in the overlay and site information, needs a surface that lies above the panels.

[ADR 0013](0013-theme-system-and-design-tokens.md) planned a theme engine in the browser process that derives such colors. [ADR 0043](0043-themes-as-palettes-edited-on-the-settings-page.md) made a theme a palette of seven color tokens, which the custom theme and later the themes of workspaces set as well. New colors have to follow every palette, without a change of the theme format.

## Decision

- **Even dark steps:** the dark surfaces of every built-in theme but True Dark lie 3.5 % lightness apart, and the lines lie 3.5 to 4 % above the color under the pointer. The window color (`--surface-0`) and the texts stay as they were. The light mode and the palette of True Dark, whose black is meant for OLED screens, do not change.

  | Theme  | `surface-0` | `surface-1` | `surface-2` | `surface-hover` | `border-1` | Toolbar   |
  | ------ | ----------- | ----------- | ----------- | --------------- | ---------- | --------- |
  | Astela | 20 %        | 23.5 %      | 27 %        | 30.5 %          | 34 %       | `#1c1e22` |
  | Paper  | 21 %        | 24.5 %      | 28 %        | 31.5 %          | 35 %       | `#23201d` |
  | Forest | 20 %        | 23.5 %      | 27 %        | 30.5 %          | 34.5 %     | `#1a201c` |
  | Ocean  | 19.5 %      | 23 %        | 26.5 %      | 30 %            | 34 %       | `#181e23` |
  | Slate  | 19 %        | 22.5 %      | 26 %        | 29.5 %          | 33 %       | `#1c1c1c` |

  The toolbar color, `--surface-1` as `#rrggbb`, is the color that the window controls of Windows and Linux take when the toolbar is the top row; it becomes slightly darker. Astela's was `#1f2226`.

- **Two tokens mixed from the palette:** `tokens.css` defines `--line-1` and `--surface-raised` from the palette tokens, next to the palette in each of its blocks:
  - light mode: `--line-1: var(--border-1)` and `--surface-raised: var(--surface-1)`;
  - dark mode and private windows: `--line-1: color-mix(in oklch, var(--border-1) 60%, transparent)` and `--surface-raised: color-mix(in oklch, var(--surface-1), var(--surface-2))`, half a step between the panels and the fields.

  Each view mixes them from the palette that applies to it, so the built-in themes, the custom theme and later the themes of workspaces get them without code of their own. They are not palette tokens: a theme keeps its seven tokens, the theme files keep `$schemaVersion` 1, and `appearance.customTheme` and the style sheet that the browser sends to its views do not change.

- **Where they apply:** `--line-1` draws the lines that separate areas or outline panels and surfaces that float: below the toolbar, the bookmarks bar and the find bar, around the tab strip and at the edges of tabs that scroll, between the rows of lists, the settings and the setup guide, and around panels, popovers, suggestions and dialogs. `--border-1` stays the outline of controls: fields, buttons, segmented controls, color fields and cards that are chosen like radio buttons. Popovers, suggestions and dialogs of the overlay, and the dialogs and the bar that offers a restart on the settings page, lie on `--surface-raised`.

- **The marked row:** in a list on the raised surface, the row that the arrow keys mark, which Enter opens, also carries a bar in the accent at its start, above the color under the pointer. On the raised surface, the color under the pointer lies a step and a half above it: 1.19:1 in Astela's dark mode, where the suggestions of 0.1.0-beta.6 had 1.31:1 on the panels. The pointer can also rest on another row, which then looks the same. The accent reaches at least 3:1 on the color under the pointer of every built-in theme in both modes, as the states of UI components need; with forced colors, which take the surfaces away, the bar has the system's highlight color. The address suggestions have the bar; the lists that later popovers show on the raised surface, such as menus and the command palette, take it too.

- **Pictures without tokens:** the window previews of the setup guide show the light and the dark mode at once, so they cannot take their colors from the tokens of their page. They draw Astela's palette from `builtInThemes` and the line below the toolbar at `lineOpacity`, which `app/src/shared/themes.ts` holds as `tokens.css` mixes `--line-1`: all of `--border-1` in light mode and 60 % in dark mode.

- **Status colors:** `statusColors` in `app/src/shared/themes.ts` holds the danger color of both modes, `oklch(52% 0.19 25)` and `oklch(72% 0.15 25)`, as `tokens.css` has it.

- **Checked by unit tests:** `app/src/shared/__tests__/themes.test.ts` checks that the dark surfaces of every built-in theme but True Dark step 3 to 4 % apart and the line 3 to 4.5 % above the color under the pointer, that the color under the pointer of every built-in theme lies at least a step above the raised surface, and that the danger color reaches 4.5:1 on every dark surface, the raised one included. `app/src/domain/__tests__/appearance.test.ts` checks, next to the math of the accent, that no dark surface is lighter than the surface that the accent is solved against (`accentSurfaces`), that every accent preset reaches 4.5:1 on every dark surface, and that it reaches 3:1 on the color under the pointer of every built-in theme in both modes, for the bar of the marked row; the tests of `shared` cannot use the `domain` layer. `app/src/main/__tests__/tokens-css.test.ts` checks that the light, dark and private blocks of `tokens.css` hold exactly Astela's palette and the danger color of `themes.ts`, that the private block equals the dark one, and that every block defines the two mixed tokens, the line at `lineOpacity`.

## Consequences

Positive:

- Lines are calmer, the toolbar, fields and hover states sit closer together, and popovers stand half a step above the panels below them.
- Custom themes keep their seven colors and get the calmer lines and the raised surface without a migration.
- The accent keeps 4.5:1 on every dark surface of every built-in theme; the worst text contrast of the dark palettes rises from 5.40:1 to 5.82:1, and that of the danger color from 4.54:1 to 4.89:1.
- New popovers use the two tokens and look the same in every theme.
- With the keyboard, the row that Enter opens is plain to see in every theme and in both modes, also while the pointer rests on another row.

Negative:

- The dark toolbar and the window controls next to it are slightly darker, and screenshots of the dark mode change once.
- A line of `--line-1` lets the surface below it show through, so it is a little lighter on a panel than on the window; on either, it stays calmer than the outline of a control.
- The browser process does not know the two tokens; the window color and the window controls use palette tokens only, which is all they need now.
- The bar of the marked row shows in light mode as well, which otherwise keeps its look.
- The tests of the surfaces cover the dark mode only. In light mode the accent is solved against the lightest light surface, 99.5 %, so the green preset reaches 4.26:1 on Astela's window color, and the danger color reaches 4.44:1 on Paper's light color under the pointer. This was so before; changing the light colors is outside this decision.

## Alternatives considered

- **Two new palette tokens:** a change of the theme format to `$schemaVersion` 2, a migration of the custom theme and two more color fields per mode on the settings page, for colors that follow from the palette.
- **A translucent `--border-1`:** the custom theme stores `#rrggbb` without alpha, and the outlines of controls would lose their edge.
- **Changing only Astela's dark colors:** the built-in themes would drift apart, and Paper's color under the pointer would stay above the surface that the accent is solved against.
- **Mixing the colors in the browser process, as the theme engine of ADR 0013 planned:** color math on the start path and a longer style sheet for every view, for colors that each view mixes itself.
- **Calmer lines in light mode as well:** the light mode stays as it is; the dark mode needed the change, and the light mode can follow with its own decision.
- **A lighter color under the pointer for rows on the raised surface, as a third mixed token:** a step as large as that of 0.1.0-beta.6 needs about 33 % lightness in Astela and 34 % in Paper, at or above the surface that the accent is solved against, so the accents and the danger color would fall below 4.5:1 on the marked row of Paper. No step of a surface reaches 3:1, and the row under the pointer would still look like the marked one.
