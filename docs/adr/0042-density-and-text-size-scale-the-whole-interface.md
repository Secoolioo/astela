# 0042. Density and text size scale the whole interface

## Status

Accepted. Amends [ADR 0013](0013-theme-system-and-design-tokens.md) on density and fonts.

## Date

2026-11-09

## Context

[ADR 0013](0013-theme-system-and-design-tokens.md) gave density three steps that changed only the heights of the toolbar and the tabs, on a fixed 4 px grid, with a normal tab of 34 px; the browser uses 32 px. Every other size was written into the components, so Compact still had the controls, spacing and text of Normal, and Comfortable looked like Normal with taller bars. ADR 0013 also named density and fonts as settings, but no setting changed the size or the font of the text.

## Decision

- **Density sets the geometry:** the toolbar, the tabs, the controls in three heights, the rows of lists and seven spacing steps. Compact has the steps 2, 4, 8, 12, 16, 24 and 32 px, Normal 4, 8, 12, 16, 24, 32 and 48 px, Comfortable 4, 12, 16, 20, 32, 40 and 56 px. Sizes stay on the 4 px grid, except the smallest step of Compact. Controls stay at least 24 × 24 px.
- **Text size is a setting of its own:** Small, Medium (default), Large and Larger set a scale of seven font sizes and five line heights. It is separate from density, so people who need larger text keep the density they like, and the reverse.
- **The font of the UI is a setting:** the name of an installed font, or empty for the system font stack. The name may hold letters, digits, spaces, dots, hyphens and underscores only, so it can be quoted in a style sheet; other names are refused.
- **One mechanism:** the browser sends all of these as design tokens to the shell, the overlay and its own pages, as it does for the accent; components take every size, space and font from tokens. Borders, outlines, radii, icon sizes and the widths of layouts stay fixed.

## Consequences

Positive:

- **Visible density:** Compact and Comfortable change the whole interface, also the browser's own pages.
- **Readable text:** larger text no longer needs the zoom of a page, and works in the shell and the menus too.

Negative:

- **More tokens:** components must use the tokens; a size written into a component does not scale and is a defect.
- **Fonts by name:** a font that is not installed falls back to the system font without a warning.

## Alternatives considered

- **Density also sets the text size:** one setting for everything, but it ties large text to large spacing.
- **A zoom factor for the whole UI:** scales borders and icons too, which then blur, and cannot follow the 4 px grid.
- **A list of installed fonts:** needs the permission for local fonts in the browser's own pages; a name works without it.
