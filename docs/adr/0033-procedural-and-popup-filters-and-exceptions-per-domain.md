# 0033. Procedural and popup filters, and exceptions per domain

## Status

Accepted. Completes [ADR 0028](0028-content-blocker-rules-through-a-frame-preload.md) by the procedural rules that it left out.

## Date

2026-11-09

## Context

The lists of uBlock Origin contain procedural rules, such as `:has-text()` and `:remove()`, which hide or change elements that a CSS selector cannot describe. In `0.1.0-beta.3`, the filter engine dropped them when the data was built. The lists also block popups with `$popup` filters, which the filter engine does not support; pages that open popups for ads opened them as tabs. An exception for a site covered only its exact host, so turning the blocker off on `www.example.com` left it on for `shop.example.com`.

## Decision

- **Procedural rules:** the data is built with the extended selectors of the lists. The frame preload receives the procedural rules of the frame's address together with its other rules, and evaluates them with the evaluator of the filter engine, `@ghostery/adblocker-extended-selectors`, once the document exists and again when it changes, at most every 100 ms. Elements of a hiding rule get the attribute that the rules' style sheet hides; other rules run their directive on the element, such as removing it. Each rule handles an element once.
- **Size:** the preload bundles the evaluator and is minified; the frame preload stays under the budget of 20 KiB per preload ([ADR 0017](0017-performance-budgets-in-ci.md)).
- **Popups:** the build collects the network filters with `$popup`, takes the option off, and builds a second engine from them in `popups.bin`. When a web page opens a window, the browser asks this engine with the popup's address and the page as its source. A match opens nothing and counts as blocked on the page. Data without `popups.bin` blocks no popups.
- **Exceptions per domain:** turning the blocker off on a page adds the page's registrable domain, which the filter engine computes from the public suffix list, such as `example.co.uk` for `www.example.co.uk`. An exception covers its domain and every host under it. Turning blocking back on removes the exception that covers the host. Hosts without a registrable domain, such as IP addresses, keep exceptions of their own. When the setting cannot be saved, for example because a policy sets it, the browser says so.

## Consequences

Positive:

- **Pages:** ads and notices that only procedural rules reach are hidden, as with uBlock Origin.
- **Popups:** ad popups no longer open as tabs.
- **Exceptions:** one exception works for the whole site, as people expect.

Negative:

- **Work in the page:** pages with procedural rules run the evaluator when they change, at most ten times a second.
- **Two engines:** the popup filters are matched apart from the others, so an exception filter of the main lists does not reach them; the lists put popup exceptions next to their popup filters.

## Alternatives considered

- **Evaluating procedural rules in the browser process:** it cannot see the page's elements.
- **One engine for popups and requests:** the filter engine drops `$popup` filters when it parses them.
- **Exceptions per host only:** a site that works only with the blocker off would need one exception per host.
