# 0064. Web features that Electron shows no UI for

## Status

Accepted. Extends [ADR 0028](0028-content-blocker-rules-through-a-frame-preload.md): the frame preload also runs small wrappers in the page's own world and reports to the browser process. Extends [ADR 0034](0034-overlay-view-for-popovers-and-prompts.md) with content that stays when the window changes its size and with notices that wait for a question. Extends [ADR 0038](0038-site-permissions-asked-in-the-overlay.md) with the question for a security key and the answers without a question for the location on Linux and for the Storage Access API, and [ADR 0044](0044-third-party-cookies-blocked-by-chromium.md) with the answer to the Storage Access API from its blocking. Changes the refusal of Document Picture-in-Picture of [ADR 0057](0057-reader-view-and-picture-in-picture-in-isolated-worlds.md) into an interface that sites see as missing. Built in the fixes of 0.1.0-beta.7.

## Date

2026-11-15

## Context

A test of the beta.7 build on real sites found web features for which Chrome shows a UI of its own and stock Electron 45 shows none, or which Electron cannot serve at all:

- A request for a security key or a passkey shows nothing on Linux and macOS, and Chromium lets it wait at least three minutes, whatever the site's timeout; a sign-in with a passkey ends at once, because nobody chooses the account (`select-webauthn-account`).
- A page in full screen, or one that locks the mouse pointer, gets no notice that names the site and Escape, so a page could draw a fake browser or system over the whole screen.
- Sites that need Widevine fail with codes of their own, and the browser does not say why.
- Pages play sound at once, as Electron's default for `autoplayPolicy` is `no-user-gesture-required`.
- Sites offer Document Picture-in-Picture and Push, which Electron cannot place or deliver; the location on Linux comes from Google's service, which answers nobody without a key, and the Storage Access API is refused also where the frame has its cookies.

The browser process cannot see these requests in time, or cannot change what the page sees, without code in the page.

## Decision

- **Page world:** the frame preload runs self-contained functions in the page's own world with `contextBridge.executeInMainWorld` before the page's scripts (`app/src/preload/page-world.ts`). Each wraps a native function in a `Proxy`, which keeps its name, length and native text, and reports through a function of the preload's world that the page cannot reach. On Linux and macOS, `navigator.credentials.create()` and `get()` with `publicKey`, except `conditional` and `immediate` mediation, get a signal of their own next to the site's; the site's timeout or the browser's Cancel ends them with `NotAllowedError`, and they report `webauthn.request` as they start and end. A request while a wrapped one of the document waits is not wrapped and reports nothing, as Chromium lets a document wait for one request and refuses the others at once. In every frame, the first failed `requestMediaKeySystemAccess()` for another key system than Clear Key reports `media.protected` once per document. Windows keeps the dialog of `webauthn.dll`.
- **Browser process:** the listeners of these reports and of `select-webauthn-account` load with the code for web pages (`app/src/main/web-frames.ts`), take the site from `event.senderFrame`, and only frames of a tab's page in a web session count. The questions for security keys (`app/src/main/webauthn-prompt.ts`), the sign of protected media (`app/src/main/protected-media.ts`) and the notices of pages (`app/src/main/page-notices.ts`) each load with their first use, so the start-up path of the browser process grows by none of them.
- **Overlay:** a security key question names the site, shows while its tab is the one that its window shows, again when the tab shows again, and ends when the request ends, the page navigates or the person cancels; several accounts of a key are a choice, one is taken at once. A frame has one question at a time, the choice of an account takes the place of its question for the key and ends with the frame's request, and a page has at most eight questions; further reports change nothing, so that a page or a frame of an ad that asks in a loop costs the browser process nothing. A notice of 4 s at the top of the pages, the top of the window in full screen, names the site of a page in full screen or with a locked pointer and Escape; the site comes from the origin of the page's document (`mainFrame.origin`), which a page at a `blob:` address or an `about:blank` page that its opener wrote also has, keeps the end of a long host after an ellipsis (`noticeSite`), and a page whose origin is opaque gets the notice with Escape and no site. The notice lies in a part of the window of the size that the overlay page measured (`overlay.noticeSize`), so that all of its text shows and the rest of the page keeps the clicks; it takes neither the focus nor keys (`passive`): when its view gets the focus, as from a click, the focus goes back to the page, which keeps Escape. It gives way to a question and waits for one that is open (`WindowOverlay.whenIdle`). Content that passes `place` stays when the window changes its size, such as a notice while the window goes into full screen.
- **Shell:** a page that asked for protected playback in vain shows a quiet sign in the address bar until it navigates or plays media; a page that played media since its document loaded gets none, as its request only probed. The code for web pages tracks which pages played media from their start, before the code of the sign loads. The sign is a button with a popover, which shows as open with `aria-expanded` (`ShellPopover` `protectedMedia`). The tabs with the sign come with the event `shell.protectedMedia`, and the sign opens its popover with `shell.openProtectedMedia`, whose handler comes with the code for web pages, rather than with a field of each tab in the state of the shell, which every start reads.
- **Defaults of Chromium:** web pages, also those that a page opens, get `autoplayPolicy: 'document-user-activation-required'`, as in Chrome. A page that a page opens gets it from the window guard as it is made, and the view of its tab or popup takes it over with the preferences of a web view (`createView` in `app/src/platform/electron/browser-window.ts`): Electron puts the preferences that a view names in place of those of the page that it takes over, also when the view names none, and Chromium hands a page those preferences anew when the theme or the fonts change. A view without them gave such a page Electron's defaults then, which play sound at once; the test of 0.1.0-beta.7 saw it once in ten runs. The browser turns Blink's features `DocumentPictureInPictureAPI` and `PushMessaging` off before the first renderer starts (`addFeatures` in `app/src/main/cookie-blocking.ts`), after those that the command line turns off already, and the window guard refuses every disposition that Electron cannot place. On Linux without `GOOGLE_API_KEY`, requests and checks of the location get no at once. `storage-access` is answered from the blocking of third-party cookies, without a question; `top-level-storage-access` stays refused.

## Consequences

Positive:

- People see which site waits for a key and can cancel it; sites get their own timeout and their passkey sign-in, and fall back to another way where nothing can work.
- A page that takes the screen or the pointer cannot hide the way out, and sites that need Widevine or push fail in a way that people and sites understand.
- The start-up path stays within its budget: only the wiring of the defaults of Chromium is on it.
- Pages that a page opens now have all the preferences of the pages of tabs, also the fonts, the default zoom, the frame preload in their frames and no focus of their own as they load.

Negative:

- The wrappers run in every frame of every page and change what the page's world holds, though only in ways that the page sees as native functions. A page that tampers with `AbortSignal` or `Reflect` in its own world can break its own requests.
- A failed request for a key system marks a page also when its player only probed, until the page plays media or navigates; a page that played unprotected media before it asked for protected playback that it needs gets no sign.
- A click on the notice itself does not reach the page while the notice shows.
- PIN entry, sign-in with a phone and the passkeys of macOS still need Electron to support them; the Storage Access API cannot grant cookies while Chromium blocks third-party cookies.

## Alternatives considered

- **Refusing every request for a security key at once:** breaks keys that already work as a second factor, and the dialog of Windows.
- **A field of each tab for protected media in the state of the shell:** clearer, but it adds to the start-up path, which has no room for it.
- **A question for the Storage Access API per pair of sites:** a grant gives the frame no cookies under Chromium's own blocking in Electron 45.
- **Chromium's provider for the location portal of Linux:** ends the browser at the first request in Electron 45.
