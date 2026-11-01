# Default browser and links from other apps

> **Status:** available from 0.1.0-beta.3.

## Links from other apps

When another app opens a web link with Astela, for example from an email or a chat, the link opens in a new tab of the browser window you used last, and that window comes to the front. If Astela was not running, it starts with the link; tabs of the last session are restored next to it. Astela opens only `http` and `https` links this way.

To open links from a script, pass them after `--`, for example `astela -- https://example.com/`; everything after `--` counts as a link and never as a switch. On Windows, Astela does not start when another argument follows a link that does not come after `--`.

On Linux, the desktop entry of the deb and rpm packages and of the AppImage registers Astela for web links, so the system can offer it as the default browser. On macOS, the app registers itself for web links as well.
