# Architecture decision records

An architecture decision record (ADR) captures one significant decision: the situation that called for it, what was decided, what follows from it, and which alternatives were rejected and why. Astela keeps its ADRs in this folder so that the reasoning behind the architecture is versioned and reviewed together with the code. [ADR 0001](0001-record-architecture-decisions.md) describes when an ADR is needed and how records are changed or superseded.

The [architecture documents](../architecture/overview.md) describe how the system works; the ADRs explain why it is built that way. The [roadmap](../roadmap.md) shows when the decided pieces arrive, and [WORKFLOW.md](../maintainers/WORKFLOW.md) defines how changes, including new ADRs, are reviewed and merged.

## Template

Every ADR is a Markdown file named `NNNN-short-title.md`, written in English, with these sections:

```markdown
# NNNN. Title in sentence case

## Status

Proposed, Accepted, Deprecated, or Superseded by ADR NNNN.

## Date

The date of the decision in ISO format (YYYY-MM-DD).

## Context

The forces at play: requirements, constraints, facts and measurements that make a decision necessary.

## Decision

What is decided, stated in the present tense and concretely enough to implement and review.

## Consequences

The expected positive and negative results, as bullet points.

## Alternatives considered

Each rejected option as a bullet point with a short reason.
```

## Index

| ADR                                                                    | Title                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------- |
| [0001](0001-record-architecture-decisions.md)                          | Record architecture decisions                           |
| [0002](0002-electron-and-webcontentsview.md)                           | Electron and the WebContentsView model                  |
| [0003](0003-packaging-with-electron-builder.md)                        | Packaging with electron-builder                         |
| [0004](0004-typescript-toolchain-and-build.md)                         | TypeScript toolchain and build                          |
| [0005](0005-ui-with-lit-web-components.md)                             | UI with Lit web components                              |
| [0006](0006-dependency-injection-container.md)                         | Dependency injection container                          |
| [0007](0007-ipc-contracts-and-validation.md)                           | IPC contracts and validation                            |
| [0008](0008-internal-pages-via-app-protocol.md)                        | Internal pages via the `app://` protocol                |
| [0009](0009-storage-with-node-sqlite.md)                               | Storage with `node:sqlite`                              |
| [0010](0010-module-system-and-lazy-loading.md)                         | Module system and lazy loading                          |
| [0011](0011-settings-schema-as-single-source.md)                       | Settings schema as single source                        |
| [0012](0012-policy-providers-per-os.md)                                | Policy providers per OS                                 |
| [0013](0013-theme-system-and-design-tokens.md)                         | Theme system and design tokens                          |
| [0014](0014-update-architecture-with-signed-feed.md)                   | Update architecture with a signed feed                  |
| [0015](0015-linux-package-repositories.md)                             | Linux package repositories                              |
| [0016](0016-release-pipeline-without-bot-commits.md)                   | Release pipeline without bot commits                    |
| [0017](0017-performance-budgets-in-ci.md)                              | Performance budgets in CI                               |
| [0018](0018-content-blocker-engine.md)                                 | Content blocker engine                                  |
| [0019](0019-license.md)                                                | License: MPL-2.0                                        |
| [0020](0020-documentation-site-and-api-docs.md)                        | Documentation site and API docs                         |
| [0021](0021-repository-layout-and-architecture-rules.md)               | Repository layout, linting and architecture rules       |
| [0022](0022-test-strategy.md)                                          | Test strategy                                           |
| [0023](0023-internationalization.md)                                   | Internationalization                                    |
| [0024](0024-icons-and-typography.md)                                   | Icons and typography                                    |
| [0025](0025-read-policies-while-electron-starts.md)                    | Read policies while Electron starts                     |
| [0026](0026-internal-pages-share-tabs-with-web-pages.md)               | Internal pages share tabs with web pages                |
| [0027](0027-blocker-with-the-default-lists-of-ublock-origin.md)        | Content blocker with the default lists of uBlock Origin |
| [0028](0028-content-blocker-rules-through-a-frame-preload.md)          | Content blocker rules through a frame preload           |
| [0029](0029-import-from-other-browsers-in-the-data-service.md)         | Import from other browsers in the data service          |
| [0030](0030-default-browser-and-links-from-other-apps.md)              | Default browser and links from other apps               |
| [0031](0031-scriptlets-in-their-own-scope-and-world.md)                | Scriptlets in their own scope and world                 |
| [0032](0032-replacement-resources-over-a-scheme-of-their-own.md)       | Replacement resources over a scheme of their own        |
| [0033](0033-procedural-and-popup-filters-and-exceptions-per-domain.md) | Procedural and popup filters, and exceptions per domain |
| [0034](0034-overlay-view-for-popovers-and-prompts.md)                  | Overlay view for popovers and prompts                   |
| [0035](0035-optional-lists-for-cookie-notices-and-annoyances.md)       | Optional lists for cookie notices and annoyances        |
| [0036](0036-problem-pages-drawn-by-the-shell.md)                       | Problem pages drawn by the shell                        |
| [0037](0037-policies-read-without-blocking-on-every-start.md)          | Policies read without blocking on every start           |
| [0038](0038-site-permissions-asked-in-the-overlay.md)                  | Site permissions asked in the overlay                   |
| [0039](0039-downloads-without-a-question-and-a-list-in-the-profile.md) | Downloads without a question, and a list in the profile |
| [0040](0040-tabs-and-popups-that-keep-their-opener.md)                 | Tabs and popups that keep their opener                  |
| [0041](0041-private-windows-with-a-session-in-memory.md)               | Private windows with a session in memory                |
| [0042](0042-density-and-text-size-scale-the-whole-interface.md)        | Density and text size scale the whole interface         |
| [0043](0043-themes-as-palettes-edited-on-the-settings-page.md)         | Themes as palettes, edited on the settings page         |
| [0044](0044-third-party-cookies-blocked-by-chromium.md)                | Third-party cookies blocked by Chromium                 |
| [0045](0045-minified-main-bundle-with-names-kept.md)                   | A minified main bundle that keeps names                 |
| [0046](0046-motion-rounder-shapes-and-one-shadow.md)                   | Motion, rounder shapes and one shadow                   |
| [0047](0047-address-suggestions-in-a-part-of-the-overlay.md)           | Address suggestions in a part of the overlay            |
| [0049](0049-logo-and-colors-of-the-brand.md)                           | Logo and colors of the brand                            |
| [0056](0056-live-update-proof-after-a-failed-deployment.md)            | Live update proof after a failed deployment             |
