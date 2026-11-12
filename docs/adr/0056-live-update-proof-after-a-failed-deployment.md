# 0056. Live update proof after a failed deployment

## Status

Accepted. Changes when [ADR 0016](0016-release-pipeline-without-bot-commits.md) runs the live update proof; the proof itself stays.

## Date

2026-11-12

## Context

The live update proof installs the previous release of the channel and checks that it updates itself to the new one through the live feed and package repositories. It ran only in the run of `release.yml` that publishes the release, after the `pages` job. When that job failed, the proof was skipped: for `0.1.0-beta.4`, GitHub took longer to publish the site than the deploy action allowed, and for `0.1.0-beta.5`, the link check of the website stopped at a broken link.

The release is public by then, so the fix of the cause lands in a later commit. Its run does not release, because the version is published, and it skipped the proof. Re-running the failed jobs of the release run does not help when the cause is in the commit of that run, as the broken link was, and it needs a person with access to the workflow runs.

## Decision

- **Catch-up:** a run of `release.yml` that does not release runs the live update proof after its deployment when the version on `main` is published, has a previous release, came out at most 14 days ago, and no proof of it has passed on `main` (`live` of `tools/release/plan.ts`). This covers a proof that the release run skipped and one that failed.
- **Record:** when every job of the proof passes, the job `live-update-proof` keeps the artifact `live-update-v<version>` for 90 days. The plan lists the artifacts of that name with the read access to Actions of its token and counts only one that has not expired and that a run on `main` of the repository itself kept, so a pull request, also from a fork, cannot stop the catch-up. A lookup that fails is a warning, and the run deploys without the proof.
- **Conditions:** the jobs of the proof and of the record check their needs with an explicit status function, because a run that does not release skips the jobs above them.

## Consequences

Positive:

- A proof that a failed deployment skipped runs again without a person, with the first fix that deploys.
- The proof runs against what is deployed, so a fix of the feed or the repositories is proven as well.

Negative:

- Until the proof passes, each run on `main` within the 14 days runs it again, which takes the Windows and Linux jobs about 15 minutes. A proof that keeps failing, because the update path is broken, turns each of these runs red until a release with the fix passes its own proof or the 14 days end.
- The catch-up proves the previous release against the feed and repositories of a later commit, as the weekly runs of `pages.yml` build them.

## Alternatives considered

- **Re-running the failed jobs:** keeps the plan of the release run, but repeats a failure that its commit causes and needs a person.
- **A record in the release or on the website:** releases are immutable once published, and the website is deployed before the proof runs.
- **Running the proof in every deployment:** proves more often, but costs the jobs on every commit to `main`.
