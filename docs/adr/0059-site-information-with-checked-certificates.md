# 0059. Site information with the certificates that Chromium checked

## Status

Accepted. Extends [ADR 0034](0034-overlay-view-for-popovers-and-prompts.md) with the content kind `site` and [ADR 0050](0050-browser-menus-and-popovers-in-the-overlay.md) with a popover at the chip of the connection, which gives way to questions of sites. Extends [ADR 0038](0038-site-permissions-asked-in-the-overlay.md): the permissions of a site can also change outside the settings page, in the store of its kind of window. Amends [ADR 0036](0036-problem-pages-drawn-by-the-shell.md): an accepted certificate, and an insecure address opened past HTTPS-First, can be taken back before the browser quits. Updates the certificates section of [security](../architecture/security.md#certificates), which said that the browser does not know which certificate a page came with. Built in 0.1.0-beta.7.

## Date

2026-11-15

## Context

The chip at the start of the address bar tells whether the connection of a page is secure, and nothing more. People cannot see the certificate of a site, which permissions it has, how many cookies it keeps, or take back a certificate that they accepted after the warning; deleting the data of one site needs the settings of the whole browser.

- Electron tells the browser process about a certificate only when Chromium refuses it (`certificate-error`). A page that loads securely comes with no word about its certificate.
- `session.setCertificateVerifyProc()` hands every check of a certificate to the browser process, with Chromium's result. Its answer decides: `0` accepts the certificate and turns Certificate Transparency off, `-2` refuses it, and `-3` keeps Chromium's own result. A session has one such function; setting another one replaces it.
- A spike on Linux under Xvfb, with end-to-end tests that were not merged, found:
  - `--ignore-certificate-errors-spki-list` lets the test certificate load, but Chromium then never asks the verify function for that host, so a test with it sees no certificate;
  - `--ignore-certificate-errors` lets the page load as secure and still asks the verify function, with Chromium's error;
  - after continuing past a warning, later loads of the host reuse the open connection, with no new check and no new `certificate-error`; once the exception ended, a reload over that connection still loaded the page without the warning.
- Electron offers neither the protocol nor the cipher of a connection.

## Decision

### The chip opens site information

- The chip of a web page is a button (`aria-haspopup="dialog"`, the corners of `--radius-1`, the tooltip _Site information_) with its names as before: _Connection is secure_, _Not secure_, and the new _Page on this computer_ with an icon of information for `http` on `localhost`, its subdomains, `127.0.0.0/8` and `[::1]`, which showed no chip before (`app/src/shared/connection.ts`). The browser's own pages keep their icon, which opens nothing.
- A click, Enter or Space opens a popover of 320 px below the chip, at its start (`shell.openSiteInfo`, the content kind `site`, `app/src/ui/overlay/site-info.ts`). It takes the focus itself, Tab stays inside it, and Escape or a click next to it closes it; the focus goes back to the page, or to the chip after the keyboard opened it. A question of a site may take its place. Its button shows as open (`ShellState.popover` of the kind `site`), and it holds rows that hide open.

### What it shows

- **The connection:** secure, not secure, on this computer, a certificate that is not trusted with its reason (the authority, the date, the name, or another error with its code), accepted after the warning with **Turn the warning back on**, or opened without HTTPS past the warning of HTTPS-First with **Use a secure connection again**. A page that came with a certificate that people accepted counts as not trusted after they turned the warning back on, as it may still be that page.
- **The certificate** of an https page and of a warning: whom it was issued to and by, with their organizations, the end of its validity, and under **Details** its start, its SHA-256 fingerprint as pairs of hexadecimal digits and the authorities that it was issued through. The fingerprint is Electron's `fingerprint`, the SHA-256 of the certificate itself, as other browsers and `openssl x509 -fingerprint -sha256` show it; an end-to-end test with a certificate that an authority issued, sent with the authority's certificate, checks this, as the review of the part took it for a hash of the whole chain. A note says when its root was added to the computer, as by an organization: when Chromium trusted the chain and `isIssuedByKnownRoot` is false. When the browser saw no certificate, the popover says so and suggests a reload.
- **For a page that loaded, not for a warning:** the permissions that were decided for the page's origin, each with a switch, with **Reset permissions** and, after a change, a note and **Reload**; the cookies of the site with **Delete cookies and site data…**, which asks in place; the switch of the content blocker for the site with what it blocked on the page; and **Site permissions in the settings**, which opens the settings at `#permissions.sites`.
- **What it does not show:** the protocol and the cipher, which Electron does not offer.

### The certificates that Chromium checked

- **The verify function:** every web session gets one as it is protected (`protectWebSession`, `app/src/platform/electron/certificate-verify.ts`): the default session, `persist:default`, each private session and each partition of a workspace. It answers `-3` first and at once, so Chromium's own result stands, Certificate Transparency included, and only then hands the check to a note; a note that fails changes nothing.
- **The log:** `CertificateLog` (`app/src/platform/electron/certificate-log.ts`) keeps a summary (`certificate-summary.ts`) of the newest check that Chromium trusted and, apart from it, of the newest one that it refused for each host, for the 256 hosts used last in each session, in a `WeakMap` by session, so a private window keeps its sites to itself. Chromium names the host of a check but not its port, so a secure page shows only a trusted certificate of its host, and none when the log has no trusted one: a refused certificate of another port, or of a request of any page that failed, never shows under _Connection is secure_. A warning and a page that came with an accepted certificate fall back to the refused one. With the switch `--ignore-certificate-errors`, Chromium connects whatever certificate a site shows and pages load as secure, so the log counts every check as trusted then. It notes whether the root is known only when Chromium trusted the chain. Electron keeps every session until the browser quits, so once the last private window closed, the code for the requests of web pages forgets what it keeps for that session (`WebRequests.forget`): the log, the exceptions and accepted certificates, the insecure addresses opened past HTTPS-First and the answers about permissions. The log loads with the code for the requests of web pages; the requests of web pages wait for that code, and a check comes only with a request, so none comes before it.
- **Refused and accepted certificates** come from `certificate-error`: `CertificateExceptions` keeps the certificate that a page was refused and its error (`refusedOf`), the one that people accepted for a host in a session (`acceptedOf`), and ends the exceptions of a host (`revoke`). Pages of a host whose certificate was accepted keep counting as covered in that session, also after the warning is back. `HttpsFirst` tells which hosts people opened without HTTPS (`isAllowed`) and sends them to the secure address again (`revoke`).
- **Turning the warning back on** ends the exception, closes the open connections of the session (`session.closeAllConnections()`), which would load the page again with the accepted certificate, and reloads the page, which shows the warning again. Electron documents that this fails every request in flight in the session, in every tab: Chromium closes the HTTP/2 and HTTP/3 sessions with what runs over them, such as loads, media and downloads. A spike found that a download over HTTP/1.1 went on, as Chromium lets a connection that is in use finish. A download that failed stays in the list of downloads, where people can try it again. Chrome closes only the idle connections here, which Electron does not offer, and no call closes the connections of one host.

### Permissions, cookies and data

- **The store of the window:** the setting `permissions.sites` for regular windows and workspaces; for private windows, the memory of the private session, which the code for the requests of web pages keeps (`permissionStore(session)`), so their answers stay out of the setting and end with the last private window. A switch changes only a decided permission; it applies to new requests and checks at once, and to what a page uses already, such as a camera that runs, once it reloads.
- **Managed permissions:** no policy sets or blocks site permissions, so `permissions.sites` has none. Should a policy lock that setting, the switches are disabled and say _Managed by your organization_.
- **Deleting:** in the session of the window, as the page uses it: the regular one, the private one or the partition of the workspace. The cookies of the site, of its domain and of every host under it, whose domain is its registrable domain with the private suffixes of the public suffix list (`getDomain` of `tldts-experimental` with `allowPrivateDomains`, so `you.github.io` is a site of its own), or the host for an address without one, such as `127.0.0.1`, through `cookies.remove()`; then local storage, IndexedDB, service workers, the Cache API and the file system of the page's origin (`clearStorageData({ origin, storages })`), then `cookies.flushStore()`. What other sites keep, also under this one, and the HTTP cache stay.
- **Counting:** all cookies of the session (`session.cookies.get({})`), filtered to the site, also for deleting: `get({ domain })` finds only the cookies that a request to that domain would send, and so leaves out those of the hosts under it, such as a cookie of `www.example.com` for the site `example.com`. The popover opens after 200 ms at most and fills in the count later.

### Only for the site that it shows

Every request of the popover names the number of the time it opened. The browser process acts only while the overlay shows that number, the window's active tab is the one that it opened for, that tab shows the same origin, and so does the page of the tab, also before the tab learned of a new page. Otherwise it acts on nothing and the popover follows the page; it closes once the tab shows another site. It also follows changes of the page, at most every 50 ms, and of the settings `permissions.sites` and `contentBlocker.*`.

### The content blocker

`app/src/main/site-blocking.ts` handles `overlay.toggleSiteBlocking` once for the shield's popover and for site information, and each refreshes itself; site information names its number there too.

### Loading

Only the verify function, the wiring of `shell.openSiteInfo` with the name of its channel, and the kind `site` of the popovers of the shell are on the start path of the browser process: it grew by 387 bytes, from 148,704 to 149,091 bytes, and by 13 more with the fixes of the review, to 149,104 bytes, for the call that forgets the notes of the private session. `site-info.ts` and `site-blocking.ts` load with the first popover, the log with the code for the requests of web pages, and the list of suffixes with the first count.

### Confirmed on Linux, open on the other systems

On Linux with X11 under Xvfb, the end-to-end tests (`site-info.spec.ts`) check a secure page with its certificate, a page without encryption, a page on this computer, a warning with its reason and certificate, the fingerprint of a certificate that an authority issued, that a certificate that Chromium refused for another port of the host never shows under a secure page, turning the warning and HTTPS-First back on, Tab and Shift+Tab inside the popover, the permissions in a regular and in a private window, the settings at the permissions of sites, counting and deleting cookies and data while another site and a private window keep theirs, with the site of a host under a private suffix, the question about deleting while the popover follows the page, the switch of the content blocker, and a change that comes once Chromium shows another site, before the tab learned of it, and after it. Windows and macOS check certificates with the system, which may look for missing issuers first; only their CI runners can confirm the times there. The note about a root that was added to the computer needs a root that Chromium trusts but does not know; the tests have none, so only a check by hand with an added root, such as one of an organization, shows it.

### Deviations from the design

- The design numbered this record 0050, and the plan 0057; the records that came first took those numbers.
- The design attaches the whole `CertificateLog` in `protectWebSession`. Only a small function is there; the log loads with the code for the requests of web pages, which the requests wait for, so the start path grew by 400 bytes instead of about 0.8 KiB. A test that sets its own verify function after the start replaces it, as the design expected.
- The secure-page test uses `--ignore-certificate-errors` instead of `--ignore-certificate-errors-spki-list`, which the spike found to skip the verify function. Chromium then does not trust the certificate, so the test shows no note about the root.
- The log keeps `isIssuedByKnownRoot` only for checks that Chromium trusted, as Electron's documentation says that it means nothing otherwise.
- Deleting leaves out the shader cache, which Chromium clears for every site at once, and Web SQL, which Chromium no longer has.
- The requests name the number of the popover, which the design did not have, so a click that the page sends while it still shows an older popover acts on nothing. The browser also compares the origin of the page itself, not only that of the tab. The popover closes when the tab shows another site, instead of showing that site.
- One request, `overlay.restoreWarnings`, turns the warning of a certificate and that of HTTPS-First back on, as the popover shows only one of them. It closes the open connections of the session, which the design did not have: the spike found that the reload would use the open connection again without a check.
- The design keeps the private store in the composition root; the code keeps it in the code for the requests of web pages, next to the handler of the private session.
- The cookies count by the registrable domain with the private suffixes, so the site of `you.github.io` is not `github.io`.
- The review of the part found that the log let a refused check of a host replace the trusted one that a secure page came with, so it keeps them apart, and that it kept the notes of each private session until the browser quit, so they go with the session. Its test of the cookies of a site found that the count and the deletion missed the cookies of the hosts under the site, so they read all cookies of the session. The design did not have these.

## Consequences

Positive:

- People see the connection, the certificate, the permissions and the cookies of a site in one place, and change them there.
- A certificate that people accepted, and an insecure address that they opened, can be taken back without quitting.
- Chromium's decisions about certificates do not change; the browser only notes them.

Negative:

- A page that came from the cache or over a connection that was open before the start of the log has no certificate in it.
- Turning the warning back on closes the open connections of the session, so loads, media and downloads that run over them at that moment, also in other tabs and windows of the session, can fail; they do not start again by themselves.
- Pages of a host whose certificate was accepted count as not secure until the session ends, also once the warning is back.
- A test, or anything else, that sets its own verify function on a session ends the log there.

## Alternatives considered

- **The `Security` and `Network` domains of the DevTools protocol through `webContents.debugger`:** the state that Chrome shows lives in Chrome's own layer, and the debugger conflicts with open DevTools.
- **Connections of Node with TLS to the site:** another store of roots, around the proxy and DNS over HTTPS, and requests of their own to the site.
- **`dialog.showCertificateTrustDialog`:** it offers to trust a certificate.
- **The verify function answers `0` for certificates it trusts:** that turns Certificate Transparency off.
- **Clearing the data of an origin with `clearStorageData` and its cookies option:** it deletes the cookies of the host only, not those of the site.
