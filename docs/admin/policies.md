# Policy reference

This page lists every policy of Astela. `tools/policies/reference.ts` writes it from the policy definitions of the browser, and `pnpm verify` fails when it no longer matches them. The [admin guide](README.md) says where the policies are stored, which value wins and how to check that they apply. The [JSON Schema](policies.schema.json) of the policy files of Linux lists the same policies.

A policy that is not on this page is unknown to this version. The browser ignores it, as it ignores every value that is not valid, and writes a `Policy value ignored` record to its log.

- **Levels:** a mandatory policy sets a value and locks it; a recommended policy sets the value that people start from and may change. A policy that is mandatory only is ignored as a recommended value. On macOS, every value of a configuration profile is mandatory.
- **Sensitive:** a sensitive policy applies only from machine-wide mandatory sources: `HKLM` on Windows, a profile for the whole computer on macOS, and the files in `/etc/astela/policies/managed/` on Linux.
- **Restart needed:** the policy takes effect when the browser starts again.
- **Windows:** booleans are `REG_DWORD` values `1` or `0`, numbers `REG_DWORD`, and texts `REG_SZ`. A list is a key named after the policy, with the entries as `REG_SZ` values named `1`, `2` and so on. Recommended values go below the key `Recommended`. The `reg add` lines are for a command prompt of an administrator; in a batch file, write every `%` twice.

| Policy                                                                    | Setting                          | Levels                   | Sensitive |
| ------------------------------------------------------------------------- | -------------------------------- | ------------------------ | --------- |
| [ApplicationLocaleValue](#applicationlocalevalue)                         | `i18n.language`                  | mandatory or recommended | no        |
| [AutoHideToolbar](#autohidetoolbar)                                       | `toolbar.autoHide`               | mandatory or recommended | no        |
| [AutoUpdateCheckPeriodMinutes](#autoupdatecheckperiodminutes)             |                                  | mandatory only           | no        |
| [BlockThirdPartyCookies](#blockthirdpartycookies)                         | `privacy.blockThirdPartyCookies` | mandatory or recommended | no        |
| [BookmarkBarEnabled](#bookmarkbarenabled)                                 | `bookmarks.bar`                  | mandatory or recommended | no        |
| [CommandPaletteEnabled](#commandpaletteenabled)                           | `commandPalette.enabled`         | mandatory or recommended | no        |
| [ContentBlockerAnnoyancesEnabled](#contentblockerannoyancesenabled)       | `contentBlocker.annoyances`      | mandatory or recommended | no        |
| [ContentBlockerCookieNoticesEnabled](#contentblockercookienoticesenabled) | `contentBlocker.cookieNotices`   | mandatory or recommended | no        |
| [ContentBlockerEnabled](#contentblockerenabled)                           | `contentBlocker.enabled`         | mandatory or recommended | no        |
| [DefaultBrowserSettingEnabled](#defaultbrowsersettingenabled)             |                                  | mandatory only           | no        |
| [DefaultSearchProviderSearchURL](#defaultsearchprovidersearchurl)         | `search.urlTemplate`             | mandatory only           | yes       |
| [DeveloperToolsAvailability](#developertoolsavailability)                 |                                  | mandatory only           | no        |
| [DnsOverHttpsMode](#dnsoverhttpsmode)                                     | `network.secureDns`              | mandatory only           | yes       |
| [DnsOverHttpsTemplates](#dnsoverhttpstemplates)                           | `network.secureDnsTemplates`     | mandatory only           | yes       |
| [DownloadDirectory](#downloaddirectory)                                   | `downloads.folder`               | mandatory or recommended | no        |
| [HomepageLocation](#homepagelocation)                                     | `home.page`                      | mandatory or recommended | no        |
| [HttpAllowlist](#httpallowlist)                                           | `privacy.httpAllowlist`          | mandatory only           | no        |
| [HttpsOnlyMode](#httpsonlymode)                                           | `privacy.httpsFirst`             | mandatory only           | no        |
| [ImportEnabled](#importenabled)                                           |                                  | mandatory only           | no        |
| [PictureInPictureEnabled](#pictureinpictureenabled)                       | `pictureInPicture.enabled`       | mandatory or recommended | no        |
| [PrivateModeAvailability](#privatemodeavailability)                       |                                  | mandatory only           | no        |
| [PromptForDownloadLocation](#promptfordownloadlocation)                   | `downloads.ask`                  | mandatory or recommended | no        |
| [ReaderViewEnabled](#readerviewenabled)                                   | `reader.enabled`                 | mandatory or recommended | no        |
| [RestoreOnStartup](#restoreonstartup)                                     | `startup.page`                   | mandatory or recommended | no        |
| [RestoreOnStartupURLs](#restoreonstartupurls)                             | `startup.urls`                   | mandatory or recommended | no        |
| [SetupGuideEnabled](#setupguideenabled)                                   |                                  | mandatory only           | no        |
| [ShowHomeButton](#showhomebutton)                                         | `home.button`                    | mandatory or recommended | no        |
| [SleepingTabsEnabled](#sleepingtabsenabled)                               | `tabs.sleep`                     | mandatory or recommended | no        |
| [SleepingTabsTimeout](#sleepingtabstimeout)                               | `tabs.sleepAfter`                | mandatory or recommended | no        |
| [SplitViewEnabled](#splitviewenabled)                                     | `splitView.enabled`              | mandatory or recommended | no        |
| [SSLErrorOverrideAllowed](#sslerroroverrideallowed)                       |                                  | mandatory only           | no        |
| [TabStripPosition](#tabstripposition)                                     | `tabs.position`                  | mandatory or recommended | no        |
| [TargetChannel](#targetchannel)                                           |                                  | mandatory only           | no        |
| [TargetVersionPrefix](#targetversionprefix)                               |                                  | mandatory only           | no        |
| [ToolbarPlacement](#toolbarplacement)                                     | `toolbar.placement`              | mandatory or recommended | no        |
| [UpdatePolicy](#updatepolicy)                                             |                                  | mandatory only           | no        |
| [UpdateURL](#updateurl)                                                   |                                  | mandatory only           | yes       |
| [WorkspacesEnabled](#workspacesenabled)                                   | `workspaces.enabled`             | mandatory or recommended | no        |

## ApplicationLocaleValue

The language of the menus, dialogs and pages of the browser: `system`, or a language code such as `en` or `de`.

- Value: string (must be system or a language code)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: yes
- Setting: `i18n.language`

A code without a translation shows English. Unlike in Chromium, a code with a region, such as `de-DE`, is not valid.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ApplicationLocaleValue": "de"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ApplicationLocaleValue /t REG_SZ /d "de" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ApplicationLocaleValue</key>
<string>de</string>
```

## AutoHideToolbar

Whether the tabs and the toolbar hide until they are needed, with the tab strip at the top and never in popups.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `toolbar.autoHide`

As a mandatory policy, it also keeps the command that turns the hiding on and off from running, and the layout presets of the settings page and the setup guide that would change it cannot be chosen.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "AutoHideToolbar": true
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v AutoHideToolbar /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>AutoHideToolbar</key>
<true/>
```

## AutoUpdateCheckPeriodMinutes

The minutes between two automatic checks for updates.

- Value: integer (at least 60; at most 43200)
- Levels: mandatory only
- Sensitive: no
- Restart needed: yes
- Setting: none

Without the policy, the browser checks every 240 minutes.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "AutoUpdateCheckPeriodMinutes": 1440
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v AutoUpdateCheckPeriodMinutes /t REG_DWORD /d 1440 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>AutoUpdateCheckPeriodMinutes</key>
<integer>1440</integer>
```

## BlockThirdPartyCookies

Keeps cookies away from requests, responses, frames and workers of other sites than the one of the page.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: yes
- Setting: `privacy.blockThirdPartyCookies`

Chromium blocks them from the next start of the browser, with the policies that the last start read. Private windows always block them.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "BlockThirdPartyCookies": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v BlockThirdPartyCookies /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>BlockThirdPartyCookies</key>
<false/>
```

## BookmarkBarEnabled

Shows or hides the bookmarks bar.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `bookmarks.bar`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "BookmarkBarEnabled": true
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v BookmarkBarEnabled /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>BookmarkBarEnabled</key>
<true/>
```

## CommandPaletteEnabled

Turns the command palette and tab search on or off. While it is off, their shortcuts reach web pages.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `commandPalette.enabled`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "CommandPaletteEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v CommandPaletteEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>CommandPaletteEnabled</key>
<false/>
```

## ContentBlockerAnnoyancesEnabled

Turns the optional list of the content blocker against annoyances on or off.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `contentBlocker.annoyances`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ContentBlockerAnnoyancesEnabled": true
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ContentBlockerAnnoyancesEnabled /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ContentBlockerAnnoyancesEnabled</key>
<true/>
```

## ContentBlockerCookieNoticesEnabled

Turns the optional list of the content blocker against cookie notices on or off.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `contentBlocker.cookieNotices`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ContentBlockerCookieNoticesEnabled": true
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ContentBlockerCookieNoticesEnabled /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ContentBlockerCookieNoticesEnabled</key>
<true/>
```

## ContentBlockerEnabled

Turns the content blocker on or off.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `contentBlocker.enabled`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ContentBlockerEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ContentBlockerEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ContentBlockerEnabled</key>
<false/>
```

## DefaultBrowserSettingEnabled

`false` keeps people from making the browser their default browser. The setting then says that the organization manages it, and the browser refuses the change.

- Value: boolean
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: none

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "DefaultBrowserSettingEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v DefaultBrowserSettingEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>DefaultBrowserSettingEnabled</key>
<false/>
```

## DefaultSearchProviderSearchURL

The search address of the address bar and the new tab page.

- Value: string (at most 2048 characters; must be an https URL with %s)
- Levels: mandatory only
- Sensitive: yes, applies only from machine-wide mandatory sources
- Restart needed: no
- Setting: `search.urlTemplate`

An https address with `%s` where the search terms go, such as `https://search.example.com/search?q=%s`. Chrome's `{searchTerms}` is not supported.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "DefaultSearchProviderSearchURL": "https://search.example.com/search?q=%s"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v DefaultSearchProviderSearchURL /t REG_SZ /d "https://search.example.com/search?q=%s" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>DefaultSearchProviderSearchURL</key>
<string>https://search.example.com/search?q=%s</string>
```

## DeveloperToolsAvailability

`2` keeps the developer tools closed: F12, Inspect in the context menu and the menu items do nothing. `0` and `1` allow them for web pages, as in Chromium.

- Value: integer (one of `0`, `1`, `2`)
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: none

The pages of the browser itself never get the developer tools.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "DeveloperToolsAvailability": 2
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v DeveloperToolsAvailability /t REG_DWORD /d 2 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>DeveloperToolsAvailability</key>
<integer>2</integer>
```

## DnsOverHttpsMode

How the browser looks up the addresses of sites: `automatic` uses DNS over HTTPS with the services of `DnsOverHttpsTemplates` or, without them, where the provider of the system offers it; `secure` only with the services of `DnsOverHttpsTemplates`; `off` never.

- Value: string (one of `automatic`, `secure`, `off`)
- Levels: mandatory only
- Sensitive: yes, applies only from machine-wide mandatory sources
- Restart needed: no
- Setting: `network.secureDns`

`secure` without a service works like `automatic`.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "DnsOverHttpsMode": "secure"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v DnsOverHttpsMode /t REG_SZ /d "secure" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>DnsOverHttpsMode</key>
<string>secure</string>
```

## DnsOverHttpsTemplates

The DNS over HTTPS services that `DnsOverHttpsMode` uses: `https://` URI templates, separated by spaces.

- Value: string (at most 2048 characters; must be addresses of DNS over HTTPS services)
- Levels: mandatory only
- Sensitive: yes, applies only from machine-wide mandatory sources
- Restart needed: no
- Setting: `network.secureDnsTemplates`

Templates that Chromium would refuse, such as ones with unbalanced braces or a variable in the host, are not valid.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "DnsOverHttpsTemplates": "https://dns.example.com/dns-query{?dns}"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v DnsOverHttpsTemplates /t REG_SZ /d "https://dns.example.com/dns-query{?dns}" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>DnsOverHttpsTemplates</key>
<string>https://dns.example.com/dns-query{?dns}</string>
```

## DownloadDirectory

The folder where downloads are saved; empty for the downloads folder of the system.

- Value: string (at most 4096 characters; must be an absolute path)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `downloads.folder`

Unlike in Chromium, variables such as `${user_home}` are not replaced.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "DownloadDirectory": "/srv/downloads"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v DownloadDirectory /t REG_SZ /d "D:\Downloads" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>DownloadDirectory</key>
<string>/srv/downloads</string>
```

## HomepageLocation

The page of the home button and of its shortcut, as an http or https address; empty for the new tab page.

- Value: empty or string (at most 8192 characters; must be a web address)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `home.page`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "HomepageLocation": "https://intranet.example.com/"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v HomepageLocation /t REG_SZ /d "https://intranet.example.com/" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>HomepageLocation</key>
<string>https://intranet.example.com/</string>
```

## HttpAllowlist

Hosts that HTTPS-First leaves on their insecure address, such as `intranet.example.com`. `[*.]example.com` and `*.example.com` also name every host below `example.com`.

- Value: list of strings (each must match `^(?:\[\*\.\]|\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*$`, in any case; at most 1000 entries)
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: `privacy.httpAllowlist`

IP addresses, names without a dot and names that end in `.localhost`, `.local`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.example`, `.invalid` are never upgraded and need no entry.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "HttpAllowlist": ["intranet.example.com", "[*.]example.org"]
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela\HttpAllowlist" /v 1 /t REG_SZ /d "intranet.example.com" /f
reg add "HKLM\SOFTWARE\Policies\Astela\HttpAllowlist" /v 2 /t REG_SZ /d "[*.]example.org" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>HttpAllowlist</key>
<array>
  <string>intranet.example.com</string>
  <string>[*.]example.org</string>
</array>
```

## HttpsOnlyMode

Whether HTTPS-First loads sites over HTTPS and warns before an insecure connection: `disallowed` turns it off, `force_enabled` and `force_balanced_enabled` keep it on.

- Value: string (one of `disallowed`, `force_enabled`, `force_balanced_enabled`)
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: `privacy.httpsFirst`

The browser has one mode, so both values that keep it on do the same. Chrome's `allowed`, which leaves the choice to people, is not valid.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "HttpsOnlyMode": "disallowed"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v HttpsOnlyMode /t REG_SZ /d "disallowed" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>HttpsOnlyMode</key>
<string>disallowed</string>
```

## ImportEnabled

`false` turns off the import from other browsers, on the settings page and in the setup guide.

- Value: boolean
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: none

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "ImportEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ImportEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ImportEnabled</key>
<false/>
```

## PictureInPictureEnabled

Turns the picture in picture of the browser on or off: its button next to the address bar and its menu items.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `pictureInPicture.enabled`

A video that shows in picture in picture stays there, and pages that offer picture in picture themselves keep it.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "PictureInPictureEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v PictureInPictureEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>PictureInPictureEnabled</key>
<false/>
```

## PrivateModeAvailability

`1` keeps people from opening private windows; `0` allows them.

- Value: integer (one of `0`, `1`)
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: none

Chrome's `2`, which makes every window private, is not supported and not valid.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "PrivateModeAvailability": 1
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v PrivateModeAvailability /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>PrivateModeAvailability</key>
<integer>1</integer>
```

## PromptForDownloadLocation

Whether the browser asks where to save each download.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `downloads.ask`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "PromptForDownloadLocation": true
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v PromptForDownloadLocation /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>PromptForDownloadLocation</key>
<true/>
```

## ReaderViewEnabled

Turns the reader view on or off. While it is off, the browser checks no page for an article.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `reader.enabled`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ReaderViewEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ReaderViewEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ReaderViewEnabled</key>
<false/>
```

## RestoreOnStartup

What the browser opens when it starts, with Chromium's numbers: `1` the last session, `4` the pages of `RestoreOnStartupURLs`, `5` a new tab page.

- Value: integer (one of `1`, `4`, `5`)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `startup.page`

After the browser did not quit normally, as after a crash, it brings the last session back; only a mandatory `RestoreOnStartup` keeps the start to its value then, as on shared computers.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "RestoreOnStartup": 4
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v RestoreOnStartup /t REG_DWORD /d 4 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>RestoreOnStartup</key>
<integer>4</integer>
```

## RestoreOnStartupURLs

The pages that open at the start when `RestoreOnStartup` is `4`, in this order.

- Value: list of strings (each at most 8192 characters; each must be a web address; at most 100 entries)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `startup.urls`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "RestoreOnStartupURLs": ["https://intranet.example.com/", "https://mail.example.com/"]
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela\RestoreOnStartupURLs" /v 1 /t REG_SZ /d "https://intranet.example.com/" /f
reg add "HKLM\SOFTWARE\Policies\Astela\RestoreOnStartupURLs" /v 2 /t REG_SZ /d "https://mail.example.com/" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>RestoreOnStartupURLs</key>
<array>
  <string>https://intranet.example.com/</string>
  <string>https://mail.example.com/</string>
</array>
```

## SetupGuideEnabled

`false` keeps the setup guide from opening on the first start of a profile.

- Value: boolean
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: none

Starting the browser with `--no-first-run` does the same for one start.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "SetupGuideEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v SetupGuideEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>SetupGuideEnabled</key>
<false/>
```

## ShowHomeButton

Shows or hides the home button of the toolbar.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `home.button`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ShowHomeButton": true
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ShowHomeButton /t REG_DWORD /d 1 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ShowHomeButton</key>
<true/>
```

## SleepingTabsEnabled

Whether tabs go to sleep by themselves after they were not used for a while. People can still put a tab to sleep from its menu.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `tabs.sleep`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "SleepingTabsEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v SleepingTabsEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>SleepingTabsEnabled</key>
<false/>
```

## SleepingTabsTimeout

How many seconds a tab stays unused before it goes to sleep, with the values of Microsoft Edge.

- Value: integer (one of `30`, `300`, `900`, `1800`, `3600`, `7200`, `10800`, `21600`, `43200`)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `tabs.sleepAfter`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "SleepingTabsTimeout": 1800
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v SleepingTabsTimeout /t REG_DWORD /d 1800 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>SleepingTabsTimeout</key>
<integer>1800</integer>
```

## SplitViewEnabled

Turns split view on or off. Off ends the split views that show.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `splitView.enabled`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "SplitViewEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v SplitViewEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>SplitViewEnabled</key>
<false/>
```

## SSLErrorOverrideAllowed

`false` keeps people from continuing to a site whose certificate is not trusted; certificates accepted earlier in the session are refused again.

- Value: boolean
- Levels: mandatory only
- Sensitive: no
- Restart needed: no
- Setting: none

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "SSLErrorOverrideAllowed": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v SSLErrorOverrideAllowed /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>SSLErrorOverrideAllowed</key>
<false/>
```

## TabStripPosition

Where the tab strip is: at the top, at the bottom, or on the left or right side.

- Value: string (one of `top`, `bottom`, `left`, `right`)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `tabs.position`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "TabStripPosition": "left"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v TabStripPosition /t REG_SZ /d "left" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>TabStripPosition</key>
<string>left</string>
```

## TargetChannel

The update channel. The beta channel also receives the stable releases.

- Value: string (one of `stable`, `beta`)
- Levels: mandatory only
- Sensitive: no
- Restart needed: yes
- Setting: none

A switch from beta to stable never installs an older version; the browser stays on its version until a stable release overtakes it.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "TargetChannel": "stable"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v TargetChannel /t REG_SZ /d "stable" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>TargetChannel</key>
<string>stable</string>
```

## TargetVersionPrefix

Installs only versions that start with this prefix, such as `0.1`: the highest version of the feed that matches.

- Value: string (must be a version prefix)
- Levels: mandatory only
- Sensitive: no
- Restart needed: yes
- Setting: none

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "TargetVersionPrefix": "0.1"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v TargetVersionPrefix /t REG_SZ /d "0.1" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>TargetVersionPrefix</key>
<string>0.1</string>
```

## ToolbarPlacement

Whether the address bar has a row of its own below the tabs (`own-row`) or shares the row of the tabs (`tab-row`).

- Value: string (one of `own-row`, `tab-row`)
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `toolbar.placement`

It applies only with the tab strip at the top.

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "ToolbarPlacement": "tab-row"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v ToolbarPlacement /t REG_SZ /d "tab-row" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>ToolbarPlacement</key>
<string>tab-row</string>
```

## UpdatePolicy

How the browser updates itself: `0` not at all, `1` by itself, `2` only when people ask for it.

- Value: integer (one of `0`, `1`, `2`)
- Levels: mandatory only
- Sensitive: no
- Restart needed: yes
- Setting: none

This version has no way to ask for an update yet, so `2` works like `0`. Installations that the system or IT updates, such as the deb, rpm and MSI packages, never update themselves.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "UpdatePolicy": 0
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v UpdatePolicy /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>UpdatePolicy</key>
<integer>0</integer>
```

## UpdateURL

The address of an organization mirror of the update feed, instead of the website of the project.

- Value: string (must be a URL; must be an http or https URL)
- Levels: mandatory only
- Sensitive: yes, applies only from machine-wide mandatory sources
- Restart needed: yes
- Setting: none

The browser reads `updates/v1/index.json` and `updates/v1/releases/<version>.json` below this address and checks their signatures as on the website.

Linux, in a file in `/etc/astela/policies/managed/`:

```json
{
  "UpdateURL": "https://updates.example.com/"
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v UpdateURL /t REG_SZ /d "https://updates.example.com/" /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>UpdateURL</key>
<string>https://updates.example.com/</string>
```

## WorkspacesEnabled

Turns workspaces on or off. Off shows the tabs of all workspaces of a window together; the workspaces come back when the policy turns them on again.

- Value: boolean
- Levels: mandatory or recommended
- Sensitive: no
- Restart needed: no
- Setting: `workspaces.enabled`

Linux, in a file in `/etc/astela/policies/managed/` or `/etc/astela/policies/recommended/`:

```json
{
  "WorkspacesEnabled": false
}
```

Windows:

```bat
reg add "HKLM\SOFTWARE\Policies\Astela" /v WorkspacesEnabled /t REG_DWORD /d 0 /f
```

macOS, in a configuration profile for `io.github.secoolioo.astela`:

```xml
<key>WorkspacesEnabled</key>
<false/>
```
