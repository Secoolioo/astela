# Performance

> **Status:** partly implemented. The harness checks the start-up, idle memory, idle CPU, bundle and size budgets on every pull request. See [implementation status](#implementation-status).

Performance comes first among Astela's [principles](principles.md). Budgets are measured in CI, and every regression fails the build. The decision record is ADR 0017 (performance budgets in CI); see the [decision record index](../adr/README.md).

## Baseline

These facts set the starting point (as of October 2026). Unless noted otherwise, they refer to Electron 45.0.0 with Chromium 156.0.8078.48, Node 24.22.0 and V8 15.6.

- **Package size:** Electron itself makes up about 97 % of the package size. The Electron 45 zip archives measure 123.9 MB on Linux, 158.2 MB on Windows and 120.7 MB on macOS arm64. Typical installers of real-world apps on Electron 44: NSIS 121 MB, dmg 133 MB, AppImage 129 MB, deb 100 MB, rpm 89 MB.
- **Memory:** the fixed processes (browser, GPU and network service) take about 220–250 MB resident. Every sandboxed renderer adds about 17–28 MB of private memory.
- **Startup:** spawn to `ready` takes about 149 ms (Linux, Electron 45 with its Node snapshot); spawn to the first contentful paint of an empty page takes about 286–317 ms (Apple Silicon).
- **CI runners:**
  - Linux and Windows: 4 vCPU, 16 GB.
  - macOS arm64: only 3 vCPU, 7 GB.
  - No GPU rendering, only the software path.
  - Variance is high, so measurements are taken **relative** to a bare Electron reference in the **same job**.

Most of the size and the fixed memory cost come from Electron itself. The budgets therefore limit what Astela adds on top of a bare Electron app with the same structure.

## Mandatory techniques

These techniques apply from M1:

1. **A tiny main entry point:**
   - The BootGuard, policies, settings and the window come first; everything else loads through `import()` after the first paint.
   - Nothing awaits large bundles before `ready`.
   - `Menu.setApplicationMenu` is set early.
   - The policies are read once at start. The focus that the first window gets while it opens does not read them again; on Windows, that read started two more `reg.exe` processes while the shell loaded.
2. **Shell UI from the `app://` scheme** with the `codeCache` privilege and `v8CacheOptions: 'bypassHeatCheck'`, served with `protocol.registerSource`, so files stream without the main thread (see ADR 0008). The pages come without a `Cross-Origin-Opener-Policy`, so that each loads in the renderer that its view started (see [security](security.md#content-security-policy)): with the header, Chromium started a second renderer for the shell and for the new tab page, and the shell was interactive 27 ms after the page of the bare reference instead of 12 ms (medians of 20 starts on Linux, November 2026).
3. **Bundles:** main, preload and UI are built with Vite and Rolldown. Module chunks load only when their module is active (see [modules](modules.md)). The bundles keep licence comments but no doc comments; that alone took the main process start-up path from 140 to 104 KB. Code that only some starts need, such as the self-test of the packages, the help page for a missing sandbox and the update feed, is in chunks of its own that load when they are needed; on 2026-11-01 that took 11 KB off the start-up path, which was then 138 KiB. The handlers of the browser's own pages other than the new tab page load with the first of these pages, before it loads; on 2026-11-09 that took the start-up path from 149.4 to 141.6 KiB. The code of the content blocker that works with its filter engine loads with the engine, at the first web page; the start-up path keeps only the part that decides whether a request needs the engine, which took it from 148.0 to 143.8 KiB on the same day. The parsers of the Windows registry and of macOS property lists load with the first policy read on their system ([ADR 0037](../adr/0037-policies-read-without-blocking-on-every-start.md)), which took it from 146.1 to 138.6 KiB. The code that shuts the browser down loads when it quits, which took the start-up path of 0.1.0-beta.4 from 150.1 to 148.1 KiB. Requests of the shell that its first paint does not need, such as find in page, the browser menu and the popovers, load with the first of them, which took it from 148.1 to 145.4 KiB, to leave room for the settings of 0.1.0-beta.5. The chunks of the main process that hold only dependencies, such as valibot, which every start reads, were minified first, with the names of functions and classes kept, which took the start-up path from 147.2 to 137.8 KiB on 2026-11-09. Since 2026-11-10, Astela's own code in the main process is minified the same way, so stack traces still name its functions and classes, and the licence notices of the dependencies stay ([ADR 0045](../adr/0045-minified-main-bundle-with-names-kept.md)); that took the start-up path from 149.4 to 86.2 KiB. The features of 0.1.0-beta.5 and 0.1.0-beta.6 grew it again, to 113.2 KiB in 0.1.0-beta.6. With the foundations that the features of 0.1.0-beta.7 build on, such as the tab strip, the reading of the session field by field and the one place where a window attaches the views of its pages, it was 118.2 KiB on 2026-11-10, as `tools/perf/run.ts` measures it. The browser menus and popovers of the overlay keep only the command that opens the menu, the tap of Alt and the state of the popovers on it, and load the rest with their first request ([ADR 0050](../adr/0050-browser-menus-and-popovers-in-the-overlay.md)), which took it to 120.3 KiB on the same day. The command palette keeps its two commands, the keys that a window holds after its shortcut and some wiring on the start-up path, and loads the rest with its first shortcut (`app/src/main/palette.ts`, [ADR 0052](../adr/0052-command-palette-and-tab-search-in-the-overlay.md)), which took it to 123.2 KiB. The exact session needs the reading and the limits of the history of each tab before the first window, and keeps the tabs without a view, their waking, the marker of a running browser, the decision whether a start restores the session and the timing of its writes on the start-up path; the code that fits a large session into its budget loads with the first session that needs it ([ADR 0053](../adr/0053-sleeping-tabs-and-an-exact-session.md)). That took it to 132.4 KiB, 9.2 KiB more than before. Counted with the chunks that it imports, that start-up path was 146.8 KiB. What only web pages use then moved off it and loads with the first web page (`app/src/main/web-requests.ts`): the steps of the request pipeline, HTTPS-First, the third-party cookies and the part of the content blocker that decides about requests, with the exceptions for certificates and the answers to the frames of web pages. Their listeners stay on the start-up path, and a request or a frame that comes while the code loads waits for it, so the first page is filtered as before. The code of the windows that follows the views of web pages, as they navigate, fail or stop answering, with their zoom and icons, loads with the first web page as well (`app/src/platform/electron/web-pages.ts`), and a web page loads only once it follows its view; calls that come meanwhile run in their order (`app/src/kernel/modules/later-code.ts`). The window commands that do not move the focus, such as closing a tab or zooming, load with the first of them or once the shell has loaded (`app/src/platform/electron/window-commands.ts`); those that move the focus, such as a new tab or the address bar, run at once, so the keys typed right after them follow the focus, and a command that comes while others wait for their code waits behind them. The helpers that only menus and the settings page use to show shortcuts went into a module of their own, and the start of the sandbox help into its chunk. The recorder of the editor of shortcuts loads with the handlers of the browser's own pages, before the settings page (`app/src/platform/electron/shortcut-recorder.ts`); the changes that the shield makes to the sites on which the content blocker is off load with the shield, and the mode that the update policy gives with the updates. Where the popups of pages go and how Back and Forward step through the history of a tab without a view are modules of their own too, apart from where the windows of a session were and the histories that it keeps, which the start reads. That took the start-up path from 146.8 to 134.1 KiB on 2026-11-12. Sleeping tabs keep on the start-up path when each tab was last used and the two settings with their policies. What keeps a page awake, such as a camera that a page was granted, a download that it started or a key that people typed into it (`app/src/platform/electron/tab-activity.ts`), loads with the code for web pages, before the first web page loads, as no other page can be busy. Putting a tab to sleep and telling which tabs may sleep load with the commands of the windows, and the timer that puts tabs to sleep by themselves after the first shell (`app/src/main/tab-sleep.ts`), which looks at the tabs at most once a second; the menus, the command palette and the timer ask the windows only once those commands are there (`WindowManager.laterCode`). In the same step, more of what the first window does not need moved behind `import()`: the buttons of the toolbar, with the steps of Back and Forward through the history of a tab without a view, the items of the menu of a tab, what decides which commands can run, opening the browser's own pages and forgetting the histories of tabs load with the commands of the windows (`app/src/platform/electron/window-commands.ts`); the sound, the problems and the search of web pages, with the steps after a refused certificate, with the code for web pages (`app/src/platform/electron/web-pages.ts`); and the downloads, the logins, the permissions, the pages that scripts open, with where popups go, and the frame preload of web pages with the code for their requests (`app/src/main/web-requests.ts`), which now loads with the code for web pages as well. That took the start-up path from 134.1 to 130.3 KiB, 3.8 KiB less than before sleeping tabs, which leaves 19.7 KiB of the budget. Split view adds 6.8 KiB (5.2 %), more than the 4 KiB that the plan of 0.1.0-beta.7 gave it ([ADR 0054](../adr/0054-split-view-with-two-tabs-side-by-side.md)): from the first window on, a window shows the two pages of a pair and makes the side that takes the focus the active tab, the tab strip keeps its pairs as units for every move, insertion and close, and the session reads and writes them; the shortcut runs in the window, so that its first press waits for no chunk. The items of the tab menu, the swap of the sides, the moves of the divider and the sides of the questions load with the commands of the windows, and the View menu of macOS with its chunk. That took the start-up path to 137.1 KiB, which leaves 12.9 KiB of the budget.
4. **No synchronous IPC.** State patches are batched per frame. SQLite and hashing run in a `utilityProcess` (see [IPC](ipc.md) and [data](data.md)). The session is built again only after changes that it keeps, such as a tab that opens or a page with another address, not for every request that the content blocker blocks or every page that loads. A new title alone, as of a page that counts down or shows unread messages in its title, builds and writes the session only after 30 seconds, as `session.json` can hold several MB of page states ([ADR 0053](../adr/0053-sleeping-tabs-and-an-exact-session.md)). A start that does not restore the session reads its file but does not parse it, and the history of each restored tab is cut to its limits once. Without the file, a start reads its backup with it, so that the first window does not wait for that read.
5. **Tab resources:**
   - Tabs are lazy and restore their history with `navigationHistory.restore()`.
   - A sleeping tab keeps its navigation entries, within the limits of memory; its `webContents` is closed. It gets no thumbnail yet ([ADR 0053](../adr/0053-sleeping-tabs-and-an-exact-session.md)).
   - Tabs go to sleep by themselves after `tabs.sleepAfter` seconds without use. One timer waits for the tab that becomes due first; none runs while no tab can become due, so an idle browser with one window wakes up for nothing.
   - `backgroundThrottling` stays on.
   - Every tab view uses `focusOnNavigation: false`: no page takes the focus by itself when it loads, also not the page of the other side of a split view, and the browser gives the page of the active tab the focus itself ([ADR 0054](../adr/0054-split-view-with-two-tabs-side-by-side.md)). A view takes the focus only once its page loads, so a view whose page waits for its code gets it as the page starts to load. The load of the new tab page so never takes the focus from the address bar.
   - A split view shows two pages, which both render; only the pages that the window shows load at a restore, so a restored split view loads both of its pages and no other tab. While the divider moves, the shell sends at most one request per frame and every 8 ms, and the browser process only lays the two pages out, without a state for the shell or a write of the session until the divider is let go.
6. **UI and package:**
   - UI animations use only `transform` and `opacity`, respect `prefers-reduced-motion` and run no timers while idle (see [design system](design-system.md)).
   - `electronLanguages` is limited to the shipped UI languages, English and German, which saves up to 12.8 MB compressed on Windows (as of October 2026).
   - The asar archive is unpacked as little as possible.
7. **Decided later, based on measurements:**
   - A V8 snapshot, only if it gains more than 50 ms, because it replaces the built-in Node snapshot.
   - `--process-per-site` for Astela's own UI surfaces only, never for web tabs.
   - A spare renderer for faster new tabs.

New dependencies need a stated reason. Anything larger than 20 KB gzipped in the UI, or with native code, needs a decision record (see the [maintainer workflow](../maintainers/WORKFLOW.md)).

## Budgets

The budgets are CI gates: a regression fails the build. "Bare" means the bare Electron fixture described under [measurement method](#measurement-method).

| Metric                                                               | Budget                                                                                                                                                                                                          | Type                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Warm start: spawn to interactive shell                               | ≤ bare + 120 ms **and** ≤ 1.25 × bare; ceiling 1.0 s (Linux, Windows). On macOS this is the target; until the shell starts faster there, the gate is 1.75 × bare (see [known gaps](#known-gaps))                | relative + ceiling  |
| Spawn to first restored tab painted                                  | ≤ interactive shell + 150 ms                                                                                                                                                                                    | relative            |
| Cold start (cache dropped: `drop_caches` on Linux, `purge` on macOS) | ≤ bare + 250 ms **and** ≤ 1.5 × bare; gates on Linux and macOS. Windows reports only, because its file cache cannot be cleared reliably.                                                                        | relative            |
| Memory, idle (1 window, new tab page), after 15 s                    | Linux PSS and Windows private bytes ≤ bare + 60 MB; macOS `phys_footprint` ≤ bare + 50 MB; ceiling 350 MB PSS                                                                                                   | relative + ceiling  |
| Memory, 20 active tabs (20 local fixture origins)                    | ≤ 1.10 × bare with 20 views + 80 MB; ceiling 1.5 GB PSS                                                                                                                                                         | relative + ceiling  |
| Memory, 1 active and 19 sleeping tabs                                | ≤ idle memory + 30 MB; at least 85 % of a tab's memory released within 5 s                                                                                                                                      | relative            |
| CPU, idle for 60 s, 1 window                                         | sum of all processes ≤ 0.5 % of one core and ≤ bare + 0.2 percentage points                                                                                                                                     | absolute + relative |
| CPU, 20 static background tabs                                       | ≤ 1.0 % of one core                                                                                                                                                                                             | absolute            |
| Tab switch, live tab                                                 | p50 ≤ 33 ms, p95 ≤ 66 ms                                                                                                                                                                                        | absolute            |
| Tab switch, sleeping tab                                             | thumbnail ≤ 50 ms; content p95 ≤ 400 ms                                                                                                                                                                         | absolute            |
| Workspace switch (20 live tabs)                                      | p95 ≤ 100 ms, no new processes                                                                                                                                                                                  | absolute            |
| Installer per format                                                 | ≤ bare Electron installer of the same format, built in the same run, + 8 MB. Absolute caps are calibrated in the walking skeleton from measured bare packages and recalibrated for every Electron major.        | delta               |
| Unpacked size                                                        | ≤ bare + 25 MB                                                                                                                                                                                                  | delta               |
| UI JavaScript                                                        | start chunk ≤ 300 KB minified (about 90 KB Brotli); all UI JavaScript ≤ 1 MB; preload ≤ 20 KB; main startup path ≤ 150 KB; growth above 2 % or 10 KB per pull request needs a justification in the pull request | absolute            |

### Related targets

The M1 acceptance criteria and the settings, policy and theme design add these targets, each designed to be checked by an automated test:

- Opening and closing 100 tabs leaves memory at no more than 110 % of the starting value (no leak).
- Restoring a session with 100 tabs stays within the startup budget plus 150 ms; only visible tabs load.
- Full-text history search answers in less than 50 ms with 100,000 entries.
- Address bar suggestions from history, bookmarks and open tabs appear in less than 30 ms.
- A change in the theme editor is visible in less than 100 ms; switching a workspace theme is a token swap within one frame.
- Reading policies does not block the start: the last known policies apply before `app.whenReady()`, and the sources are read while Electron starts (see [settings, policies and themes](settings-policy-theme.md) and [ADR 0025](../adr/0025-read-policies-while-electron-starts.md)). Read synchronously, they took 51 ms of the warm start on Windows (median, 2026-11-01).

## Measurement method

### Bare fixture

The reference is a bare Electron app with:

- the same Electron version,
- the same fuses and flags,
- the same topology: a `BaseWindow` with a UI view and N tab views,
- the same local fixture pages.

### Procedure

- One job runs **three** variants in alternation: the pull request build, the `main` build (the artifact of the last green `main` run) and the bare fixture. Results are never compared across runs on shared runners.
- **Timing:** n = 20, with median and p90. A metric fails only when a Mann-Whitney U test gives p < 0.01 **and** the effect exceeds the threshold.
- **Memory:** n = 10, with the threshold rule applied to the median, because PSS varies little.
- One automatic rerun happens before a check fails.
- The first start after an update is excluded from the gates and reported separately.

### Memory metrics

- Linux: the sum of `Pss` from `/proc/<pid>/smaps_rollup` across all processes (gating).
- Windows: `privateBytes`.
- macOS: `phys_footprint`.
- RSS is never summed, because shared pages would be counted once per process.

### CPU

CPU load is the change in `cumulativeCPUUsage` over 60 seconds.

The browser runs with its update check turned off by the `UpdatePolicy` policy (`0`). The first check fetches the update feed 30 to 60 seconds after the start, inside the window, and what it costs depends on the network and on the feed: once the first release was live, the browser's idle load on macOS rose from 0.01 to between 0.13 and 0.23 percentage points above the reference. The check repeats only every four hours, so a 60-second window would weigh it far too much. To measure locally in the same way, set the same policy.

### Startup marks

The harness will record these marks:

1. spawn,
2. first main-process JavaScript,
3. `ready`,
4. window visible,
5. first contentful paint of the shell and the interactive mark,
6. first tab painted.

### History without commits

Measurement history is never committed to the repository:

- Every CI run will keep its results as a workflow artifact.
- Every release will carry a `perf.json` asset.
- The website will show the real measurements under `/features/performance`.

### Runner variance

An A/A run once a week compares identical builds. It measures the runner variance and calibrates the thresholds.

The performance harness is designed to run on every pull request on all three operating systems; on macOS, the limited runners allow only relative values. See [testing](testing.md) for the overall test strategy.

## Implementation status

The harness (`tools/perf/run.ts`) runs in the `perf` job of every pull request on `ubuntu-24.04`, `windows-2025` and `macos-15` and fails the build when a budget is exceeded. It checks:

- **Warm start:** n = 20 after two warm-up rounds, median against the bare reference and, on Linux and Windows, the ceiling. On macOS it gates at 1.75 × bare for now and reports whether the regular budget was met (see [known gaps](#known-gaps)). A median over the budget fails only when a one-sided Mann-Whitney U test (`tools/perf/stats.ts`) shows that the browser's times are significantly larger than the reference times plus the allowed difference (p < 0.01); the job summary shows the p-value. On the 3-core macOS runners the difference to the reference varied between 73 and 152 ms across identical builds, so a median alone was not a reliable gate. Each variant keeps its profile between runs and quits normally, as in real use. The interactive mark is the ready time in the self-test report, taken once the shell has loaded and rendered; the report also carries the marks `main`, `policies`, `ready`, `window`, `settings`, `shell` and `rendered` in milliseconds since process start. After the ready time, the browser and the reference read the timing of their UI page and add it on the same clock: `page.start` (start of the navigation), `page.fetch`, `page.responseEnd`, `page.interactive`, `page.domReady`, `page.domReadyEnd` and `page.loadStart` from Navigation Timing, and in the browser `page.preload` and `page.script`, marks that the shell's preload and its main script set when they start to run. Pages from `app://` and `file://` get no Resource Timing entries, so the marks cannot split the time per file. The job summary shows the medians of all marks in one table, in the order of the browser's start-up, next to those of the reference and with the difference, so it shows in which step the browser loses time.
- **Memory, idle:** n = 10 after 15 s, median, with the metric per operating system above. On Linux, the harness reads the memory maps of sandboxed processes through `sudo`.
- **CPU, idle:** one 60-second window per variant, after 15 s. Each process of the variant counts the processor time it used in the window, and the job log names the busiest ones. On Windows, a process keeps the id of its parent after the parent ended, and Windows gives that id to new processes, so the harness counts a process only as the child of one that started before it; before that, unrelated processes counted for a variant now and then, which made a window measure too much or less than nothing. When the browser is over the budget, each variant gets a second window, and the quieter window of each counts: an idle browser does not get busier by itself, while background work of the runner comes and goes. On Windows, one window of 15 runs in November 2026 measured 0.31 % where the others measured between 0.00 and 0.23 %. The harness takes the keyboard focus from each window as it opens (`--background`), so the idle window is a window in the background, as when the user works in another app, for the browser and the reference alike: on Linux with `xdotool`, which puts the input focus on no window; on macOS by making Finder the active app; and on Windows with a small window of PowerShell that takes the foreground until the window was measured. A window that has the focus can show a blinking caret, such as that of the address bar. On Linux, where Xvfb has no window manager and a window activates itself as it opens, that caret, drawn by software rendering, measured 0.42 instead of 0.08 % of one core. The `perf` job sets the `UpdatePolicy` policy to `0` through the registry, managed preferences or `/etc/astela/policies/managed/`, and with `--updates-off` the harness reads the browser's log and fails if the update service was not off in every run.
- **UI JavaScript, preloads and the main start-up path:** sizes of the built bundles. The start-up path is the entry of the main process and every chunk that it loads through static imports, in formatted and in minified code (`tools/perf/start-path.ts`); chunks that load with `import()` are not part of it. Until 2026-11-12 the harness did not find the imports of minified code and counted the entry alone, so the values it reported after the main process was minified, such as the 86.2 KiB above, were too low: on 2026-11-12 the start-up path of `main` was 114.0 KiB, of which the entry is 101.0 KiB. With the exact session it was 146.8 KiB, and 134.1 KiB once the code for web pages, the window commands and the recorder of shortcuts loaded with their first use.
- **Unpacked size:** the unpacked package against the Electron distribution.

The bare reference (`app/tests/perf/bare/`) runs in a copy of the Electron distribution as its app folder, with the fuses of a shipped package except the two asar fuses. Each group of measurements that fails is measured once more before the job fails. Results are kept as the `perf-<os>` workflow artifact.

### Known gaps

- **Warm start on macOS:** on the 3-core `macos-15` runners the browser reaches its interactive shell 10 to 60 % later than the bare reference (median 28 % across 12 runs in October 2026), while Linux stays within 6 % and Windows within 16 %. In the two runs with start-up marks, the extra time fell between the window and the loaded shell: 379 and 508 ms there, against 254 and 172 ms for the reference's page; the `page.*` marks split this interval into the steps of the page load. The reference alone took between 337 and 935 ms on these runners, so an absolute ceiling would judge the runner. Until the cause is found and the shell starts faster on macOS, the harness gates macOS at 1.75 × bare, which still catches a large regression, and reports the regular budget as the target.

Not implemented yet: the comparison with the `main` build, the cold start, the tab, workspace and 20-tab budgets, the installer budgets, the first-tab-painted mark, the weekly A/A run and the `perf.json` release asset.
