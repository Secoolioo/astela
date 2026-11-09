# 0032. Replacement resources over a scheme of their own

## Status

Accepted. Extends [ADR 0027](0027-blocker-with-the-default-lists-of-ublock-origin.md) by the filter options that it left out.

## Date

2026-11-09

## Context

The lists of uBlock Origin contain more than 1,300 `$redirect` filters. They replace a blocked script, image or media file with a harmless stand-in, such as an empty script or the interface of an ad library that does nothing. Pages wait for these files: a script that fails to load fires its error event instead of its load event, and video players hang or show a message about ad blockers. In `0.1.0-beta.3`, the blocker cancelled these requests, because it shipped no stand-ins: `tools/blocker/build.ts` passed them under a key that the filter engine ignores.

The lists also use `$removeparam`, which takes tracking parameters out of addresses, and `$csp`, which sets a content security policy for a page; the browser ignored both. Spike S1 showed that a script redirected to a `data:` address does not run in Chromium, while one redirected to a privileged scheme of the browser does.

## Decision

- **Stand-ins from the pinned release:** `tools/blocker/redirects.ts` takes the replacement resources of uBlock Origin from the release whose scriptlets the browser uses. It reads the names and aliases from `src/js/redirect-resources.js` and the files from `src/web_accessible_resources/`. Their hashes are recorded in `tools/blocker/ubo-sources.json`, and each file must match. Resources that need parameters or trusted lists are left out, because the filter engine supports neither. The data built from them carries the stand-ins.
- **A scheme of their own:** a matching `$redirect` filter sends the request to `astela-resource://resource/<name>`. This scheme is privileged, standard and secure, may be fetched from every origin, and is served only on web sessions, only with the stand-ins of the filter data. Web pages cannot navigate a tab to it.
- **Parameters:** a request that nothing blocks and whose address has a parameter that a `$removeparam` filter names goes to the address without it. Pages that the user opens are never blocked, but they lose such parameters as well once the filter engine has loaded.
- **Policies:** the request pipeline gets a second step for response headers. The blocker adds the policy of the `$csp` filters that match a page, next to the policies that the server sends.

## Consequences

Positive:

- **Pages wait less:** pages that wait for a blocked file get one that does nothing, so their players and forms work as with uBlock Origin.
- **Parameters:** tracking parameters no longer reach the servers that the lists name.
- **Policies:** lists can switch off what a page loads through a policy.

Negative:

- **Size:** the filter data grows by the stand-ins, about 100 KB.
- **Missing resources:** a filter that names a resource the build left out gets an empty stand-in of the same type from the filter engine.

## Alternatives considered

- **`data:` addresses:** the engine provides them, but Chromium does not run a script redirected to one.
- **Cancelling redirect filters:** this is what the browser did before, and it breaks pages that uBlock Origin keeps working.
