# When a page does not load

> **Status:** available from 0.1.0-beta.4.

When a page cannot be loaded, Astela says why in place of the page: for example that the computer is offline, that the address of the site was not found, or that the site refused the connection. The error that Chromium reports, such as `ERR_CONNECTION_REFUSED`, is below. The address bar keeps the address, so you can correct it. **Try again** loads the page again, and so do the reload button and the reload shortcut; Back returns to the page before.

If the certificate of a site is not trusted, for example because it was issued for another site, has expired or comes from an unknown authority, Astela warns that the connection isn't private instead of loading the page. **Go back** returns to the page before. Under **Details**, **Continue to** followed by the site's name loads the page anyway; Astela then accepts this certificate for this site until you quit it, and asks again for any other certificate. From 0.1.0-beta.6, the [address bar](address-bar.md) shows **Not secure** for the warning and, once you continued, for every page of this site until you quit Astela. From 0.1.0-beta.7, a click on **Not secure** opens [site information](address-bar.md#site-information), which says why the certificate is not trusted and whom it was issued to; once you continued, its **Turn the warning back on** shows the warning again. Organizations can take this way away with the policy `SSLErrorOverrideAllowed`.

If the process that showed a page stops, for example because it ran out of memory, the tab says that the page crashed. **Reload** shows the page again. Other tabs keep their pages.

With the keyboard, Tab goes round the toolbar and the buttons of the message. From 0.1.0-beta.7, `F6` and `Shift+F6` on Windows and Linux go from the toolbar to the first button of the message and from there back to the address bar, as they go between the toolbar and a page; see [Keyboard shortcuts](keyboard-shortcuts.md#the-toolbar-the-tabs-and-the-page).

In a [split view](tabs.md#split-view), each side shows why its own page did not load, in its own half of the window, and its buttons, such as **Try again**, act on that side; a click there gives that side the focus.

If a site or a proxy asks for a user name and password, Astela asks for them in a small window above the page and names the site and the area it gives. If the connection is not encrypted, it says so, because others could read what you send; a proxy usually gets them unencrypted, also on the way to an https site, so its question always says so. A tab in the background asks once you show it, not over the tab in front; in a split view, the side without the focus asks once you click into it, and the window shows over its side. **Sign in** sends them; **Cancel** or Escape shows the page as the site sends it without signing in.

If a page stops responding, for example because a script runs without end, Astela asks whether to wait for it or to close the page. When the page responds again, the question goes away by itself.

## Protected video and music

Astela cannot play video and music yet that sites protect with Widevine, a kind of digital rights management: Netflix, Disney+, Prime Video, Spotify, Apple Music and similar services. Such a site shows an error of its own instead, often with a code. From 0.1.0-beta.7, Astela says so with a quiet sign in the address bar while you look at the page; its popover says why and links here. The sign goes once the page plays media or you go to another page, and a page that already played media gets none, because players and scripts also ask for protected playback that they do not need. Video and music that are not protected, such as on YouTube or a trailer, play as usual. Whether Astela gets a build that can play protected media is decided for a later milestone; see the [roadmap](../roadmap.md).

## Messages and questions of pages

From 0.1.0-beta.7, when a page shows a message or asks something, as with `alert()`, `confirm()` or `prompt()`, Astela asks in a small window at the top of the page, which names the site that asks, such as _example.com says_, or _An embedded page at example.net says_ for a part of the page from another site. **OK** answers, and Enter does too; **Cancel** and Escape refuse. The question covers only the page of its tab: you can still switch to another tab, close the tab with its close button or Ctrl+W (Command+W on macOS), open a menu or type in the address bar, while the question waits over the page. A page in a tab in the background never waits for you: its message shows once you show the tab, and when it asks something, such as whether to go on, it gets **Cancel** at once, as in other browsers. When the page loads another page or its tab closes, the question goes.

If a site asks again and again, as pages that claim that your computer is infected do, the question offers **Don't let this site show more dialogs** from the second time that the page asks on, also when parts of the page from other sites ask. Tick it and choose **OK**: the page and its parts show no more of them until the tab loads another page. You can also close the tab at any time. Never call a phone number that such a page shows.

## Leaving a page with changes that are not saved

From 0.1.0-beta.7, when you leave a page that has changes that it has not saved, such as a message that you are writing, Astela asks first whether to leave the site: with the address bar, Back, a link of the page, or Reload and F5, which ask whether to reload it. **Stay** keeps the page with what you typed; **Leave** or **Reload** goes on. When you close the tab of such a page after typing into it, Astela asks the same, with **Leave** and **Cancel**. A page asks this only after you used it, and only the page decides whether it has changes. While the question shows, the other windows of Astela wait for it.

If you close a tab by mistake, **Reopen closed tab** (Ctrl+Shift+T, Command+Shift+T on macOS) brings it back with its back history and the text that you typed, as far as the page keeps it; see [tabs](tabs.md#reopening-closed-tabs).

## Sites without a secure connection

From 0.1.0-beta.5, the browser opens sites over HTTPS, also when a link, a bookmark or the address bar names their insecure `http://` address. When a site does not answer securely, or gives no answer within 10 seconds, the tab shows **This site has no secure connection** in place of the page: others in the network could see or change what you send to such a site and receive from it. **Continue to** loads the insecure address, and the browser does not ask again for that site until it closes; a private window asks on its own. From 0.1.0-beta.7, **Use a secure connection again** in [site information](address-bar.md#site-information) takes that back. **Go back** returns to the page before.

The browser leaves local addresses as they are: `localhost`, IP addresses, names without a dot such as `router`, names that end in `.local`, `.localhost`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.example` or `.invalid`, and names under no public suffix, such as the `fritz.box` of a router or `printer.corp` in a company network. Addresses with a port, such as `http://example.com:8080`, keep it too. The setting **Always use secure connections** under Privacy turns this off; see [settings](settings.md).
