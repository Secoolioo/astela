# 0027. Content blocker with the default lists of uBlock Origin

## Status

Accepted

## Date

2026-11-01

## Context

[ADR 0018](0018-content-blocker-engine.md) chose the `@ghostery/adblocker` engine behind Astela's own request pipeline and a signed filter feed, for the second milestone. Users expect blocking that is as complete as uBlock Origin's, and they expect it from the first start, so the blocker moves into `0.1.0-beta.3`.

uBlock Origin itself cannot run: Electron 45 has no Manifest V2 support and no `declarativeNetRequest`. Its filter lists and its scriptlets can be used, though. On 2026-11-01, a build from the lists that uBlock Origin 1.75 enables by default, without Peter Lowe's list, produced 7 lists with about 6.7 MB of filters after resolving their `!#include` directives; the engine parsed them in 746 ms, serialized to 6.3 MB, accepted 151 scriptlets, and blocked a known ad script while allowing a first-party script.

## Decision

- **Lists:** the lists that uBlock Origin enables by default: uBlock filters with Badware risks, Privacy, Unbreak and Quick fixes, EasyList, EasyPrivacy, and the Online Malicious URL Blocklist. Peter Lowe's list is left out, because its terms do not allow redistribution in a product. The lists come from the repositories that uBlock Origin uses itself, listed in `tools/blocker/lists.ts`.
- **Directives:** `tools/blocker/preprocess.ts` resolves `!#if` blocks for Astela's environment (a Chromium browser that uses uBlock Origin's lists) and `!#include` of files next to a list, as uBlock Origin does; an include that leaves the list's folder is refused.
- **Scriptlets:** taken from a fixed uBlock Origin release (`tools/blocker/ubo-sources.json`, currently 1.75.0) by following the imports of `src/js/resources/scriptlets.js`. Every file must match its recorded SHA-256 hash; a new release is adopted by changing the tag and recording the new hashes in a reviewed pull request.
- **Build:** `tools/blocker/build.ts` downloads the lists, builds and serializes the engine, and writes `engine.bin`, `filters.json` (sources, hashes and sizes) and `NOTICE.txt` (the license of every list and of the scriptlets). CI runs it before it builds the packages; the packages carry the result as separate data files in `resources/blocker/`. The browser never downloads lists itself. The signed feed of ADR 0018 follows, for updates between releases.
- **Network blocking:** the request pipeline owns the one `onBeforeRequest` listener of every web session and asks the content blocker, which cancels matching requests. The engine loads after the first window, or with the first web request, which waits for it. Requests of the page that the user opens (main frames) are not blocked until the warning page exists, so a page is never replaced by an error.
- **Control:** the setting `contentBlocker.enabled`, on by default, with the policy `ContentBlockerEnabled`; the settings page has a switch for it.

This record supersedes the parts of ADR 0018 that concern the milestone, the delivery of filter data before the feed exists, and the main-frame blocking; the engine choice, the request pipeline and the frame preload of ADR 0018 stay.

## Consequences

Positive:

- Blocking matches what uBlock Origin users know, from the first start and offline.
- The lists and scriptlets keep their licenses as separate data with their notices, next to Astela's own MPL-2.0 code.
- A changed scriptlet source cannot enter a build unnoticed.

Negative:

- Every package grows by the engine data, about 6 MB before compression.
- Between releases, the lists age until the signed feed exists.
- A build fails when a list host is unreachable; the build retries four times first.

## Alternatives considered

- **All of uBlock Origin's default lists, including Peter Lowe's:** its terms ask for permission for use in a product.
- **Lists fetched by the browser at runtime:** a connection to third-party hosts from every installation, and lists that are not reviewed or signed.
- **Lists and scriptlets in the repository:** megabytes of daily changing data in the history, and GPL code mixed into the source tree.
