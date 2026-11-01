# Import from other browsers

> **Status:** available from 0.1.0-beta.3.

Astela imports bookmarks, history and open tabs from the browsers you used before. It finds them by itself:

- **Chromium-based browsers:** Google Chrome, Microsoft Edge, Brave, Vivaldi, Opera, Opera GX and Chromium.
- **Firefox-based browsers:** Firefox, Zen, LibreWolf, Floorp and Waterfox.

On Linux, Astela also finds the Flatpak packages of Chrome, Edge, Brave, Vivaldi, Chromium, Firefox, Zen and LibreWolf, and the Snap packages of Chromium and Firefox. Each profile of a browser appears on its own line.

To import, go to [Settings](settings.md) → Import from another browser, or use the import step of the [setup guide](setup-guide.md). Choose what to import, then choose **Import** next to a browser:

- **Bookmarks** go into a folder of the other bookmarks named after the browser, such as "Imported from Firefox", with the profile's name when the browser has more than one. Importing the same profile again replaces that folder, as long as it is still in the other bookmarks.
- **History** adds the pages you visited, at most the 100,000 most recent. Pages that are already in the history keep their newer visit, so importing again changes nothing.
- **Open tabs** open in new windows; only the tab that was active in each window loads at once. Open tabs can be imported from Firefox-based browsers.

The other browser stays as it is: Astela reads copies of its files. If a browser keeps its files locked while it runs, the import says that some data could not be read; close that browser and import again.

Astela never imports cookies or saved passwords. Passwords will follow with the password manager.

Organizations can turn the import off with the policy `ImportEnabled`.
