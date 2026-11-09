# 0037. Policies read without blocking on every start

## Status

Accepted. Replaces the synchronous read of a start without a cache in [ADR 0025](0025-read-policies-while-electron-starts.md).

## Date

2026-11-09

## Context

[ADR 0025](0025-read-policies-while-electron-starts.md) reads policies while Electron starts and applies the cached state until then, but reads the sources synchronously on a start without a cache, so that Chromium switches from policies apply on the very first start. To read synchronously, the start-up path of the browser process had to contain the parsers of registry exports and property lists on every system, although each system needs one of them at most: they were about 7 KB of the 150 KB that the start-up path may have ([ADR 0017](0017-performance-budgets-in-ci.md)). No policy sets a Chromium switch yet; those that are planned, such as for proxies and sign-in, can be applied while the browser runs.

## Decision

- **One way to read:** the policy providers only read without blocking. Every start applies the cached state, if there is one, and the bootstrap awaits the fresh read after `ready`, before the settings and the first window.
- **Parsers per system:** the provider of the Windows registry loads the parser of registry exports with its first read, and the provider of macOS loads the parser of property lists once a profile exists. Linux needs neither.
- **Chromium switches:** a policy that can only take effect as a Chromium switch before `ready` applies from the start after the one that first read it, with the notice that a restart is required, as ADR 0025 already sets for a policy that changes.

Everything else in ADR 0025 and [ADR 0012](0012-policy-providers-per-os.md) stays in force.

## Consequences

Positive:

- **Smaller start:** the start-up path of the browser process loses about 7 KB, and on Linux the parsers never load.
- **One path:** the start without a cache and the start with one read the same way.

Negative:

- **First start:** a policy that needs a Chromium switch does not apply on the very first start of a profile.

## Alternatives considered

- **Keeping the synchronous read:** it needs the parsers of every system in the start-up path.
- **Loading the parsers synchronously from separate files:** the bundle of the browser process is an ES module, which cannot load a module synchronously.
