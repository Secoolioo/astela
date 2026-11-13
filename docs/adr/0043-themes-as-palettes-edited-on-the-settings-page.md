# 0043. Themes as palettes, edited on the settings page

## Status

Accepted. Amends [ADR 0013](0013-theme-system-and-design-tokens.md) on the built-in themes, the theme editor and theme files. [ADR 0051](0051-calmer-dark-mode-mixed-from-the-palette.md) changes the dark palettes of the built-in themes and mixes two more tokens from every palette; a theme keeps its seven tokens.

## Date

2026-11-09

## Context

[ADR 0013](0013-theme-system-and-design-tokens.md) plans a theme engine with theme files in the profile, derived hover and pressed states, a separate editor page (`app://theme-editor`) and themes per workspace. Workspaces do not exist yet, and every change on the settings page already reaches every view of the browser at once, through the same tokens that a theme sets ([ADR 0042](0042-density-and-text-size-scale-the-whole-interface.md)). Version 0.1.0-beta.5 needs themes that people can choose and change, with readable contrast, without a second page and a second storage next to the settings.

## Decision

- **A theme is a palette:** seven color tokens for each color mode, `--surface-0`, `--surface-1`, `--surface-2`, `--surface-hover`, `--text-1`, `--text-2` and `--border-1` (`app/src/shared/themes.ts`). The accent stays its own setting and is computed for every theme as before. Radius, spacing and fonts are not part of a theme.
- **Built-in themes:** Astela (the colors of `tokens.css`), Paper, Forest, Ocean and Slate, each with a light and a dark mode, and True Dark, whose dark mode is black for OLED screens and whose light mode is Astela's. A unit test checks that every text has at least 4.5:1 contrast on every surface of every built-in theme.
- **Settings:** `appearance.theme` picks a built-in theme or `custom`; `appearance.customTheme` holds the colors that people chose, as `#rrggbb` by mode and token. A token without a color keeps Astela's.
- **Editor:** the custom colors are edited on the settings page, in the Appearance section, with one color field per token and mode. Each change applies to every view at once, which is the live preview. The page warns when a text has less than 4.5:1 contrast on a surface. **Start from** copies the colors of a built-in theme.
- **Files:** export writes `{ "$schemaVersion": 1, "light": {…}, "dark": {…} }` with the colors in the order of the tokens and in lower case, so exporting an imported theme gives the same file. Import validates the file against the schema of the setting and sets the custom theme.
- **Window color:** the window of a new browser window shows `--surface-0` of the theme until its shell paints, so it does not flash in another color.

## Consequences

Positive:

- Themes need no extra page, storage or migration: they are settings, so policies, export of all settings and the reset work for them as for any other setting.
- The start of the browser needs no color math: built-in palettes and window colors are data, and custom colors are already `#rrggbb`.
- Contrast is checked where people choose colors.

Negative:

- Themes change only colors; derived states such as pressed and disabled still come from fixed rules in the components.
- There is one custom theme; people keep more of them as files.
- Themes per workspace and backgrounds for the new tab page follow with workspaces and the new tab page settings.

## Alternatives considered

- **A separate editor page (`app://theme-editor`):** a second internal page with its own bridge scope and capability, for a preview that the settings page already gives.
- **Theme files in the profile folder `themes/`:** a second storage with its own validation and migration next to the settings, for one custom theme.
- **Theming every token:** more freedom, but radius and spacing changes break the layout rules of the [design system](../architecture/design-system.md), and every new token would become a public format.
