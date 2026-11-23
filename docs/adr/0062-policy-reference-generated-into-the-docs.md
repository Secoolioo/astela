# 0062. Policy reference generated into the docs

## Status

Accepted. Amends [ADR 0011](0011-settings-schema-as-single-source.md): the policy reference and the JSON Schema of the policy files of Linux are written into `docs/admin/` and kept in the repository, and `pnpm verify` checks that they match the policy definitions. The other artifacts of ADR 0011, such as the ADMX and ADML templates and the configuration profile for macOS, are not built yet; they are to come from the same tool. Amended by [ADR 0063](0063-chrome-policy-formats-converted-by-the-settings.md): for the policies whose values the browser converts, such as Chrome's formats, the reference describes the values that the policy takes from `app/src/main/policy-inputs.ts`.

## Date

2026-11-15

## Context

An early test of 0.1.0-beta.7 looked for the policies that an administrator can set and found no list of them. The only one was the implementation status of the [enterprise design](../architecture/enterprise.md), mixed with policies that were planned; formats that the browser checks, such as the `%s` of `DefaultSearchProviderSearchURL`, the policies that are mandatory only and the bounds of `AutoUpdateCheckPeriodMinutes`, were written nowhere but in the code. ADR 0011 planned the reference as an output of the build that CI publishes; no generator existed.

The website takes its pages from `docs/` ([ADR 0020](0020-documentation-site-and-api-docs.md)) and runs no code of the browser. The policy definitions are on the start path of the browser process, because the browser checks the policies before its first window shows, and the budget of that path ([ADR 0017](0017-performance-budgets-in-ci.md)) has no room for the texts of the reference, which are about 10 KB.

## Decision

- `allPolicies` in `app/src/main/policy-definitions.ts` is the one list of the policies: the policy service checks the values of the administrators against it, and `tools/policies/reference.ts` writes `docs/admin/policies.md` and `docs/admin/policies.schema.json` from it.
- From the definitions, the reference takes the name, the setting, the type and the allowed values, read from the Valibot schema (choices, lengths, bounds, patterns and the messages of checks), the levels, whether the policy is sensitive and whether it needs a restart. A kind of schema or check that it does not know stops it, so a new kind is described before it ships.
- What a schema cannot say lives in `tools/policies/notes.ts`: what the policy does, the formats and rules beyond the schema, and a value for the examples. The tool checks every example against its policy and stops for a policy without notes or notes without a policy. The texts stay out of the definitions, so they cost the start path nothing.
- The reference shows, for every policy, a Linux file, a `reg add` line for Windows and the key of a property list for macOS. The JSON Schema refuses names that this version does not know, so an editor marks a misspelled or unsupported policy; JSON Schema has no flags, so the tool spells the letters of case-insensitive patterns in both cases.
- Both files are kept in the repository, formatted by Prettier in the tool. `pnpm verify` runs the tool with `--check`, which fails when a file differs from what it would write, so a change of a policy changes its documentation in the same pull request, and the reference of every release is the one of its tag.

## Consequences

Positive:

- Administrators have a reference and a schema that match the code of each version, on the website and in the repository.
- A review sees how a change of a policy changes what administrators read.
- An example in the reference cannot drift from what the browser accepts.

Negative:

- Every change of a policy needs a run of the tool, and the texts of a policy are not next to its definition; the error of the tool names the file.
- The generated files are about 45 KB in the repository.

## Alternatives considered

- **Texts as a `description` of `PolicyDefinition`:** keeps them next to the code, but puts them on the start path of the browser process.
- **The reference as an output of the build only, as ADR 0011 planned:** nothing generated in the repository, but the website build would have to run the code of the browser, and a review would not see the changes.
- **A reference written by hand:** no tool, but it drifts from the code, which is what the test found.
