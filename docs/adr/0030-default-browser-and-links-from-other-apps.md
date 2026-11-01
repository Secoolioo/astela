# 0030. Default browser and links from other apps

## Status

Accepted

## Date

2026-11-01

## Context

A browser is only used every day when it opens the links of other apps. Each system decides differently which browser that is: Windows 10 and 11 let only the user choose, in the system settings, among browsers that registered themselves; macOS asks the user to confirm a change; Linux desktops follow `xdg-settings`. Links arrive as command line arguments of a new start, or as `open-url` events on macOS. A link on the command line must never act as a switch of the browser.

## Decision

- **Links:** the browser opens `http` and `https` links from its command line, from the start of a second instance and from `open-url` events, at most 50 per start, in new tabs of the window used last. A start with links and without a session to restore shows only them. Every other argument is ignored.
- **Registration on Windows:** the NSIS installer registers the browser under `StartMenuInternet` and `RegisteredApplications` with a program id for web links whose command passes the link after `--`, and the uninstaller removes it unless an update replaces the version. The Windows smoke test checks both. Making the browser the default opens the Windows settings on its page.
- **macOS and Linux:** the app declares itself a viewer of web links and asks the system to make it the handler of `http` and `https` links.
- **Policy:** `DefaultBrowserSettingEnabled` set to `false` hides the setting.
- MSI installations are not registered; organizations manage the default browser of their computers with their own tools.

## Consequences

Positive:

- Links from email and chat apps open in a tab, on all three systems.
- No switch can be passed through a link.

Negative:

- On Windows, the browser cannot make itself the default; the user finishes the change in the system settings.
