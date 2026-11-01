# 0025. Read policies while Electron starts

## Status

Accepted

## Date

2026-11-01

## Context

[ADR 0012](0012-policy-providers-per-os.md) reads every policy source synchronously before `app.whenReady()`, so that policies which become Chromium switches can take effect. On Windows, that read starts two `reg export` processes one after the other, and Electron cannot emit `ready` while the main thread waits for them.

In the `perf` job on `windows-2025` on 2026-11-01, the median start-up marks were 64 ms for the first line of the main process and 115 ms once the policies were read: the read held the main thread for 51 ms. The browser reached `ready` 24 ms after the bare reference, and its warm start median of 437 ms was above the budget of 428 ms; it passed only because the difference was not significant (p = 0.095).

No policy maps to a Chromium switch yet. `AuthServerAllowlist` is the first one planned ([enterprise architecture](../architecture/enterprise.md#single-sign-on)).

## Decision

- **Before `ready`**, the policy service applies the last known policy state from the cache in the profile (`policy-cache.json`), and the fresh read starts without blocking. Providers that start processes read their sources in parallel through `loadAsync`: `reg export` for `HKLM` and `HKCU` on Windows, and `plutil` for the machine and user profiles on macOS. Linux reads its small local JSON files synchronously, as before.
- **After `ready`**, the bootstrap awaits the fresh read before it creates the settings and the first window. The shell renders only from the fresh, merged snapshot, as before.
- **Without a cache**, for example on the first start of a profile, the sources are read synchronously first, so the very first start applies every policy, Chromium switches included.
- **Chromium switches** take the policy values that apply before `ready`. If the fresh read changes such a policy, the change takes effect at the next start, and the browser shows that a restart is required: the rule that ADR 0012 already sets for changes while the browser runs.
- **Refreshes** on window focus and every 15 minutes use the asynchronous read; a refresh that starts while another one runs shares its result.

Everything else in ADR 0012 stays in force.

## Consequences

Positive:

- Reading the registry and managed preferences no longer blocks the main thread, so Electron can become ready while the sources are read. The `perf` job shows the effect in its start-up marks.
- Nothing visibly changes after the first paint, because the first window waits for the fresh policies.
- Refreshes no longer pause the browser while `reg` or `plutil` runs.

Negative:

- A policy that becomes a Chromium switch and that changed since the last start applies one start later. The first start of a profile is not affected.
- Providers that start processes have a synchronous and an asynchronous path; tests check that both return the same result.
- If the read takes longer than Electron needs to become ready, the first window waits for it, as it did before.

## Alternatives considered

- **Keep reading synchronously:** the simplest option, but it costs about 50 ms of every start on Windows.
- **Apply only the cache and read after the first window:** the fastest option, but a value that policy controls could visibly change after the first paint, and a lock that an administrator removed would stay until the read finished.
- **A native addon that reads the registry directly:** planned for M5 in ADR 0012; it needs a build for every Electron ABI and architecture.
- **Reading in a utility process:** adds a process start of its own to every launch and still starts `reg` and `plutil`.
