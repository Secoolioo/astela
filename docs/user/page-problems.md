# When a page does not load

> **Status:** available from 0.1.0-beta.4.

When a page cannot be loaded, Astela says why in place of the page: for example that the computer is offline, that the address of the site was not found, or that the site refused the connection. The error that Chromium reports, such as `ERR_CONNECTION_REFUSED`, is below. The address bar keeps the address, so you can correct it. **Try again** loads the page again, and so do the reload button and the reload shortcut; Back returns to the page before.

If the certificate of a site is not trusted, for example because it was issued for another site, has expired or comes from an unknown authority, Astela warns that the connection isn't private instead of loading the page. **Go back** returns to the page before. Under **Details**, **Continue to** followed by the site's name loads the page anyway; Astela then accepts this certificate for this site until you quit it, and asks again for any other certificate. Organizations can take this way away with the policy `SSLErrorOverrideAllowed`.

If the process that showed a page stops, for example because it ran out of memory, the tab says that the page crashed. **Reload** shows the page again. Other tabs keep their pages.

If a page stops responding, for example because a script runs without end, Astela asks whether to wait for it or to close the page. When the page responds again, the question goes away by itself.
