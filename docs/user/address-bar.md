# Address bar

> **Status:** available from 0.1.0-beta.1; the view of the address and the connection, the loading bar, what you type kept for each tab, and the suggestions from 0.1.0-beta.6; the bar that marks a suggestion from 0.1.0-beta.7.

The address bar takes an address or a search. Press `Ctrl+L` (`Command+L` on macOS) to go to it; see [Keyboard shortcuts](keyboard-shortcuts.md).

## What it shows

- **The connection:** a lock for a page that came over HTTPS with a certificate that Astela trusts, and an icon for the browser's own pages, such as the settings. **Not secure** shows for a page that came without encryption from another computer and for the [warning](page-problems.md) about a certificate that is not trusted. Once you continue past that warning, every page of the site shows **Not secure** too, also in other tabs, as any of them may have come with that certificate: in regular windows until you quit Astela, and in private windows, which keep their own, until the last private window closes. Pages on this computer, such as `localhost`, and pages that could not be loaded or that crashed show nothing.
- **The address:** the host comes first, and `https://` and `http://` are left out, as the connection shows them. Once you click into the field, it shows the whole address, selected, so that typing replaces it.
- **Loading:** a bar along the bottom of the toolbar moves while the active tab loads. When the system asks for reduced motion, it stands still.

## What you type

What you type stays in the address bar of its tab, also when you leave the address bar, until you press Enter, press Esc, which brings back the address of the page, or the page of the tab goes to another address while you are not in its address bar. Switching to another tab with the keyboard shows the address of that tab, and switching back shows what you typed.

A click on **New tab** takes you to the address bar of the new tab at once, also when the tab takes a moment to appear: what you type belongs to the new tab, Enter loads it in the new tab, and the tab you came from keeps its page. After several quick clicks, what you type belongs to the tab of the last click, and what you typed before a further click stays with the tab of the earlier click.

## Suggestions

While you type, a list below the address bar suggests what to open: first what Enter does, a search or an address, then open tabs, bookmarks and pages from your history whose title or address contains every word you typed, up to eight. Typing goes on in the address bar. The arrow keys mark a suggestion, which a bar in the accent color shows at its start, and Enter opens it; a click opens one too. An open tab becomes the active tab instead of opening again. Esc closes the list and keeps what you typed; a second Esc brings back the address of the page.
