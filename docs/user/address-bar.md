# Address bar

> **Status:** available from 0.1.0-beta.1; the view of the address and the connection, the loading bar, what you type kept for each tab, and the suggestions from 0.1.0-beta.6; the bar that marks a suggestion, site information and the chip of pages on this computer from 0.1.0-beta.7.

The address bar takes an address or a search. Press `Ctrl+L` (`Command+L` on macOS) to go to it; see [Keyboard shortcuts](keyboard-shortcuts.md).

## What it shows

- **The connection:** a lock for a page that came over HTTPS with a certificate that Astela trusts, and an icon for the browser's own pages, such as the settings. **Not secure** shows for a page that came without encryption from another computer and for the [warning](page-problems.md) about a certificate that is not trusted. Once you continue past that warning, every page of the site shows **Not secure** too, also in other tabs, as any of them may have come with that certificate: in regular windows until you quit Astela, and in private windows, which keep their own, until the last private window closes. From 0.1.0-beta.7, pages that this computer serves without encryption, such as `http://localhost`, show an icon of information named **Page on this computer**. Pages that could not be loaded or that crashed show nothing.
- **Site information:** from 0.1.0-beta.7, a click on the connection of a web page, or Enter or Space once it has the focus, opens [site information](#site-information).
- **The address:** the host comes first, and `https://` and `http://` are left out, as the connection shows them. Once you click into the field, it shows the whole address, selected, so that typing replaces it.
- **Loading:** a bar along the bottom of the toolbar moves while the active tab loads. When the system asks for reduced motion, it stands still.

## Site information

Site information opens below the connection and names the site with its port, if it has one. Escape or a click next to it closes it; the focus goes back to the page, or to the connection when you opened it with the keyboard. A question of a site, such as for the camera, takes its place.

- **The connection:** whether what you send travels encrypted, whether the page comes from this computer, or why the certificate of the site is not trusted: its authority is not trusted, it has expired or is not valid yet, it was issued for another site, or it could not be checked, with the error.
- **Turn the warning back on:** after you continued past the warning about a certificate, this takes the exception back for the site and loads the page again, which shows the warning again. For this, Astela closes the connections that are open in this kind of window. What loads over them at that moment, also in other tabs of its windows, such as a page, a video or a download, can stop with an error; a download that stopped can be tried again in the list of downloads.
- **Use a secure connection again:** after you opened a site without a secure connection past the [warning](page-problems.md#sites-without-a-secure-connection), this sends the site to HTTPS again and loads the page, which shows the warning again.
- **The certificate** of an HTTPS page and of a warning: whom it was issued to and by, until when it is valid, and under **Details** since when, its SHA-256 fingerprint, which you can select, and the authorities that it was issued through. When its authority was added to this computer, for example by your organization, Astela says so. Astela sees the certificate when it connects to the site; a page that came from the cache, or over a connection that was open before, may show none until you reload it. The protocol and the cipher of the connection do not show.
- For a page that loaded, not for a warning: its [permissions](site-permissions.md#in-site-information), its [cookies and site data](#cookies-and-site-data), the [content blocker](content-blocker.md) on the site, and **Site permissions in the settings**, which opens the settings at the permissions of sites.

### Cookies and site data

Site information counts the cookies of the site: of its domain, such as `example.com` for `www.example.com`, and of the hosts below it; a site under a shared domain, such as `you.github.io`, counts as a site of its own. **Delete cookies and site data…** asks first, in place, as this signs you out of the site; **Delete** then deletes the site's cookies and the local storage, IndexedDB, service workers, caches of the Cache API and file system data of the page's origin. It deletes them only where the window keeps them: in regular windows, in private windows, or in a [workspace](workspaces.md) that keeps its cookies apart. Other sites keep their data, also what they keep while they are embedded in this site, and so does the cache of the browser.

## What you type

What you type stays in the address bar of its tab, also when you leave the address bar, until you press Enter, press Esc, which brings back the address of the page, or the page of the tab goes to another address while you are not in its address bar. Switching to another tab with the keyboard shows the address of that tab, and switching back shows what you typed.

A click on **New tab** takes you to the address bar of the new tab at once, also when the tab takes a moment to appear: what you type belongs to the new tab, Enter loads it in the new tab, and the tab you came from keeps its page. After several quick clicks, what you type belongs to the tab of the last click, and what you typed before a further click stays with the tab of the earlier click.

## Suggestions

While you type, a list below the address bar suggests what to open: first what Enter does, a search or an address, then open tabs, bookmarks and pages from your history whose title or address contains every word you typed, up to eight. Typing goes on in the address bar. The arrow keys mark a suggestion, which a bar in the accent color shows at its start, and Enter opens it; a click opens one too. An open tab becomes the active tab instead of opening again. The open tabs come from every [workspace](workspaces.md) of the window, and choosing a tab of another workspace shows that workspace. Esc closes the list and keeps what you typed; a second Esc brings back the address of the page.
