# 0044. Third-party cookies blocked by Chromium

## Status

Accepted. Builds on [ADR 0030](0030-request-pipeline-and-content-blocker.md) for the request pipeline.

## Date

2026-11-10

## Context

Version 0.1.0-beta.5 blocks third-party cookies by default, as `docs/architecture/security.md` plans. Electron has no setting for it, so the first version kept cookies away in two places of its own: the request pipeline removed `Cookie` and `Set-Cookie` from requests to other sites than the page, and a script in the frames of other sites hid `document.cookie` and `cookieStore`.

A review of that version showed that a script gets around it: a frame of another site creates a frame of its own without an address, such as `about:blank`, whose document has the cookie methods of its own realm, which Electron runs no frame preload for. Through it, the script reads and writes its cookies, also those of the frame's own document. Service workers and shared workers of other sites belong to no page, so the pipeline cannot tell their requests apart from those of the site itself.

Chromium's network service blocks third-party cookies itself when its feature `ForceThirdPartyCookieBlockingEnabled` is on: in requests and responses, in `document.cookie` and `cookieStore` of every frame, whatever realm the method comes from, and for workers, by the site of the page they belong to. It leaves partitioned cookies, which cannot track across sites. A test shows that Electron 45 honours the feature. Chromium reads its features once, as it starts.

## Decision

- **Chromium blocks:** when the setting `privacy.blockThirdPartyCookies` (policy `BlockThirdPartyCookies`) is on at the start, the browser adds `ForceThirdPartyCookieBlockingEnabled` to the features that Chromium enables, before Chromium starts (`app/src/main/cookie-blocking.ts`). The value comes, in the order of the settings, from a mandatory policy, the user's value in `settings.json`, a recommended policy and the default, which is on; the policies come from the cache of the last start, as the fresh read finishes later.
- **Restart:** the setting needs a restart to take full effect. The settings page says so after a change and offers **Restart now**.
- **Fallback:** while Chromium does not block, the request pipeline and the frame script keep cookies away as before, comparing sites by origin: when the setting is turned on during a session, until the restart, and in private windows while the setting is off. The frame script also refuses service workers and shared workers in frames of other sites.
- **No exceptions:** the list of sites that keep third-party cookies is gone. Chromium's own blocking offers no exceptions to an embedder; a site that needs third-party cookies, such as a sign-in in a frame, works after turning the setting off.

## Consequences

Positive:

- Blocking holds for every way a page has to cookies, including frames without an address of their own and workers, with Chromium's own rules for what counts as third-party.
- Partitioned cookies keep working, as in other browsers that block third-party cookies.

Negative:

- A change of the setting takes full effect only after a restart.
- There are no exceptions per site.
- The feature is one that Chromium keeps for tests and enterprise use; an Electron update could drop it. The end-to-end test reads and writes cookies through a frame without an address and a service worker of another site, so such an update fails it.
- Until the restart, and in private windows while the setting is off, the fallback has the gap that this decision closes.

## Alternatives considered

- **Only the request pipeline and the frame script:** they cannot reach realms without a preload and requests of workers.
- **Hiding the cookie methods also in frames that a frame creates:** a script reaches such frames in ways that a script of its own cannot all intercept, such as `window[0]`.
- **Turning the feature on and off during a session:** Chromium reads features once.
