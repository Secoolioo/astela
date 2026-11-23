# 0063. Chrome's policy formats converted by the settings

## Status

Accepted. Amends [ADR 0062](0062-policy-reference-generated-into-the-docs.md): for the policies whose values the browser converts before it checks them, the reference describes the values that the policy takes from `app/src/main/policy-inputs.ts`, not from the schema of the setting.

## Date

2026-11-15

## Context

An early test of 0.1.0-beta.7 copied a policy file of Chrome and found that the policies named after Chrome's refused Chrome's formats: `{searchTerms}` in `DefaultSearchProviderSearchURL`, an address without a scheme in `HomepageLocation` and `RestoreOnStartupURLs`, and the variables `${user_name}` and `${machine_name}` in `DownloadDirectory`, which the browser took literally as the names of folders.

The browser checks the policies before its first window shows, so their schemas are on the start path of the browser process, which has a budget ([ADR 0017](0017-performance-budgets-in-ci.md)). A schema of its own for each policy that first checks Chrome's format, then converts the value and then checks the result with the schema of the setting added about 0.8 KB to that path; the checks of the format alone, with their patterns and messages, were about 0.3 KB, more than the whole allowance of the change. The checks of the format are also redundant in the browser: once the value is converted, the schema of the setting refuses everything that they refuse.

## Decision

- The schemas of the settings convert Chrome's formats themselves, so their policies need no schema of their own: the search address turns `{searchTerms}` into `%s`, and a web address without a scheme gets `https://`, as the settings page already does for what people type; a scheme other than http and https stays and is refused. The settings take these formats from every source, also from an import.
- The download folder keeps Chrome's variables that every system knows, `${user_name}` and `${machine_name}`, and its schema refuses any other. The browser replaces them where it uses the folder, in code that loads with the first web page or the settings page (`app/src/main/download-folder.ts`): when it saves a download, opens the folder, proposes the folder for a saved page, and shows the folder on the settings page.
- `app/src/main/policy-inputs.ts` describes, as Valibot schemas, the values that these policies take. Only the tools and the tests import it, so the bundle of the browser does not hold it. `tools/policies/reference.ts` describes a policy by its input schema where there is one, and by the policy's schema up to its first transformation otherwise. A unit test gives the input schemas and the schemas of the browser the same values, valid and not, and requires the same answer.

## Consequences

Positive:

- A policy file of Chrome with these formats works as it is, and the reference and its JSON Schema accept exactly what the browser accepts.
- The conversions add about 0.15 KB to the start path, instead of about 0.8 KB.

Negative:

- The format of these policies is written twice, once as the conversion and once for the reference; the test keeps both in step.
- The download folder is stored with its variables, so every place that uses it must replace them; a new place that forgets it would make a folder with the name of the variable.

## Alternatives considered

- **A schema of its own for each policy, with the check of the format, the conversion and the schema of the setting:** one place for each format, but 0.8 KB on the start path.
- **Replacing the variables of the download folder in its schema:** the stored value is the folder that applies, but the code of the variables and the name of the computer would be on the start path.
- **Converting the formats where the values are used, such as the search address when the address bar searches:** nothing on the start path, but every user of a value would need the conversion, in the browser process and in the shell.
