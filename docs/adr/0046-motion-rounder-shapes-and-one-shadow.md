# 0046. Motion, rounder shapes and one shadow

## Status

Accepted. Replaces the rules on shape, depth and motion of the [design system](../architecture/design-system.md#design-rules) and the motion line of [ADR 0013](0013-theme-system-and-design-tokens.md).

## Date

2026-11-10

## Context

The design rules of October 2026 kept the interface flat and still: radii of 4 and 6 px, no shadows, and motion of at most 150 ms, used almost nowhere. A review of 0.1.0-beta.3 found that the browser looks dated next to current browsers: tabs appear and vanish without a transition, menus and popovers have no edge against the page, and the hard corners make controls look like forms. Browsers that feel calm today round their controls more, give floating surfaces a soft shadow and move things briefly where it helps to follow a change.

Motion that is too long or too frequent makes a browser feel slow, and shadows and large radii everywhere make it look like a template. The new rules have to stay as strict as the old ones, only with other values.

## Decision

- **Shape:** four radii as tokens: `--radius-1` (6 px) for small parts such as icon buttons and chips, `--radius-2` (8 px) for controls such as buttons, inputs, tabs and rows, `--radius-3` (12 px) for surfaces that float or group content, such as menus, popovers, dialogs and tiles, and `--radius-field` (10 px) for the address bar and search fields. Only switches, badges and progress bars have round ends (`--radius-pill`).
- **Depth:** 1 px lines and surface colors still separate areas. Menus and popovers that float above the page get one soft shadow, `--shadow-popover`; nothing else casts a shadow. Rings of 1 or 2 px, such as focus rings, are allowed.
- **Motion:** four durations, `--motion-instant` (60 ms) for hover and press, `--motion-fast` (120 ms) for small changes, `--motion-base` (180 ms) for things that open, close or move, and `--motion-slow` (220 ms) for larger movements, and `--motion-loop` (1 s) for one turn of a loading indicator, with three easings, `--ease-standard`, `--ease-out` for things that enter and `--ease-in` for things that leave. Motion animates only `transform`, `opacity` and colors, never layout. With reduced motion, every duration is 0.
- **Weights:** `--font-weight-regular`, `--font-weight-medium` and `--font-weight-strong` give hierarchy with the type scale.
- **Enforced:** `pnpm verify` fails when the interface writes out a duration, an easing or a shadow instead of taking it from the tokens (`tools/design/check-tokens.ts`).

## Consequences

Positive:

- Tabs, menus and controls can show where they come from and where they go, which makes changes easier to follow.
- Menus and popovers stand out from the page without a border of their own.
- All motion stops at once with the system's setting for reduced motion, as every duration is a token.

Negative:

- The longest motion takes 220 ms instead of 150 ms; it is meant for movements that cover a distance, such as a sliding indicator, not for every change.
- Screenshots of all surfaces change once, as every radius grows by 2 px.

## Alternatives considered

- **Keeping the old rules:** the review showed that they make the browser look dated.
- **One radius for everything:** small parts look bloated with the radius of a menu, and menus look sharp with the radius of a button.
- **Shadows for every raised element, such as the active tab:** surfaces that do not float would look like cards, against the rule that areas are separated by lines and color.
- **Animations in JavaScript with fixed durations:** they would not follow the system's setting for reduced motion; JavaScript reads the duration from the tokens instead.
