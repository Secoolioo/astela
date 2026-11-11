# When a page does not load

> **Status:** available from 0.1.0-beta.4.

When a page cannot be loaded, Astela says why in place of the page: for example that the computer is offline, that the address of the site was not found, or that the site refused the connection. The error that Chromium reports, such as `ERR_CONNECTION_REFUSED`, is below. The address bar keeps the address, so you can correct it. **Try again** loads the page again, and so do the reload button and the reload shortcut; Back returns to the page before.

If the certificate of a site is not trusted, for example because it was issued for another site, has expired or comes from an unknown authority, Astela warns that the connection isn't private instead of loading the page. **Go back** returns to the page before. Under **Details**, **Continue to** followed by the site's name loads the page anyway; Astela then accepts this certificate for this site until you quit it, and asks again for any other certificate. Organizations can take this way away with the policy `SSLErrorOverrideAllowed`.

If the process that showed a page stops, for example because it ran out of memory, the tab says that the page crashed. **Reload** shows the page again. Other tabs keep their pages.

If a site or a proxy asks for a user name and password, Astela asks for them in a small window above the page and names the site and the area it gives. If the connection is not encrypted, it says so, because others could read what you send; a proxy usually gets them unencrypted, also on the way to an https site, so its question always says so. A tab in the background asks once you show it, not over the tab in front. **Sign in** sends them; **Cancel** or Escape shows the page as the site sends it without signing in.

If a page stops responding, for example because a script runs without end, Astela asks whether to wait for it or to close the page. When the page responds again, the question goes away by itself.

## Sites without a secure connection

From 0.1.0-beta.5, the browser opens sites over HTTPS, also when a link, a bookmark or the address bar names their insecure `http://` address. When a site does not answer securely, the tab shows **This site has no secure connection** in place of the page: others in the network could see or change what you send to such a site and receive from it. **Continue to** loads the insecure address, and the browser does not ask again for that site until it closes; a private window asks on its own. **Go back** returns to the page before.

The browser leaves local addresses as they are: `localhost`, IP addresses, names without a dot such as `router`, and names that end in `.local`, `.localhost`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.example` or `.invalid`. Addresses with a port, such as `http://example.com:8080`, keep it too. The setting **Always use secure connections** under Privacy turns this off; see [settings](settings.md).
