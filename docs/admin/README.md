# Admin guide

This guide is for administrators who install Astela for an organization and manage it with policies. It describes what the current version does; the [policy reference](policies.md) lists every policy with its values and examples, and the [enterprise design](../architecture/enterprise.md) describes what is planned.

## Installation

Every release has packages for Windows, macOS and Linux on the [releases page](https://github.com/Secoolioo/astela/releases).

| System  | Package                                                          | Installed for       | Updates                                |
| ------- | ---------------------------------------------------------------- | ------------------- | -------------------------------------- |
| Windows | `astela-windows-x64-setup.exe`, `astela-windows-arm64-setup.exe` | the current user    | by the browser itself                  |
| Windows | `astela-windows-x64.msi`, for stable releases only               | every user          | by IT, with new MSI packages           |
| macOS   | `astela-macos-x64.dmg`, `astela-macos-arm64.dmg`                 | every user          | by the browser itself                  |
| Linux   | `astela-linux-amd64.deb`, `astela-linux-arm64.deb`               | every user          | by APT, with the updates of the system |
| Linux   | `astela-linux-x86_64.rpm`, `astela-linux-aarch64.rpm`            | every user          | by DNF, with the updates of the system |
| Linux   | `astela-linux-x86_64.AppImage`, `astela-linux-arm64.AppImage`    | the user who has it | by the browser itself                  |

- **Windows, per user:** the setup program installs without administrator rights and without a question. `astela-windows-x64-setup.exe /S` installs silently.
- **Windows, per machine:** the MSI installs for every user, below `Program Files`, with a fixed upgrade code, so a newer MSI replaces the older one. `msiexec /i astela-windows-x64.msi /qn /norestart /l*v install.log` installs it silently. Windows Installer cannot order beta versions, so only stable releases get an MSI; until the first stable release, there is none. A browser that runs from `Program Files` never updates itself.
- **macOS:** open the dmg and drag Astela to Applications. The app has no Apple Developer ID yet, so the first start needs **Open Anyway** in the Privacy & Security part of System Settings.
- **deb and rpm:** `sudo apt install ./astela-linux-amd64.deb` or `sudo dnf install ./astela-linux-x86_64.rpm`. After the installation, the package adds the package repository of its channel to the system once, with the key it ships, so the browser updates together with the system: `/etc/apt/sources.list.d/astela.sources` or `/etc/yum.repos.d/astela.repo`. An existing file is never overwritten. Two environment variables of the installation change this:
  - `ASTELA_NO_REPO=1` adds no repository, for systems that get their packages from elsewhere: `sudo ASTELA_NO_REPO=1 apt install ./astela-linux-amd64.deb`.
  - `ASTELA_REPO_URL` adds the repository of a mirror instead, such as `ASTELA_REPO_URL=https://mirror.example.com/astela`; the mirror keeps the layout of the website, with `apt/` and `rpm/` below that address.

Starting the browser with `--no-first-run` keeps the setup guide from opening on the first start of a profile; the policy `SetupGuideEnabled` does the same for good.

## Policies

### Where policies are stored

| System  | Mandatory                                                                                 | Recommended                                 |
| ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| Windows | `HKLM\SOFTWARE\Policies\Astela` and `HKCU\SOFTWARE\Policies\Astela`                       | the subkey `Recommended` of each            |
| macOS   | configuration profiles for `io.github.secoolioo.astela`, for the computer or for one user | none: every value of a profile is mandatory |
| Linux   | `/etc/astela/policies/managed/*.json`                                                     | `/etc/astela/policies/recommended/*.json`   |

On Linux, each file holds one JSON object with policies as its keys, such as `{ "ShowHomeButton": true }`. The files of a folder are read in alphabetical order, and a later file overrides a value of an earlier one. A file that is not a JSON object is skipped. The [JSON Schema](policies.schema.json) of these files lists every policy of this version, so an editor or a JSON Schema validator can check a file before it is deployed; a file names no `$schema` itself, because the browser takes every key of the file as a policy.

On Windows, Group Policy and Intune write the registry keys; `reg add` does the same by hand, as the examples of the [policy reference](policies.md) show. The ADMX templates are not available yet.

### Which value wins

- A **mandatory** value sets a setting and locks it: people cannot change it on the settings page, and the settings page says **Managed by your organization**.
- A **recommended** value only sets the value that people start from; they may change it, and the settings page says **Recommended by your organization** while the recommended value applies. Policies that the reference marks as _mandatory only_ are ignored as recommended values.
- Mandatory values win over recommended ones, and machine-wide values over the values of a user: `HKLM` over `HKCU`, and a profile for the computer over a profile for a user.
- **Sensitive** policies, such as `UpdateURL`, `DefaultSearchProviderSearchURL` and the DNS over HTTPS policies, apply only from machine-wide mandatory sources: `HKLM`, a profile for the computer, or a file in `/etc/astela/policies/managed/`. A program that runs as the user can write to `HKCU`, but it cannot redirect updates, searches or name lookups that way.

The browser reads the policies while it starts, again when one of its windows gets the focus, and every 15 minutes; a changed value applies then, except for the policies that need a restart.

### Checking that policies apply

The browser never guesses: a value with the wrong type or format, an unknown policy name, a mandatory-only policy set as recommended and a sensitive policy from a source that may not set it are ignored, and every other value still applies. Each value that does not apply is written to the log once, as a `Policy value ignored` record with the policy name, the source, the level, the scope, the state (`unknown`, `invalid`, `not-allowed-as-recommended` or `sensitive-requires-machine`) and the reason. A source that cannot be read, such as a file that is not valid JSON, gives a `Policy source could not be read` record. The records are written again only when the set of problems changes, and each set starts with a `Policies read` record that counts the ignored values and the sources that could not be read, also when both are 0. So the records after the last `Policies read` are the problems that hold now, and a `Policies read` record with `"ignored":0` shows that the browser has read a fix.

When the value of a policy of a setting is ignored, the settings page says so next to the setting, in the language of the browser, such as **Your organization's value for the policy ShowHomeButton is not valid and is ignored.** The reason is in the log. Policies without a setting, such as `PrivateModeAvailability` and the update policies, appear only in the log.

## Updates

Installations that update themselves, the setup program on Windows, macOS and the AppImage, check a signed update feed on the project website about a minute after the start and then every 4 hours. They download an update in the background and install it when the browser quits. The deb and rpm packages update with the system, and an MSI installation is updated by IT.

| Policy                         | Effect                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `UpdatePolicy`                 | `0` turns the updates of the browser off, `1` updates by itself, `2` only when people ask, with **Check for updates** in About. |
| `TargetChannel`                | `stable` or `beta`; the beta channel also receives stable releases.                                                             |
| `TargetVersionPrefix`          | Installs only versions with this prefix, such as `0.1`.                                                                         |
| `UpdateURL`                    | The address of a mirror of the update feed.                                                                                     |
| `AutoUpdateCheckPeriodMinutes` | Minutes between two checks, from 60 to 43200.                                                                                   |

A running browser follows a change of these policies when it reads the policies again, which it does when one of its windows gets the focus and every 15 minutes: `UpdatePolicy` `0` stops its checks, cancels a download that runs and drops an update that it already downloaded, so that nothing installs when it quits, and a new mirror, channel, prefix or period applies from the next check. A download that runs at the time of such a change stops as well; the next check downloads with the new values. Every change writes an `Update service` record to the log with the new state, such as `"state":"disabled"`.

About, in the browser menu, shows the state of the updates: up to date with the time of the last check, checking, downloading, ready to install when the browser quits, the last check failed with the reason, or turned off with the reason, such as **Your organization turned off updates.** While no check runs, it offers **Check for updates**; About then says that it checks and shows the answer as soon as there is one. The reason of a failed check is in the language of the browser, such as _The update information is out of date._ for an expired feed; `logs/main.log` has the details of the error in an `Update failed` record.

### A mirror of the update feed

`UpdateURL` points the browser at a copy of the feed, for networks that cannot reach the project website. The policy is sensitive, so it applies only from machine-wide mandatory sources.

1. Copy the folder `updates/v1/` of the project website, `https://secoolioo.github.io/astela/updates/v1/`, unchanged to a web server of the organization, so that `updates/v1/index.json` and the files in `updates/v1/releases/` lie below one address, such as `https://updates.example.com/updates/v1/index.json`.
2. Set `UpdateURL` to that address without `updates/v1/`, such as `https://updates.example.com/`.
3. Copy the folder again at least every 14 days. The index of the feed expires 30 days after it was signed, and the browser installs nothing from a feed that expired.

The browser checks the signatures of the feed with the keys it ships, so a mirror cannot change what it installs. The packages themselves still come from the address that the signed feed names, GitHub Releases for the releases of the project, so the browsers need to reach `github.com` and the hosts that it sends downloads to.

## Logs

The browser writes its log to the folder `logs` of the profile, as JSON Lines: one JSON object per line with the time, the level, the part of the browser, the message and its fields.

| System  | Log file                                             |
| ------- | ---------------------------------------------------- |
| Windows | `%APPDATA%\Astela\logs\main.log`                     |
| macOS   | `~/Library/Application Support/Astela/logs/main.log` |
| Linux   | `~/.config/Astela/logs/main.log`                     |

At 5 MB, `main.log` becomes `main.1.log`, and the browser keeps two older files. A profile that `--user-data-dir` chooses has its log in its own `logs` folder. Nothing in the log leaves the device.

To find the policy values that do not apply on Linux, read the records after the last `Policies read` record:

```sh
grep -E '"(Policies read|Policy value ignored|Policy source could not be read)"' ~/.config/Astela/logs/main.log
```

## Outgoing connections

Astela collects no telemetry, uploads no crash reports and needs no account. Apart from the sites that people open and the search engine they search with, the browser connects only to:

| Connection                  | When                                                                                                                                                         | Control                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| The update feed             | Installations that update themselves: about a minute after the start, then every 4 hours, at `https://secoolioo.github.io/astela/updates/v1/` or the mirror. | `UpdatePolicy`, `UpdateURL`, `AutoUpdateCheckPeriodMinutes` |
| Packages on GitHub Releases | When the feed has an update for the installation.                                                                                                            | `UpdatePolicy`, `TargetChannel`, `TargetVersionPrefix`      |
| The package repository      | deb and rpm: when the package manager of the system checks for updates.                                                                                      | `ASTELA_NO_REPO`, `ASTELA_REPO_URL` at the installation     |
| DNS over HTTPS              | With `automatic`, the default, the DNS over HTTPS service of the system's provider where it offers one; with `DnsOverHttpsTemplates`, the services given.    | `DnsOverHttpsMode`, `DnsOverHttpsTemplates`                 |

The lists of the content blocker ship with the browser and are not downloaded. Spell checking is off on Windows and Linux, and macOS uses the spell checker of the system, so nothing reaches a dictionary server. There are no search suggestions.

## Not available yet

These parts of the [enterprise design](../architecture/enterprise.md) do not exist in this version:

- The diagnostics page `app://diagnostics`, which will list every policy with its value, source and state. Until then, the log and the settings page show the values that do not apply.
- ADMX and ADML templates for Group Policy and Intune, and a macOS configuration profile to start from.
- Safe mode. `--safe-mode` has no effect and writes a warning to the log, and `SafeModeAvailability` is an unknown policy.
- The proxy policies `ProxyMode`, `ProxyServer`, `ProxyPacUrl` and `ProxyBypassList`, and `AuthServerAllowlist` for single sign-on.
- `URLBlocklist` and `URLAllowlist`.
- The MSI properties `INSTALLDIR` and `DESKTOP_SHORTCUT`, and MSI packages of beta releases.
- Chrome policies for features that Astela does not have: `DefaultSearchProviderEnabled`, `DefaultSearchProviderName`, `DefaultSearchProviderKeyword` and `DefaultSearchProviderSuggestURL` (there are no keywords or search suggestions of the search engine), `NewTabPageLocation` (no other new tab page) and `ManagedSettings`. The browser logs them as unknown.
