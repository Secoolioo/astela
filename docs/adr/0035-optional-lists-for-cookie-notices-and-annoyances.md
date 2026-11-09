# 0035. Optional lists for cookie notices and annoyances

## Status

Accepted. Extends [ADR 0027](0027-blocker-with-the-default-lists-of-ublock-origin.md) by lists that are off by default.

## Date

2026-11-09

## Context

uBlock Origin offers lists against cookie notices and against annoyances, such as newsletter boxes, chat and social widgets and notifications, in addition to its default lists, off by default. People who move from it expect them. The filter engine of the browser is built once from the lists and ships with the package, so a choice of lists at run time cannot rebuild it.

## Decision

- **Two groups:** cookie notices (EasyList – Cookie Notices, uBlock filters – Cookie Notices) and annoyances (EasyList – Other Annoyances, Chat Widgets, Newsletter Notices, Notifications and Social Widgets, uBlock filters – Annoyances), from the same repositories as the default lists (`tools/blocker/lists.ts`).
- **An engine per group:** the build writes `cookies.bin` and `annoyances.bin` next to `engine.bin`. Each also carries the exceptions of uBlock filters – Unbreak, which fix pages that any of uBlock Origin's lists break. The engines use the scriptlets and stand-ins of the main engine.
- **Settings:** `contentBlocker.cookieNotices` and `contentBlocker.annoyances`, off by default, with the policies `ContentBlockerCookieNoticesEnabled` and `ContentBlockerAnnoyancesEnabled`. An engine loads when its group is turned on or, when it is on, with the main engine; requests and frames do not wait for it.
- **Order:** a request is blocked when the main engine or an engine that is on blocks it; the element hiding rules and scriptlets of all engines that are on apply.

## Consequences

Positive:

- **Choice:** cookie notices and annoyances can be hidden without a change to the default lists, and organizations can set it.
- **No cost when off:** an engine that is off is neither loaded nor asked.

Negative:

- **Size:** the package grows by both engines, about 3 MB.
- **Exceptions:** an exception filter of one list reaches only the rules of its own engine, apart from the unbreak list, which every engine carries.

## Alternatives considered

- **Merging the engines at run time:** the filter engine can merge engines, but the result would hold a second copy of the indexes of the main engine in memory.
- **One engine per combination:** four engines would grow the package by more than 30 MB.
