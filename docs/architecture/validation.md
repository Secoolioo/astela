# Validation results

Before the first release, the riskiest assumptions of the architecture were tested in seven short experiments on GitHub-hosted runners. This page records what was measured and what changed as a result. All runs used Electron 45.0.0 and electron-builder 26.18.0 on 2026-10-25. The experiment code was throwaway code and is not part of the repository.

## Storage with node:sqlite

[ADR 0009](../adr/0009-storage-with-node-sqlite.md) depends on `node:sqlite` working in a `utilityProcess` everywhere. A worker created 100,000 history rows with an FTS5 index, ran ranked and prefix queries 20 times each, took a snapshot with `VACUUM INTO` and set `PRAGMA user_version`.

| Platform      | SQLite | WAL | Insert 100,000 rows | Ranked query p50 | Prefix query p50 | `VACUUM INTO` |
| ------------- | ------ | --- | ------------------- | ---------------- | ---------------- | ------------- |
| Linux x64     | 3.53.4 | yes | 474 ms              | 28.7 ms          | 38.6 ms          | yes           |
| Linux arm64   | 3.53.4 | yes | 459 ms              | 22.8 ms          | 30.8 ms          | yes           |
| Windows x64   | 3.53.4 | yes | 663 ms              | 16.6 ms          | 22.7 ms          | yes           |
| Windows arm64 | 3.53.4 | yes | 1,163 ms            | 26.3 ms          | 35.3 ms          | yes           |
| macOS arm64   | 3.53.4 | yes | 313 ms              | 17.8 ms          | 24.4 ms          | yes           |
| macOS x64     | 3.53.4 | yes | 865 ms              | 37.3 ms          | 50.8 ms          | yes           |

**Result:** `node:sqlite` is used as planned; the native fallback is not needed. The prefix query on macOS x64 is just above the 50 ms target for history search, so the history module will use an FTS5 prefix index and rank a limited candidate set instead of the naive query used here.

## Moving tabs between windows

A `WebContentsView` with typed form input, a scroll position and a running timer was moved from one `BaseWindow` to another.

| Platform                             | Move time | No reload | Same renderer process | State kept | Focus after move |
| ------------------------------------ | --------- | --------- | --------------------- | ---------- | ---------------- |
| Linux x64 (X11)                      | 0.35 ms   | yes       | yes                   | yes        | yes              |
| Linux x64 (Wayland, headless Weston) | 0.34 ms   | yes       | yes                   | yes        | yes              |
| Linux arm64                          | 0.62 ms   | yes       | yes                   | yes        | yes              |
| Windows x64                          | 2.51 ms   | yes       | yes                   | yes        | yes              |
| Windows arm64                        | 2.72 ms   | yes       | yes                   | yes        | yes              |
| macOS arm64                          | 1.39 ms   | yes       | yes                   | yes        | yes              |
| macOS x64                            | 1.64 ms   | yes       | yes                   | yes        | yes              |

**Result:** drag and drop between windows moves the view itself, as designed in the [overview](overview.md#windows-tabs-and-workspaces).

## Signed update feed and delta updates

Two builds, `0.0.1` and `0.0.2`, were served from a local signed feed. The installed `0.0.1` had to reject a feed with a bad signature, an expired feed and a feed with a lower sequence number, and then update itself silently.

| Format                         | Package size  | Downloaded for the update | Rejected bad feeds | Silent update |
| ------------------------------ | ------------- | ------------------------- | ------------------ | ------------- |
| Windows NSIS (x64)             | 113,000,943 B | 779,399 B                 | all three          | yes, 17 s     |
| Linux AppImage (x64)           | 123,935,264 B | 376,275 B                 | all three          | yes, 3 s      |
| macOS zip (arm64), self-signed | 115,300,831 B | 115,300,831 B             | all three          | yes, 7 s      |

**Results:**

- The custom provider of [ADR 0014](../adr/0014-update-architecture-with-signed-feed.md) works with electron-updater 6.8.11. The provider must pass the `blockMapSize` of an AppImage from `latest-linux.yml` into the signed manifest; without it, the AppImage update falls back to a full download.
- NSIS with a separate block map already yields small deltas, so `nsis-web` is not needed.
- On macOS, Squirrel.Mac accepts updates signed with a self-signed certificate that is trusted for code signing, so the planned path without an Apple Developer ID works. The first update after an installation from a zip downloads the full package, because no earlier zip is cached; later updates can use the block map.

## Linux sandbox with restricted user namespaces

On Ubuntu 24.04 (x64 and arm64) with `kernel.apparmor_restrict_unprivileged_userns=1`:

| Variant                                                                                      | Renderer sandboxed | Notes                                                |
| -------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| deb with the AppArmor profile that electron-builder installs                                 | yes                | namespace sandbox                                    |
| deb without profile and without SUID helper                                                  | no start           | Chromium refuses to start, which is the safe outcome |
| deb with only the SUID helper                                                                | yes                | SUID sandbox                                         |
| AppImage, binary started directly, no profile                                                | no start           | detectable exit, see below                           |
| AppImage, binary started directly, with an AppArmor profile for `/tmp/.mount_*/<executable>` | yes                | namespace sandbox                                    |
| AppImage through the launcher that electron-builder generates                                | no                 | the launcher adds `--no-sandbox` silently            |

**Results:**

- The AppArmor profile for the AppImage mount path works as planned in the [updates architecture](updates.md).
- The launcher that electron-builder generates for AppImages adds `--no-sandbox` whenever `unshare` fails, and the generated desktop entry adds it as well. That contradicts the rule that the sandbox is never switched off silently. Astela's AppImage therefore ships its own launcher: it starts the browser with the sandbox, and only if Chromium refuses to start for lack of a sandbox does it open the local fix page in a restricted mode without web content.
- fpm, which electron-builder uses for deb and rpm, expands the words `NAME`, `VERSION` and `ARCH` in output paths. Packages are therefore built into a temporary directory outside the checkout.

## Linux package repositories

deb and rpm packages of `0.1.0-beta.1`, `0.1.0-beta.2` and `0.1.0` were published in signed repositories: APT with `InRelease`, DNF with signed `repomd.xml`, signed rpm packages and `xml:base` pointing to versioned release directories. The signing key was an Ed25519 GPG key.

| Distribution | Package manager | Install beta.1 | Upgrade to beta.2 | Upgrade to 0.1.0 |
| ------------ | --------------- | -------------- | ----------------- | ---------------- |
| Ubuntu 22.04 | APT             | yes            | yes               | yes              |
| Ubuntu 24.04 | APT             | yes            | yes               | yes              |
| Debian 12    | APT             | yes            | yes               | yes              |
| Debian 13    | APT             | yes            | yes               | yes              |
| Fedora 43    | dnf5 5.2.18     | yes            | yes               | yes              |
| Fedora 44    | dnf5 5.4.3      | yes            | yes               | yes              |

**Result:** [ADR 0015](../adr/0015-linux-package-repositories.md) works as decided. electron-builder 26.18 already writes prerelease versions as `0.1.0~beta.N` for deb and rpm, so they sort before `0.1.0`.

## Web platform API inventory

A sandboxed page in a packaged build listed every global and `navigator` property (about 1,250 globals) and called every global `availability()` function.

**Results:**

- Chromium 156 exposes several on-device language APIs (`LanguageModel`, `Summarizer`, `LanguageDetector`, `Translator`). In Electron they report `unavailable`, and `Translator.availability()` never resolves, because the services behind them are missing. None of them works in Astela, so no setting is needed.
- `navigator.userAgentData.brands` reports `Chromium`, as planned for the user agent.
- With spellchecking at its default, Electron downloaded a dictionary from a Google server at startup. This confirms the decision to switch spellchecking off on Windows and Linux in M1 and to host dictionaries in M2 (see [security](security.md)).

## Restoring tabs with their history, and closing pages

For [ADR 0053](../adr/0053-sleeping-tabs-and-an-exact-session.md), a short script with Electron 45.2.3 on Linux x64 (X11 under Xvfb, software rendering, a container without the sandbox) saved the entries of web views with `navigationHistory.getAllEntries()` to a file, quit, and restored them in a new process with `navigationHistory.restore()` into a new `WebContentsView` of a persistent partition. A local HTTP server served the pages. It ran three times on 2026-11-11.

| Question                                                                       | Result on Linux x64 (X11)                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page states across a restart: scroll position, form values, first paint        | The scroll position, a field and a text area come back; a password field comes back empty. `restore()` resolves after 28 to 30 ms, two frames follow after 44 to 48 ms. Chromium updates the page state 0.9 to 1.0 s after a change. The entries are there as soon as `restore()` returns. |
| A load right after `restore()`                                                 | The restore ends with `ERR_ABORTED`, and the restored entries stay before the new page.                                                                                                                                                                                                    |
| A page state that is not base64, or base64 that Chromium cannot read           | `restore()` resolves and the page loads without its state; nothing crashes.                                                                                                                                                                                                                |
| An entry of another kind: `file:///etc/hostname` in a web view                 | `restore()` loads it.                                                                                                                                                                                                                                                                      |
| `close({ waitForBeforeUnload: true })` on a page with a `beforeunload` handler | `will-prevent-unload` fires and the page stays, with and without sticky user activation; `close()` without waiting ends it.                                                                                                                                                                |
| The same on a renderer that hangs                                              | `will-prevent-unload` does not fire; the contents are destroyed after about 1 s.                                                                                                                                                                                                           |
| Memory after closing a tab of another site in the background                   | Its renderer reported 26.3 to 26.5 MB PSS; the PSS of all processes together fell by 10.9 to 11.6 MB, and its process ended.                                                                                                                                                               |
| Restoring the entry that a form sent with POST                                 | The page loads its address with GET: the server got no second POST, and no load failed; a reload afterwards posts nothing either.                                                                                                                                                          |
| `getTitle()` during a restore                                                  | The stored title of the entry, from the call of `restore()` on; `getURL()` gives the entry's address at once.                                                                                                                                                                              |

**Results:**

- Restoring with `navigationHistory.restore()` works as ADR 0053 plans for tabs that wake: the page comes back at its scroll position with its form values, and Chromium keeps no password in the page state.
- A restore loads whatever address an entry has, so the browser checks every entry against the kind of its view before it restores it, and keeps page states only as base64 text.
- Pages that were sent with a form are not sent again; they show what their address gives.
- The tab shows its stored title while it restores, never its address.
- `will-prevent-unload` does not need sticky user activation here, unlike the dialog of `beforeunload` in Chrome: any page with a handler that cancels stays when the browser asks it to close, and a page that hangs closes after about a second. The reason is in Electron: `close({ waitForBeforeUnload: true })` gives the main frame a user activation (`NotifyUserActivation` in `WebContents::Close`) before it dispatches `beforeunload`, so the page gets a gesture that no person made, with the file chooser, popups, full screen and the clipboard that it unlocks. The automatic sleep therefore never asks a page; it keeps pages awake that people typed into ([ADR 0053](../adr/0053-sleeping-tabs-and-an-exact-session.md)).
- Closing a tab frees about 11 MB of the 26 MB that its renderer reports, because PSS shares the pages that several processes use; budgets for sleeping tabs measure the memory of all processes.
- Not measured here: macOS 15, Windows 2025, and Linux on Wayland with headless Weston, which this machine does not have. The end-to-end tests that restore the history across views, the scroll position and the form of the page (`session.spec.ts`), full screen and the order of windows (`windows.spec.ts`) and the session after a crash, by `SIGKILL` and on Windows by `TerminateProcess` (`session.spec.ts`), run on the CI runners of macOS and Windows. Wayland needs a run by hand.

## Focus between two views of a window

For [ADR 0054](../adr/0054-split-view-with-two-tabs-side-by-side.md), a short script with Electron 45.2.3 (Chromium 156.0.8078.80) on Linux x64 (X11 under Xvfb, software rendering, a container without the sandbox) attached two `WebContentsView`s side by side to one `BaseWindow`, both with `focusOnNavigation: false`, and loaded a page with two fields and a link into each from a local HTTP server. It gave the left view the focus with `webContents.focus()` and recorded the `focus` and `blur` events of both views and `isFocused()` after each step. It ran on 2026-11-11.

| Question                                                                            | Result on Linux x64 (X11)                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| The right page calls `window.focus()` and focuses a field of its own                | The left view keeps the focus; no event fires.                |
| The right page goes to another address of its site by itself                        | The left view keeps the focus; no event fires.                |
| The right page goes to another site by itself, in a new process                     | The left view keeps the focus; no event fires.                |
| Tab, eight times, in the left page with two fields and a link                       | The focus goes round the left page; the right view gets none. |
| `webContents.focus()` of the right view, as the browser does for a click            | `blur` of the left view, `focus` of the right one.            |
| A click of the X server into the left view (`xdotool`)                              | `blur` of the right view, `focus` of the left one.            |
| A third view with `focusOnNavigation: true` loads a page while the window is active | The third view takes the focus when its page commits.         |

**Results:**

- With `focusOnNavigation: false`, only a click into a view, or the browser itself, moves the focus between the views of a window. Electron's `ActivateContents`, which `window.focus()` reaches, only tells its observers, and none listens for a `BaseWindow`; its `TakeFocus` at the end of the Tab order sends the focus round the same page (`FocusThroughTabTraversal`).
- The `focus` event of the web contents is therefore the click into the side of a split view without the focus, and the browser makes that tab the active one on it. No gate on mouse presses through `before-mouse-event` is needed.
- Views keep `focusOnNavigation: true` by default, with which any page that commits in the active window takes the keys; every tab view gets `false`, and the browser gives the page the focus itself where it did before.
- Not measured here: macOS 15, Windows 2025 and Wayland. The end-to-end test in `split-view.spec.ts` checks the same on the CI runners of macOS and Windows: the other side keeps the focus when the page without it navigates, calls `window.focus()`, or when Tab goes past the end of the page with the focus.

## Reader view and picture in picture

For [ADR 0057](../adr/0057-reader-view-and-picture-in-picture-in-isolated-worlds.md), a short script with Electron 45.2.3 (Chromium 156.0.8078.80) on Linux x64 (X11 under Xvfb, software rendering, a container without the sandbox) loaded pages of a local HTTP server into a `WebContentsView` of a persistent partition with a frame preload, as the browser gives every web session one, and ran scripts in world 1002. A second host name of the same server, `localhost`, served a frame of another site, which ran in a process of its own. A 2 s clip of 160×90 pixels in WebM played the videos. Playwright reached the views over the protocol of DevTools, as the end-to-end tests do. It ran on 2026-11-12.

| Question                                                                                                    | Result on Linux x64 (X11)                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (d) Reading the DOM in world 1002 on a page with `require-trusted-types-for 'script'; trusted-types 'none'` | `querySelectorAll`, `textContent`, `checkVisibility`, `getBoundingClientRect` and `createTreeWalker` work; the page's wrappers of these methods and of `cloneNode` see no call. `innerHTML` and `DOMParser` throw a `TypeError`.                                                                                        |
| (b) A call in world 1002 while a frame of the page never finishes loading                                   | `isLoading()` and `isLoadingMainFrame()` are both true after `dom-ready`; the call waits and had no answer after 5 s. The main frame reports `did-frame-finish-load` only after the frame ended.                                                                                                                        |
| (b) A call made while the main frame loads another page                                                     | It runs once that page stopped loading, in that page.                                                                                                                                                                                                                                                                   |
| (c) A `data:` page in a view of the page's session, with a policy of `default-src 'none'`                   | Its inline script does not run; `insertCSS` with `:root:root` wins over its style and `removeInsertedCSS` takes it back; an image of `http` loads where the policy allows `http:`; `findInPage` finds both matches; `printToPDF` prints it; world 1002 runs in it. The frame preload of the session runs in it as well. |
| (c) `setZoomFactor(1.5)` on one `data:` page                                                                | Another `data:` page of the session keeps a zoom of 1.                                                                                                                                                                                                                                                                  |
| (c) Playwright over the protocol of DevTools                                                                | It lists the `data:` page, and `getByRole` and locators read it.                                                                                                                                                                                                                                                        |
| (a) `requestPictureInPicture()` in world 1002 of the main frame                                             | `NotAllowedError` without the activation flag; with `executeJavaScriptInIsolatedWorld(1002, …, true)` the video enters picture in picture, and `document.pictureInPictureElement` is that video.                                                                                                                        |
| (a) `requestPictureInPicture()` in a frame of another site, with `WebFrameMain.executeJavaScript`           | `NotAllowedError` without the flag, picture in picture with `executeJavaScript(…, true)`; the frame's own document reports it, the page's does not.                                                                                                                                                                     |
| (e) `documentPictureInPicture.requestWindow()` with an activation                                           | The window-open handler gets `about:blank`, the disposition `other` and no features; refused there, the page gets an `InvalidStateError`.                                                                                                                                                                               |
| (f) Picture in picture under Xvfb, without a window manager                                                 | `requestPictureInPicture()` resolves and `exitPictureInPicture()` ends it, in the main frame and in the frame; the window itself was not inspected.                                                                                                                                                                     |

**Results:**

- World 1002 keeps the reader's reads away from the page: the page sees neither the calls nor their results, and its `MutationObserver` sees nothing, as the reader writes nothing. Trusted Types apply to the world, so an extractor that sets `innerHTML` or parses HTML, such as Readability, fails on such pages; the browser's own extractor does neither.
- Electron's `executeJavaScriptInIsolatedWorld` waits while the main frame loads (`waitTillCanExecuteJavaScript` with `isLoadingMainFrame()`), and then runs in whatever page has loaded. The load of the main frame waits for its frames, also for one that never ends, and so does a frame that a script adds in the `load` event; a frame that a script adds after the load (300 ms later in the test) keeps `isLoading()` true while `isLoadingMainFrame()` is false, and a call runs at once. The reader checks a page once its main frame has loaded, also when its tab shows while such frames load, gives every call a time limit, and drops an answer whose page changed its address meanwhile.
- A `data:` document in the page's session works as a reader view: its policy stops its scripts, the browser restyles it with `insertCSS`, and find, print and the tests reach it. As the content blocker's frame preload runs in it, the blocker answers reader views with empty rules. Its requests have an opaque origin, no referrer and the `data:` address as their top frame, so the blocker judges them by the page under the reader view.
- Over a `data:` view, `before-mouse-event` reports the mouse's back and forward buttons as `back` and `forward`, although Electron's types name only `left`, `middle` and `right`; Chromium itself goes back only in the history of the view under the pointer, which the reader view does not have.
- The activation flag of Electron counts for `requestPictureInPicture()` in the main frame and in frames of other sites, so the browser process can start picture in picture for a click on its own button.
- A page's Document Picture-in-Picture arrives as a window of the disposition `other`, which the guard of the browser would show as a tab; picture in picture refuses it ([ADR 0057](../adr/0057-reader-view-and-picture-in-picture-in-isolated-worlds.md)).
- Not measured here: macOS 15, Windows 2025 and Wayland. The end-to-end tests of the reader view (`reader.spec.ts`), with world 1002, Trusted Types, the cover, find and print, run on the CI runners of macOS and Windows; so do those of picture in picture (`picture-in-picture.spec.ts`), which check the activation there, in the main frame and in a frame of another site. Whether the window of picture in picture stays above other windows, on macOS also over the simple full screen of a page, and where Wayland places it, needs a check by hand.
