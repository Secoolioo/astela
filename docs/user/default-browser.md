# Default browser and links from other apps

> **Status:** available from 0.1.0-beta.3.

## Make Astela your default browser

Go to [Settings](settings.md) → Default browser, or to the last step but one of the [setup guide](setup-guide.md), and choose **Make default**:

- **Windows:** Windows lets only you choose the default browser. The Windows settings open on the page of Astela; choose it there for web links. The installer registers Astela with Windows for this, and the uninstaller removes the registration. MSI installations are not registered; organizations set the default browser of their computers with their own tools.
- **macOS:** macOS asks whether to use Astela or keep the current browser.
- **Linux:** Astela becomes the default for web links through `xdg-settings`.

Once Astela is the default browser, the setting says so. Organizations can keep users from changing it with the policy `DefaultBrowserSettingEnabled`; the setting then shows that the organization manages it.

An AppImage and an MSI installation cannot become the default browser, and the setting says so: an AppImage has no installed desktop entry that the system could open links with, and MSI installations are not registered with Windows. Install the deb or rpm package, or use the Windows installer, to make Astela the default browser.

## Links from other apps

When another app opens a web link with Astela, for example from an email or a chat, the link opens in a new tab of the browser window you used last, and that window comes to the front. If Astela was not running, it starts with the link; tabs of the last session are restored next to it. Astela opens only `http` and `https` links this way.

To open links from a script, pass them after `--`, for example `astela -- https://example.com/`; everything after `--` counts as a link and never as a switch. On Windows, Astela does not start when another argument follows a link that does not come after `--`.

On Linux, the desktop entry of the deb and rpm packages registers Astela for web links, so the system can offer it as the default browser. On macOS, the app registers itself for web links as well.
