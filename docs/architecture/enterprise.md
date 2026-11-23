# Enterprise

> **Status:** partly implemented. Astela reads policies from all three operating systems, and the [admin guide](../admin/README.md) with its generated [policy reference](../admin/policies.md) describes what administrators can set today; the rest of this page is design. See [implementation status](#implementation-status).

Astela is designed to be manageable: every setting can be set and locked by policy, and the browser will ship with an MSI package, silent installation, update control, a diagnostics page and a safe mode. Organizations will get all of this without telemetry and without an account.

The decisions behind this design are recorded in ADR 0003 (packaging with electron-builder), ADR 0012 (policy providers per OS) and ADR 0014 (update architecture with a signed feed). See the [decision records](../adr/README.md).

Related documents:

- [Settings, policies and themes](settings-policy-theme.md): how settings and policies are defined, resolved and generated.
- [Updates](updates.md): the signed update feed, channels and rollback.
- [Security](security.md): permissions, certificates and network hardening.
- [Testing](testing.md): how the policy providers and packages are tested.

## Policy sources

| Platform | Source                                                                                                                                                                                                                          | Typical delivery                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Windows  | Registry keys `HKLM\SOFTWARE\Policies\Astela` and `HKCU\SOFTWARE\Policies\Astela` for mandatory policies; `HKLM\SOFTWARE\Policies\Astela\Recommended` and `HKCU\SOFTWARE\Policies\Astela\Recommended` for recommended policies. | Group Policy with the ADMX/ADML templates, Microsoft Intune. |
| macOS    | Managed preferences (`/Library/Managed Preferences`) for the bundle ID `io.github.secoolioo.astela`.                                                                                                                            | Configuration profiles through MDM, for example Jamf.        |
| Linux    | `/etc/astela/policies/managed/*.json` for mandatory policies and `/etc/astela/policies/recommended/*.json` for recommended policies. Files are merged in alphabetical order.                                                    | Any tool that can place files on the system.                 |

The ADMX namespace is `Astela.Policies`. The namespace, the registry paths, the bundle ID and the Linux paths derive from `brand.json` and never change once released.

Policy names follow Chrome's names where that makes sense, so that existing knowledge and tooling carry over.

## Precedence

- **Mandatory over recommended.** A mandatory policy locks a setting; a recommended policy only changes the value users start from.
- **Machine over user.** On Windows, `HKLM` takes precedence over `HKCU`.
- **Sensitive policies only from trusted sources.** The update URL (`UpdateURL`), the proxy policies, the default search provider policies, the DNS over HTTPS policies (`DnsOverHttpsMode`, `DnsOverHttpsTemplates`) and, from M4, extension sources apply only from `HKLM` on Windows and only as forced values on macOS. Linux policy files are system-wide by location. If a sensitive policy appears anywhere else, it does not apply, and the browser writes a warning to its log; the diagnostics page is designed to show it too. This keeps a program running as the user from redirecting updates or traffic by writing to `HKCU`. Chrome and Firefox follow the same principle (as of October 2026).

How policies combine with defaults, user values and workspace overrides is described in the [resolution order](settings-policy-theme.md#resolution-order).

## Reading policies

In M1, Astela reads every policy source without a native module while Electron starts ([ADR 0025](../adr/0025-read-policies-while-electron-starts.md)):

- **Windows:** `reg export` writes the policy keys of `HKLM` and `HKCU` to temporary files, both at the same time, which are then parsed. The export is UTF-16LE, so non-ASCII characters survive intact.
- **macOS:** `plutil -convert xml1 -o -` converts the managed preferences plists to XML, which is then parsed. XML is used instead of JSON because plist dates and binary data (`<date>` and `<data>`) cannot be converted to JSON.
- **Linux:** the JSON files are read directly.

Until the sources have been read, the last known policy set applies. It is cached in the profile and also serves as the fallback when a source cannot be read. The first window waits for the fresh set; only a start without a cache reads the sources before the app is ready. Policies are read again, in the background, when a window gains focus, except while the first window opens, and every 15 minutes.

In M5, a native Node-API addon is planned. It will use `RegisterGPNotification` on Windows to be notified of Group Policy changes and `CFPreferencesAppValueIsForced` on macOS to tell forced values apart.

## M1 policy set

M1 is planned to ship about 22 policies. The table is the plan; the policies of the current version are those of the [policy reference](../admin/policies.md). Of the table, `ProxyMode`, `ProxyPacUrl`, `ProxyServer`, `ProxyBypassList`, `AuthServerAllowlist`, `URLBlocklist`, `URLAllowlist`, `NewTabPageLocation`, `SafeModeAvailability` and `ManagedSettings` do not exist yet.

| Group    | Policies                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update   | `UpdatePolicy`, `TargetChannel`, `TargetVersionPrefix`, `UpdateURL` (mirror), `AutoUpdateCheckPeriodMinutes`                                                                                                         |
| Network  | `ProxyMode`, `ProxyPacUrl`, `ProxyServer`, `ProxyBypassList`, `DnsOverHttpsMode`, `DnsOverHttpsTemplates`, `AuthServerAllowlist`                                                                                     |
| Content  | `URLBlocklist`, `URLAllowlist`, `HomepageLocation`, `RestoreOnStartup` with `RestoreOnStartupURLs`, `NewTabPageLocation`, the `DefaultSearchProvider*` policies                                                      |
| Features | `PrivateModeAvailability`, `DeveloperToolsAvailability`, `DownloadDirectory`, `PromptForDownloadLocation`, `SafeModeAvailability`, and `<Module>Enabled` for every optional module (for example `WorkspacesEnabled`) |
| Locks    | Every setting with a `policy` attribute is automatically a policy. In addition, `ManagedSettings` takes JSON that sets settings by key, each with a `Status` of `locked` or `default`.                               |

`UpdatePolicy` takes one of three values:

| Value | Meaning                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------- |
| `0`   | Off. The in-app updater does not run.                                                           |
| `1`   | Automatic. Updates are checked, downloaded and installed as described in [Updates](updates.md). |
| `2`   | Manual only. Updates are not checked automatically; people start a check in About.              |

`TargetChannel` selects `stable` or `beta`. `TargetVersionPrefix` pins updates to the highest version in the feed that matches the prefix. `UpdateURL` points the browser to a mirror of the update feed and packages.

## Later policy groups

| Milestone       | Policies                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2 Flow         | `AuthNegotiateDelegateAllowlist`, `ManagedBookmarks`, `SpellcheckDictionaryURL`, cookie policies, `ClearBrowsingDataOnExit`, `PasswordManagerEnabled`, import policies, `CACertificates`, capture policies and printing policies. Also a Jamf JSON schema. |
| M4 Ecosystem    | Extension policies, for example `ExtensionInstallBlocklist`.                                                                                                                                                                                               |
| M5 Enterprise+  | `RollbackToTargetVersion` and an update maintenance window, as part of an extended set of more than 50 policies.                                                                                                                                           |
| M6 Sync and 1.0 | Sync policies.                                                                                                                                                                                                                                             |

## Network: proxy, DNS, certificates and single sign-on

### Proxy

The proxy defaults to the system configuration. When the proxy policies are set, the browser is designed to apply them through `session.setProxy` and then close all existing connections (`closeAllConnections`), so no connection keeps using the old route.

### DNS over HTTPS

Electron starts with DNS over HTTPS turned off (as of October 2026), so Astela configures the host resolver explicitly (`configureHostResolver`). The default is `automatic` without a list of services, which uses DNS over HTTPS where the provider of the system offers it. With `DnsOverHttpsMode`, administrators can choose `off` or `secure`, and `DnsOverHttpsTemplates` sets their own resolver templates. Addresses that Chromium would refuse, such as templates with unbalanced braces or a variable in the host, are not valid values of the policy.

### Certificates

- Astela is designed to trust the Chrome Root Store plus root certificates that are trusted locally by the operating system.
- On Windows and macOS, locally trusted roots are picked up automatically. On Linux, they come from the NSS database; the admin guide will document the `certutil` steps.
- Client certificates are never selected automatically; the user always chooses one.
- Certificate errors lead to Astela's own interstitial page.
- From M2, `CACertificates` and `SSLErrorOverrideAllowed` give administrators direct control.

The root store, CRLSet and certificate transparency data are updated only with Electron updates. This is why Astela commits to a fixed response time for security updates, described in [Security](security.md).

### Single sign-on

Kerberos (Negotiate) and NTLM are designed to work through allowlist policies together with Electron's `allowNTLMCredentialsForDomains`:

- `AuthServerAllowlist` will be mapped internally to Electron's command-line switch `auth-server-whitelist` (as of October 2026). The switch has to be set before the app is ready, so it takes the policy state that applies then: the last known set, or on the first start of a profile the freshly read one. A changed value takes effect after a restart.
- From M2, `AuthNegotiateDelegateAllowlist` will be mapped the same way to `auth-negotiate-delegate-whitelist` (as of October 2026).

### Network tests

The network features are designed to be tested automatically:

- every proxy mode, including a local PAC file, against a test proxy;
- DNS over HTTPS against a local DNS over HTTPS stub;
- Kerberos and Negotiate against an MIT KDC and a web server in a container on Linux;
- a custom root certificate authority in the Windows certificate store and in the NSS database on Linux.

## MSI package

Astela is designed to ship a native MSI package (not a wrapped installer) for managed Windows deployments:

- **Per machine.** `perMachine: true` installs for all users (`ALLUSERS=1`).
- **Fixed upgrade code.** The `upgradeCode` is set explicitly and never changes. Major upgrades replace the previous version, with downgrade protection.
- **Silent.** Silent installation runs `msiexec /i` with `/qn /norestart /l*v` and needs no restart.
- **Properties.** `INSTALLDIR` sets the installation folder, and `DESKTOP_SHORTCUT=0` turns off the desktop shortcut. Both are added through electron-builder's `msiProjectCreated` hook, already in M1.
- **Install type marker.** The installation type is recorded outside the policy keys, at `HKLM\SOFTWARE\Astela\Install` with `Type=msi`. When the browser finds it, the in-app updater will stay off; IT distributes new MSI packages, for example through Group Policy, Intune or SCCM, and controls update behavior with `UpdatePolicy`.
- **Rollback.** Rollback is an IT task; the `ALLOWDOWNGRADE` property allows a deliberate downgrade.
- **Clean uninstall.** Uninstalling removes the installation cleanly. Intune detection by ProductCode will be documented.
- **Stable releases only.** Windows Installer ignores prerelease identifiers in version numbers, so beta releases are not published as MSI.
- **x64 in M1.** For arm64, electron-builder produces an MSI that is marked as x64 (as of October 2026). A dedicated WiX template is designed to follow in M5; until then, arm64 devices use the NSIS installer.

In M5, an optional elevated update task (running as SYSTEM) is designed to install verified MSI packages silently.

## Diagnostics page

The diagnostics page (`app://diagnostics`) is designed to show everything support and administrators need, without sending anything anywhere:

| Section   | Contents                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------- |
| Version   | App, Electron, Chromium, Node and V8 versions; update channel; installation type; paths; command line.         |
| Policies  | For each policy: value, source, scope, level, status and error. A button to reload policies and a JSON export. |
| Modules   | Which modules are active and how long they took to load.                                                       |
| Updates   | Updater status, feed and signature state.                                                                      |
| Processes | Process metrics.                                                                                               |
| Support   | Copy as text or JSON (redacted) and a diagnostics ZIP file including the logs. Nothing is sent automatically.  |

Logs are designed to be local only: JSON Lines files under `logs/`, rotated at 5 MB with three files kept. Crash dumps also stay local; they can be viewed on the diagnostics page and shared manually.

## Safe mode

Safe mode is designed to help when a module, a theme or the GPU prevents normal use:

- **Start:** with `--safe-mode`, a Jump List entry on Windows, a `.desktop` action on Linux or the Dock menu on macOS. From M2, the browser is designed to enter safe mode automatically after two failed starts that were not preceded by an update.
- **Effect:** optional modules and custom themes are turned off, and optionally GPU acceleration as well. The security guards in the kernel stay active, so permissions remain denied by default.
- **Control:** administrators can turn safe mode off with `SafeModeAvailability`.

## Accessibility

- **Target:** WCAG 2.2 AA for Astela's own user interface, and EN 301 549 clause 11.
- **Test matrix:** NVDA, JAWS, Narrator, VoiceOver and Orca; Forced Colors; keyboard-only use; target size of at least 24 × 24 px.
- **Manual checks:** maintainers run a screen reader smoke test with NVDA, VoiceOver and Orca once per minor release.
- **Conformance report:** a VPAT 2.5 INT is planned from M5.

The visual rules behind these targets are described in the [design system](design-system.md).

## Outgoing connections

By design, Astela collects no telemetry and uploads no crash reports. Every outgoing connection is designed to be documented, listed on the diagnostics page, and redirected or turned off by policy:

- **Updates:** the update feed on the project website and the packages on GitHub Releases.
- **Content blocker (M2):** the filter list feed.
- **Spell checking:** dictionaries are self-hosted from M2. In M1, spell checking is off on Windows and Linux, and every session there has an empty list of languages, so the browser downloads no dictionary at all, also not for private windows or workspaces; macOS uses the system spell checker.
- **Search suggestions:** opt-in.

## Admin guide

The [admin guide](../admin/README.md) (v1) covers:

- **Installation:** NSIS, MSI, macOS (dmg, without a `.pkg` installer), deb, rpm and AppImage, with the silent installation flags and the switches `ASTELA_NO_REPO` and `ASTELA_REPO_URL` of the deb and rpm packages.
- **Policies:** where they are stored, which value wins, the sensitive policies and how to check that values apply.
- **Policy reference:** [generated](../admin/policies.md) from the policy definitions by `tools/policies/reference.ts`, with examples for Linux, `reg add` and macOS property lists, together with the JSON Schema of the Linux policy files ([ADR 0062](../adr/0062-policy-reference-generated-into-the-docs.md)). `pnpm verify` fails when they no longer match the definitions.
- **Updates:** update control and a mirror of the update feed.
- **Operations:** logs, the list of outgoing connections and what is not available yet.

Still planned for the guide: examples for Group Policy, Intune (ADMX import and OMA-URI) and Jamf, the network (proxy, certificates and single sign-on), the diagnostics page and safe mode.

## Acceptance criteria

The M1 acceptance tests for enterprise features are:

- The MSI installs, upgrades and uninstalls silently per machine, each with exit code 0.
- Policies set through the registry, plists and JSON files take effect and appear on `app://diagnostics`.
- Settings locked by policy cannot be changed in the UI or through the API and are shown as managed.
- The ADMX/ADML templates validate against the XSD automatically. Maintainers check the import into a Microsoft Intune test tenant manually once per minor release.
- `--safe-mode` starts without optional modules and custom themes.
- The policy providers are tested against real sources: a test key under `HKCU` on Windows, a plist in `/Library/Managed Preferences` on macOS and JSON files in a temporary folder on Linux.

## Implementation status

Implemented (`app/src/platform/policy/`), with unit tests against recorded registry exports, plists and JSON files:

- **Windows:** `reg export` of `HKLM` and `HKCU\SOFTWARE\Policies\Astela`; values of the `Recommended` subkey are recommended, and a subkey named after a policy holds a list.
- **macOS:** the machine-wide and the per-user managed preferences of the bundle id under `/Library/Managed Preferences`, converted with `plutil` and read by a small plist parser; all values there are mandatory.
- **Linux:** `/etc/astela/policies/managed/*.json` and `/etc/astela/policies/recommended/*.json`, merged in alphabetical order; invalid files are reported and skipped.

The update policies (`UpdatePolicy`, `TargetChannel`, `TargetVersionPrefix`, `UpdateURL` and `AutoUpdateCheckPeriodMinutes`) are implemented; see [updates.md](updates.md#implementation-status). A running browser follows a change of them at the next refresh of the policies: `0` stops the checks, cancels a download that runs and drops a downloaded update, and a new mirror, channel, prefix or period applies from the next check. About shows the state of the updates and, while no check runs, offers **Check for updates**, which `2` needs.

Also implemented:

- `SetupGuideEnabled` (boolean): `false` as a mandatory policy keeps the [setup guide](../user/setup-guide.md) from opening on the first start of a profile. Starting the browser with `--no-first-run` does the same for one start.
- `BookmarkBarEnabled` (boolean): shows or hides the [bookmarks bar](../user/bookmarks.md#bookmarks-bar), as mandatory or recommended policy, like the setting `bookmarks.bar`.
- `CommandPaletteEnabled` (boolean): turns the [command palette and tab search](../user/command-palette.md) on or off, as mandatory or recommended policy, like the setting `commandPalette.enabled`. While it is off, `Ctrl+K` and `Ctrl+Shift+A` (`Command+K` and `Command+Shift+A` on macOS) reach web pages, unless people gave these keys to another command; shortcuts that people gave the palette itself do nothing while it is off. The browser menu and the View menu of macOS then have no items for the palette.
- `SplitViewEnabled` (boolean): turns [split view](../user/tabs.md#split-view) on or off, as mandatory or recommended policy, like the setting `splitView.enabled`. Off ends the split views that show and removes their items from the tab menu and from the View menu of macOS; `Ctrl+Shift+S` (`Control+Command+S` on macOS) then reaches web pages, unless people gave these keys to another command, and a restored session shows its tabs one by one ([ADR 0054](../adr/0054-split-view-with-two-tabs-side-by-side.md)).
- `WorkspacesEnabled` (boolean): turns [workspaces](../user/workspaces.md) on or off, as mandatory or recommended policy, like the setting `workspaces.enabled`. Off, every window shows the tabs of all its workspaces together in the default workspace, at the start and as soon as a refresh of the policies turns them off; the button of the workspaces, their shortcuts `Alt+1` to `Alt+9` (`Control+1` to `Control+9` on macOS), which then reach web pages, and **Move to workspace** in the menu of a tab are gone. The definitions of the workspaces and the data of isolated workspaces stay, and come back when the policy turns workspaces on again, without their tabs ([ADR 0055](../adr/0055-tab-groups-and-workspaces-in-the-tab-model.md)).
- `SleepingTabsEnabled` (boolean): whether [tabs go to sleep](../user/tabs.md#sleeping-tabs) by themselves after they were not used for a while, as mandatory or recommended policy, like the setting `tabs.sleep`; it does not keep people from putting a tab to sleep from its menu. Tabs that show, are pinned, play sound or a video, show a video in picture in picture, use the camera, the microphone or the screen, download a file, have the developer tools open or are linked to a page that they opened or that opened them, and pages that people typed into since they loaded, stay awake.
- `ReaderViewEnabled` (boolean): turns the [reader view](../user/page-tools.md#reader-view) on or off, as mandatory or recommended policy, like the setting `reader.enabled`. Off, the reader views that show end, the browser checks no page for an article, and the button next to the address bar, the items of the browser menu and of the View menu of macOS and the key `F9` (`Option+Command+R` on macOS) are gone; the key then reaches web pages, unless people gave it to another command. The font of the reader view, the setting `reader.font`, has no policy ([ADR 0057](../adr/0057-reader-view-and-picture-in-picture-in-isolated-worlds.md)).
- `PictureInPictureEnabled` (boolean): turns the [picture in picture](../user/page-tools.md#picture-in-picture) of the browser on or off, as mandatory or recommended policy, like the setting `pictureInPicture.enabled`. Off, the button next to the address bar, the item of the browser menu and of the View menu of macOS, and the items of the context menu of a video are gone, the browser looks at the videos of a page only before its tab goes to sleep and, while the page shows a video in picture in picture, when a window gets the focus, and keys that people gave the command reach web pages. A video that shows in picture in picture stays there, and pages that offer picture in picture themselves keep it, with their tabs awake while a video shows in it; the policy does not turn off picture in picture of Chromium ([ADR 0057](../adr/0057-reader-view-and-picture-in-picture-in-isolated-worlds.md)).
- `SleepingTabsTimeout` (integer, seconds): how long a tab stays unused before it goes to sleep, as mandatory or recommended policy, like the setting `tabs.sleepAfter`, with the values of Microsoft Edge: `30`, `300`, `900`, `1800`, `3600` (the default), `7200`, `10800`, `21600` or `43200`. Another value is invalid and leaves the setting as it was. The settings page offers 30 seconds only while a policy or the settings file sets it, which end-to-end tests use.
- `ApplicationLocaleValue` (string): the [language](../user/settings.md#languages) of the menus, dialogs and pages of the browser, as mandatory or recommended policy, like the setting `i18n.language`: `system`, or a language code such as `en` or `de`; a code without a translation shows English. Unlike in Chromium, a code with a region, such as `de-DE`, is not valid. A change takes effect when the browser starts again.
- `DefaultBrowserSettingEnabled` (boolean): `false` as a mandatory policy keeps users from making Astela the default browser. The [default browser setting](../user/default-browser.md) on the settings page and in the setup guide then shows that the organization manages it and has no Make default button, and the browser refuses the change.
- `ImportEnabled` (boolean): `false` as a mandatory policy turns off the [import from other browsers](../user/import.md). The settings page and the import step of the setup guide then say that the organization turned it off instead of listing the browsers, and the browser refuses an import.
- `PrivateModeAvailability` (`0` or `1`): `1` as a mandatory policy keeps people from opening [private windows](../user/windows-and-popups.md#private-windows); the item in the menu bar of macOS is then greyed out without its shortcut, as in Chrome, the browser menu has no New private window, and its shortcut reaches web pages, as the settings page shows the command without a shortcut. `0` allows them. Forcing every window to be private, which other browsers do with `2`, is not supported yet; the browser ignores `2` as an invalid value and writes a `Policy value ignored` record to `logs/main.log`, as for every value that does not apply. The settings page marks only the policies of settings, so it shows nothing for this one.
- `DeveloperToolsAvailability` (`0`, `1` or `2`): `2` as a mandatory policy keeps the developer tools closed; the Inspect item of the context menu then does nothing, the View menu of macOS greys out Developer Tools without its shortcut, More tools of the browser menu has no Developer tools, and F12 and the other keys of the developer tools reach web pages, as the settings page shows the command without a shortcut. Both policies leave the shortcut table of the windows (`shortcutsNow` in `bootstrap.ts`), and a refresh of the policies that changes them makes the table and the menu bar of macOS again at once; an open settings page reads the shortcuts again (`settings.shortcutsChanged`). `0` and `1` allow them for web pages, as in Chromium; the browser's own pages never get them. See [page tools](../user/page-tools.md#developer-tools).
- `SSLErrorOverrideAllowed` (boolean): `false` as a mandatory policy keeps users from continuing to a site whose certificate is not trusted; the [warning](../user/page-problems.md) then offers only the way back, and certificates accepted earlier in the session are refused again.
- `ContentBlockerEnabled` (boolean): turns the [content blocker](../user/content-blocker.md) on or off, as mandatory or recommended policy.
- `ContentBlockerAllowedSites` (list of host names or domains): the sites on which the content blocker is off, like the setting `contentBlocker.allowedSites`, at most 10,000. As a mandatory policy, it sets the list and locks it: the settings list, its Add and Remove, the switch **Block ads on** of the shield popover, which then says _Managed by your organization_, and an import of settings cannot change it, so that a mandatory `ContentBlockerEnabled` `true` holds on every site; `[]` allows no exception. As a recommended policy, it is the list that people start from.
- `ContentBlockerCookieNoticesEnabled` and `ContentBlockerAnnoyancesEnabled` (boolean): turn the optional lists of the content blocker against cookie notices and against annoyances on or off, as mandatory or recommended policy, like the settings `contentBlocker.cookieNotices` and `contentBlocker.annoyances`.
- `TabStripPosition` (`top`, `bottom`, `left` or `right`): sets or recommends where the tab strip is, like the setting `tabs.position`. Popups that pages open have no tab strip, so the policy takes no room from the sign-in and payment pages in them.
- `ToolbarPlacement` (`own-row` or `tab-row`): sets or recommends whether the address bar has a row of its own below the tabs or shares the row of the tabs, like the setting `toolbar.placement`. It applies only with the tab strip at the top ([ADR 0058](../adr/0058-layout-presets-and-top-rows-that-hide.md)).
- `AutoHideToolbar` (boolean): sets or recommends whether the tabs and the toolbar hide until they are needed, like the setting `toolbar.autoHide`, with the tab strip at the top and never in popups. As a mandatory policy, it also keeps the command that turns the hiding on and off from running. The layout presets of the settings page and the setup guide that would change a setting that a mandatory policy sets cannot be chosen ([layouts](../user/layouts.md)).
- `RestoreOnStartup` (`1`, `4` or `5`): sets or recommends what the browser opens when it starts, like the setting `startup.page`, with Chromium's numbers: `1` the last session, `4` the pages of `RestoreOnStartupURLs`, `5` a new tab page. After the browser did not quit normally, as after a crash, it brings the last session back whatever `startup.page` says; only a mandatory `RestoreOnStartup` keeps the start to its value then, such as on shared computers and kiosks.
- `RestoreOnStartupURLs` (list of web addresses): the pages that open at start with `RestoreOnStartup` set to `4`, like the setting `startup.urls`; at most 100 http and https addresses. An address without a scheme, such as `intranet.example.com`, gets `https://`, as the settings page and Chromium fix such addresses up (Chromium adds `http://`); another scheme, such as `javascript:`, stays refused. As in Chromium, a single address instead of a list is not valid.
- `DownloadDirectory` (path): the folder where downloads are saved, like the setting `downloads.folder`, as an absolute path; empty for the downloads folder of the system. The browser replaces Chrome's variables `${user_name}` (the name of the user's account) and `${machine_name}` (the name of the computer) on every system, as Chromium does on Linux, such as in `/home/${user_name}/Downloads`. A value with any other variable is not valid, such as `${user_home}`, which Chromium does not know either, or the variables that Chromium knows only on Windows (`${documents}`, `${local_app_data}` and others) and macOS (`${users}`, `${documents}`). The setting keeps the variables; the browser replaces them where it saves a download, opens the folder or shows it on the settings page ([ADR 0063](../adr/0063-chrome-policy-formats-converted-by-the-settings.md)). As a mandatory policy, it also holds what people save with **Save image as**, **Save video as** and **Save audio as** from the context menu, which otherwise always ask where to save, as in Chrome.
- `PromptForDownloadLocation` (boolean): whether the browser asks where to save each download, like the setting `downloads.ask`.
- `ShowHomeButton` (boolean): shows or hides the home button of the toolbar, like the setting `home.button`.
- `HomepageLocation` (web address, or empty for the new tab page): the page of the home button and of its shortcut, like the setting `home.page`. An address without a scheme, such as `example.com`, gets `https://`, as for `RestoreOnStartupURLs`.
- `BlockThirdPartyCookies` (boolean): keeps cookies away from requests, responses, frames and workers of other sites than the page's own, as mandatory or recommended policy, like the setting `privacy.blockThirdPartyCookies`. Chromium blocks them from the next start of the browser ([ADR 0044](../adr/0044-third-party-cookies-blocked-by-chromium.md)), with the policies that the last start read; private windows always block them.
- `HttpsOnlyMode` (`disallowed`, `force_enabled` or `force_balanced_enabled`): as a mandatory policy, `disallowed` turns [HTTPS-First](../user/page-problems.md#sites-without-a-secure-connection) off and the other two keep it on, like the setting `privacy.httpsFirst`. Astela has one mode, which warns before an insecure address; `allowed` leaves the choice to the user, as no policy does, and the browser ignores it as an invalid value and says so in its log and next to the setting.
- `HttpAllowlist` (list of host names): hosts that HTTPS-First leaves on their insecure address, such as `intranet.example.com`; `[*.]example.com` also names every host below `example.com`. IP addresses and local names are never upgraded and need no entry.
- `DnsOverHttpsMode` (`off`, `automatic` or `secure`): how the browser looks up the addresses of sites, like the setting `network.secureDns`: `automatic` uses DNS over HTTPS with the services of `DnsOverHttpsTemplates` or, without them, where the provider of the system offers it, `secure` only with the services of `DnsOverHttpsTemplates`, `off` never. `secure` without a service works like `automatic`. As a sensitive policy, it applies only from machine-wide mandatory sources.
- `DnsOverHttpsTemplates` (string): the addresses of the DNS over HTTPS services, `https://` URI templates separated by spaces, such as `https://dns.example/dns-query{?dns}`, like the setting `network.secureDnsTemplates`. A sensitive policy too.
- `DefaultSearchProviderSearchURL`: the search address of the address bar and the new tab page, an https address with Chrome's `{searchTerms}` or with `%s` where the search terms go, such as `https://search.example.com/search?q={searchTerms}`; the browser turns `{searchTerms}` into `%s`. Chrome's other parameters, such as `{inputEncoding}` or `{google:baseURL}`, are not replaced, and `DefaultSearchProviderEnabled` and `DefaultSearchProviderName` are not needed. As a sensitive policy, it applies only from machine-wide mandatory sources.

The MSI package (x64, per machine, with the fixed upgrade code) is built for every pull request and installed and removed silently in CI.

Values that do not apply, because their name is unknown, their value is not valid, they are mandatory only but set as recommended, or they are sensitive but come from a source of the user, are ignored while every other value applies. The browser writes each of them once to `logs/main.log` as a `Policy value ignored` warning with the name, the source, the level, the scope, the state and the reason, and again only when the set of these values or of the sources that could not be read changes; a refresh that finds the same problems, on the focus of a window or every 15 minutes, writes nothing. Each changed set starts with a `Policies read` record with the number of ignored values and unreadable sources, also when none are left, so the warnings after the last such record are the problems that hold now. The settings page shows, next to a setting whose policy value does not apply, which policy is ignored and why, in the language of the browser, such as _Your organization's value for the policy ShowHomeButton is not valid and is ignored._; the reason in English stays in the log. Standalone policies, such as `PrivateModeAvailability` and the update policies, have no setting, so only the log reports them. `--safe-mode` writes a warning that safe mode is not available yet and changes nothing else.

The [admin guide](../admin/README.md) and its [policy reference](../admin/policies.md) are generated in part from the policy definitions, which `allPolicies` in `app/src/main/policy-definitions.ts` lists ([ADR 0062](../adr/0062-policy-reference-generated-into-the-docs.md)).

Not implemented yet: the MSI properties, the install-type marker, the M1 policy set beyond the first settings, the diagnostics page, the ADMX/ADML templates and the configuration profile for macOS, and safe mode.
