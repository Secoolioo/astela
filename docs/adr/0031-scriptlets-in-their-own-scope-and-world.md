# 0031. Scriptlets in their own scope and world

## Status

Accepted. Refines how [ADR 0028](0028-content-blocker-rules-through-a-frame-preload.md) runs scriptlets and inserts hiding rules.

## Date

2026-11-09

## Context

A test of `0.1.0-beta.3` on real websites found pages that the content blocker broke. With the blocker on, the video page of YouTube stayed empty, and its console showed `SyntaxError: Identifier 'JSONPath' has already been declared` and `URIError: URI malformed`.

There were three causes:

- **Shared helpers collide:** the scriptlets of uBlock Origin bring their helpers as top-level declarations, such as `class JSONPath`. The frame preload ran each scriptlet in the page's global scope, so the second scriptlet with the same helper failed to declare it again and never ran.
- **Arguments break:** the filter engine puts each argument of a scriptlet into a template literal and decodes it with `decodeURIComponent`, without encoding it first. A `%` in an argument throws, a backtick ends the literal, and `$&` is taken as a replacement pattern.
- **Wrong world:** uBlock Origin runs some scriptlets in an isolated world; the browser ran all of them in the page's world.

Two weaknesses of the hiding rules and of the blocker as a whole were found as well:

- **Hiding rules lose:** they were inserted as author style sheets, so a page's own `!important` rules could win against them.
- **Failure is silent:** a package without its filter data blocked nothing, and the shield still showed the blocker as working.

## Decision

- **A scope per scriptlet:** the frame preload wraps every scriptlet in a function of its own with `try`/`catch`. A failing scriptlet writes a warning that starts with `[astela scriptlet]` to the console and does not stop the others.
- **Encoded arguments:** a patch of `@ghostery/adblocker` (`patches/@ghostery__adblocker@2.20.3.patch`) percent-encodes each argument before it goes into the script. The `decodeURIComponent` that the engine adds then restores every argument exactly.
- **Isolated world:** `tools/blocker/build.ts` marks the scriptlets whose world is `ISOLATED`. The frame preload runs them with `webFrame.executeJavaScriptInIsolatedWorld` in world 1001 and all others in the page's world, as before.
- **User style sheets:** hiding rules are inserted with `cssOrigin: 'user'`, so their `!important` rules win against the page's own.
- **A visible status:** the blocker reports whether it is idle, loading, ready or failed. Where it should block but has no usable filter data, the shield shows the failure, and the settings page says so.
- **Package scripts build the data:** `pnpm package`, `pnpm package:dir` and `pnpm dev` build the filter data with `tools/blocker/ensure.ts` when it is missing, and stop when that fails.

## Consequences

Positive:

- **Scriptlets:** they work as in uBlock Origin, including those with shared helpers, unusual arguments or an isolated world.
- **Hiding rules:** they hold against the styles of the page.
- **Failure:** a package without filter data shows the failure instead of hiding it.

Negative:

- **Shared state:** scriptlets no longer share one global helper object, so each one sets up its helpers itself; this costs little, because every scriptlet is small.
- **The patch:** the patch of the filter engine has to be carried until upstream fixes the encoding; the tool tests and the end-to-end tests of the scriptlets fail if it is lost.

## Alternatives considered

- **All scriptlets of a frame in one script with each helper once**, as uBlock Origin does: the engine hands out finished scripts with their helpers, and splitting them again would mean parsing code.
- **Decode arguments in a `try`/`catch`:** this keeps a valid `%41` in an argument from arriving as it was written, and backticks would still end the template literal.
