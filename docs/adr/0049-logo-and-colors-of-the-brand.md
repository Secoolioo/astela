# 0049. Logo and colors of the brand

## Status

Accepted. Replaces the logo brief of [ADR 0024](0024-icons-and-typography.md) and the rules on color, gradients and sparkle symbols of the [design rules](../architecture/design-system.md#design-rules) where they concern the logo and the accent.

## Date

2026-11-10

## Context

Until 0.1.0-beta.5, Astela's mark was a browser window drawn with one stroke on a plate in a blue accent color, and the design rules ruled out gradients, also in the logo, sparkle symbols and a purple or indigo accent. On 2026-11-10, the owner of the project gave Astela its logo: a letter A in a gradient from violet to blue, an orbit around it and a four-pointed star, above the name, on a dark background. It is to be used as it is, and its colors are to be the first and the second color of the browser. On the same day, the owner gave an updated version of it, before it shipped: the same mark and name, with a glow on the letter and the orbit, a lighter star and a dark indigo background with arcs of light in two corners.

## Decision

- **Logo:** `assets/brand/logo.webp` is the logo as the owner made it, in its updated version, 1254 px square. The README shows it at its top.
- **Application icon:** `tools/brand/render-icon.ts` renders the mark of the logo, without the name, on a plate in the dark background color of the logo that follows the icon grids of macOS and Windows; the logo fades into the plate towards its edges, so the arcs of light in its corners stay out of the icon: `app/build/icon.png` for the packages and `assets/brand/app-icon.png` for the website, which uses it as its logo and favicon.
- **First color:** the violet of the logo is the default accent, the preset `astela`, solved for a contrast of at least 4.5:1 on the surfaces of each mode like every preset: `oklch(55% 0.24 290)` in light mode and `oklch(72% 0.157 290)` in dark mode. Controls, focus rings, selections and switches take it. The other presets and a custom color stay available.
- **Second color:** the blue of the logo, `oklch(55% 0.18 265)` and `oklch(72% 0.145 265)`, is the color of progress with the preset `astela`: the loading bar of the address bar, the ring of a loading tab and the progress of downloads (token `--accent-secondary`). With another accent, progress takes that accent.
- **Website:** its accent is the violet of the logo, in a light and a dark variant.
- **Exceptions to the design rules:** the gradient, the glow and the star belong to the logo and the application icon only. The browser, its pages and the website stay flat: no gradients, no glows, no sparkle symbols and one icon set.

- **Colors of the updated logo:** the update keeps the hues. The median hue of the saturated pixels of the mark, in OKLCH, is 297° for the violet in both versions and 269° instead of 275° for the blue; the accent and the color of progress stay as they are.

## Consequences

- People who never chose an accent see the violet of the logo after the update; a chosen accent stays.
- The logo is a raster image, so the icons come from a 1254 px source; it is large enough for the 1024 px icon from which electron-builder derives the icons of every system. A vector version of the logo would replace the source without changing the renderer much.
- The mark is not drawn in a single color any more; a monochrome variant for print or for 16 px use does not exist yet.
