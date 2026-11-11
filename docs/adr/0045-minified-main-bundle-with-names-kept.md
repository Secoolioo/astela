# 0045. A minified main bundle that keeps names

## Status

Accepted. Changes how [ADR 0004](0004-typescript-toolchain-and-build.md) builds the main process; the budget of [ADR 0017](0017-performance-budgets-in-ci.md) stays.

## Date

2026-11-10

## Context

The main process reads its start-up path, the entry chunk and the chunks that it imports statically, before the first window opens, and [ADR 0017](0017-performance-budgets-in-ci.md) limits that path to 150 KiB. Until 0.1.0-beta.5, only the chunks that held nothing but dependencies were minified; Astela's own code stayed as written, so that the stack traces in its logs stayed readable. Features load through `import()` where they can, but the settings, the window and the request pipeline of each new feature still grow the path: with the settings, privacy and appearance features of 0.1.0-beta.5, it would have grown from 149 to about 175 KiB.

The minifier keeps the names of functions and classes when asked to, so stack traces still name the functions they pass through; only their positions refer to the minified file.

## Decision

- Every chunk of the main process, Astela's own code included, is minified with Rolldown's minifier: whitespace goes, and local names are shortened, while the names of functions and classes stay (`keepNames`).
- Licence comments stay in the minified chunks, as the licences of dependencies such as the MPL-2.0 of the content blocker's engine require.
- The preloads and the pages keep the build that they had.

## Consequences

Positive:

- The start-up path fell from 149.4 to 86.2 KiB, which leaves room for the features of the next betas within the same budget.
- Less code to read and compile on every start.

Negative:

- Stack traces of the main process name the right functions and classes, but their line and column numbers refer to the minified file, not to the source.
- Reading the shipped main bundle by hand is harder.

## Alternatives considered

- **Load more of each feature through `import()`:** done where it fits, but the settings and the window of each feature are needed at the start; it would have saved only a part of what the features add.
- **Minify only the whitespace:** keeps local names, but leaves about 30 KiB more on the start-up path for the same loss of line numbers.
- **Ship source maps for the stack traces:** Node would read them with the modules, at a cost to the start, or a separate tool would have to map the logs; the names in the stack traces are enough for now.
