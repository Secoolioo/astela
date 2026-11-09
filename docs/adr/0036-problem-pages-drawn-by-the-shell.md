# 0036. Problem pages drawn by the shell

## Status

Accepted. Replaces the error page `app://error` that the plan for `0.1.0-beta.4` named.

## Date

2026-11-09

## Context

When a page could not be loaded, Electron showed an empty page, and a page whose renderer crashed stayed blank, with no way to tell what happened. Chromium commits a failed load as an error page under the failed address: Back and Forward pass it, and a reload of it loads the address again. The plan was a page `app://error` in the tab; as an internal page, it would need a view of the browser's session, a history entry of its own and special cases for the address bar and for reloading, so that Back and reload behave as in other browsers.

## Decision

- **The shell draws the page:** when the main frame of a tab fails to load (except a load that a new navigation stopped) or its renderer is gone, the tab records the problem: its kind, Chromium's name for the cause and the address. The browser hides the tab's view, and the shell shows the problem in its content area, with a button that reloads the tab.
- **Chromium keeps the history:** the failed load stays Chromium's own history entry. The address bar shows its address, the reload button and shortcut try it again, and Back leaves it. The problem ends with the next page that the tab shows.
- **Certificates:** a failed load whose cause is the certificate of the site shows a warning instead. It offers the way back and, unless the policy `SSLErrorOverrideAllowed` is `false`, a way on to the page behind a disclosure. Continuing accepts that certificate for that host until the browser quits; certificates of embedded frames are refused without a warning.
- **Hanging pages:** when a page stops responding to input, a dialog of the system asks whether to wait or to close the page; it closes by itself when the page responds again.

## Consequences

Positive:

- **Behavior:** Back, Forward, reload and the address bar work on a failed page as in other browsers, without special cases.
- **Look:** the problem pages use the shell's design tokens and languages.

Negative:

- **One area:** the shell's content area shows problem pages only for the active tab; switching tabs shows the problem of the tab that is switched to.

## Alternatives considered

- **`app://error` in the tab:** it would add a history entry and need the failed address carried along for the address bar and reload.
- **Injecting into Chromium's error page:** the error page has no bridge to the browser, and its content would come from outside the browser's own pages.
