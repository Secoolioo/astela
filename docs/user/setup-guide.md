# Setup guide

> **Status:** available from 0.1.0-beta.3.

The first time you start Astela with a new profile, it opens the setup guide in the first tab, also after an update from an earlier beta. It takes a few steps:

1. **Welcome:** what the guide covers.
2. **Look:** the color mode (System, Light or Dark) and the accent color.
3. **Layout:** from 0.1.0-beta.7, one of the [layouts](layouts.md) Classic, Compact, Zen and Vertical, which sets where the tabs and the address bar are, whether they hide and the density, and whether the bookmarks bar shows. Before, this step chose where the tabs are and the density.
4. **Search:** the search engine of the address bar and the new tab page, or a search address of your own. Continue saves the address that you typed, also without Enter, and stays on the step until it is an `https` address with `%s` where the search words go.
5. **Import:** bookmarks, history and open tabs from the browsers you used before; see [Import from other browsers](import.md).
6. **Blocker and default browser:** the [content blocker](content-blocker.md), which is on from the start, and whether Astela becomes your [default browser](default-browser.md).
7. **Done:** Start browsing shows the new tab page.

The guide has the focus when it opens, so Tab reaches its buttons and choices at once. Every choice applies at once, so the browser around the guide shows it. Back returns to the previous step, and Skip setup ends the guide at any step and keeps what you chose so far. The guide opens by itself only once per profile; to open it again, go to [Settings](settings.md) → Setup → Open the setup guide.

Organizations can keep the guide from opening by itself with the policy `SetupGuideEnabled`; it can still be opened from the settings.
