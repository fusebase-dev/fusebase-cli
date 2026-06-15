# App API Consumer Contracts (PoC)

This document describes the **consumer contract** PoC for cross-app API calls.
Contracts are **authored locally** in each consumer app repo and **verified
centrally** (through `public-api` → Gate) against the published contract set.
The CLI no longer runs verification locally; it authors, validates, publishes,
and triggers the central verifier.

PoC scope is intentionally narrow:

- contract identity is `providerAppId + operationId`
- consumer call source is resolved `AppApisApi.callAppApi(...)` callsites in the consumer app
- consumer dependency metadata in `apps[].fusebaseAppApiDependenciesMeta` remains useful for sync/reporting, but scaffold input comes from source analysis
- consumer expectation contracts are local files inside the consumer app repo
- runtime verification runs centrally and executes real provider calls through Gate
- Pact is **not** the primary contract model for this PoC

## Why this format

The real business contract in this architecture is not the raw Gate HTTP call. It is the provider app operation identified by:

- `providerAppId`
- `operationId`

The consumer contract file therefore describes expected behavior for one provider operation, not the Gate transport envelope.

## File discovery convention

Contract files live inside each consumer app path under:

```text
<app-path>/contracts/app-apis/
```

The CLI scaffolder writes files as:

```text
<app-path>/contracts/app-apis/<providerAppId>/<operationId>.contract.json
```

Only `*.contract.json` files under that tree are discovered.

## Contract format

```json
{
  "kind": "app-api-consumer-contract",
  "schemaVersion": "2026-06-03",
  "providerAppId": "tasks-manager-app-id",
  "operationId": "listTasks",
  "cases": [
    {
      "name": "listTasks-contract-draft",
      "input": {
        "query": {
          "status": { "$matcher": "string" }
        }
      },
      "expect": {
        "status": 200
      }
    }
  ]
}
```

Top-level required fields:

- `kind`
- `schemaVersion`
- `providerAppId`
- `operationId`
- `cases`

Case fields:

- `name` must be non-empty and unique within the file
- `input` is optional
- `expect.status` is required
- `expect.body` and `expect.error` are optional

## Supported matcher set in this PoC

Supported matcher objects:

- `{ "$matcher": "string" }`
- `{ "$matcher": "number" }`
- `{ "$matcher": "boolean" }`
- `{ "$matcher": "enum", "$value": ["open", "closed"] }`

Optional matcher values use:

- `{ "$matcher": "string", "$optional": true }` — field may be **absent**

Nullable matcher values use:

- `{ "$matcher": "string", "$nullable": true }` — field may be **present and `null`**

`$optional` and `$nullable` are independent and combinable: `$optional`
tolerates a missing key, `$nullable` tolerates an explicit `null` value. Use both
for a field that may be absent or null. On the request side (`input`) `$nullable`
has no effect — synthesis always emits a concrete sample value (see "Matcher
synthesis").

Structural expectations are expressed with normal JSON structure:

- plain objects for partial object expectations
- arrays for array shape expectations
- plain JSON literals for exact values

> **Footgun — array matchers apply to every element.** A length-1 array
> expectation `[X]` matches `X` against **every** element of the actual array
> (see "Supported matcher set" / unsupported tuple matching). So if a list field
> is `string | null`, one `null` row fails the whole assertion unless the element
> matcher is nullable: `[{ "$matcher": "string", "$nullable": true }]`.

## Unsupported patterns (PoC)

The PoC matcher engine is intentionally narrow. The following are **not** supported and must not be used in contract files:

- regex / pattern matchers
- numeric range / length constraints (`minimum`, `maxLength`, etc.)
- `oneOf` / `anyOf` / `allOf` style alternative matchers inside contracts
- custom or named matcher types beyond `string`, `number`, `boolean`, `enum`
- date/time or format-specific matchers (`format: date-time`, uuid, email, ...)
- tuple matching with per-index types (an array expectation of length 1 matches every element; an array of length N expects exact length N with positional matching)
- cross-field or conditional expectations

Provider OpenAPI schemas may legitimately use the keywords above. When the central verifier meets them while validating a response against the provider schema, it **ignores** them and emits a grouped `WARN` (for example `ignored schema keyword "format" at ...`). Warnings never fail a run; only structural type mismatches and explicit contract mismatches do.

Current validation rules:

- matcher objects may only use `$matcher`, `$optional`, `$nullable`, `$value`
- only `enum` matcher may use `$value`
- duplicate `providerAppId + operationId` contracts inside one consumer app are invalid
- every contract must match an entry in `apps[].fusebaseAppApiDependenciesMeta.dependencies`
- the central verifier synthesizes executable sample values from matcher placeholders inside `input`

## Hidden commands

All `fusebase app-api-contracts` subcommands require the
`cross-app-api-calls-analysis` flag (same gate as `fusebase analyze app-apis`).
Enable it with `fusebase config set-flag cross-app-api-calls-analysis`; without
it the command exits with a disabled message.

Validate local contracts:

```bash
fusebase app-api-contracts validate --app <consumerAppId>
```

Validate all configured consumer apps with paths:

```bash
fusebase app-api-contracts validate
```

Author draft contracts from resolved consumer callsites:

```bash
fusebase app-api-contracts unresolved --app <consumerAppId>
fusebase app-api-contracts add-manual-dependency --app <consumerAppId> --provider <providerAppId> --operation <operationId>
fusebase app-api-contracts scaffold --app <consumerAppId>
fusebase app-api-contracts scaffold --app <consumerAppId> --provider <providerAppId>
fusebase app-api-contracts scaffold --app <consumerAppId> --provider <providerAppId> --operation <operationId>
fusebase app-api-contracts scaffold --app <consumerAppId> --force
```

Publish validated contracts to central storage (via the public API):

```bash
fusebase app-api-contracts publish --app <consumerAppId>
```

Verify the **centrally stored** (published) contract set through the public API:

```bash
fusebase app-api-contracts verify-consumer --app <consumerAppId>
fusebase app-api-contracts verify-consumer --app <consumerAppId> --provider <providerAppId>
fusebase app-api-contracts verify-consumer --app <consumerAppId> --provider <providerAppId> --operation <operationId>
fusebase app-api-contracts verify-provider --app <providerAppId>
```

`validate`, `verify-consumer`, and `verify-provider` accept `--json` for
machine-readable output (see below).

## Current command flow

Resolved dependency flow:

```bash
fusebase analyze app-apis --feature <consumerAppId>
fusebase app-api-contracts scaffold --app <consumerAppId>
fusebase app-api-contracts validate --app <consumerAppId>
fusebase app-api-contracts publish --app <consumerAppId>
fusebase app-api-contracts verify-consumer --app <consumerAppId>
```

Unresolved dynamic dependency flow:

```bash
fusebase analyze app-apis --feature <consumerAppId>
fusebase app-api-contracts unresolved --app <consumerAppId>
fusebase app-api-contracts add-manual-dependency --app <consumerAppId> --provider <providerAppId> --operation <operationId>
fusebase app-api-contracts scaffold --app <consumerAppId> --provider <providerAppId> --operation <operationId> --force
fusebase app-api-contracts validate --app <consumerAppId>
```

Meaning of each step:

- `analyze app-apis` refreshes `fusebaseAppApiDependenciesMeta` in `fusebase.json`
- `unresolved` prints dynamic calls that static analysis could not safely resolve
- `add-manual-dependency` records an explicit `source: "manual"` dependency entry
- `scaffold` creates or refreshes draft local consumer contracts
- `validate` checks both contract structure and dependency linkage (offline; no provider call)
- `publish` re-validates the consumer's contracts and, only when they are valid, uploads the full set to central storage
- `verify-consumer` verifies the consumer's **published remote** contract set (no local files are read) by calling the public API, which runs the verification engine centrally through Gate
- `verify-provider` verifies the **org-wide centrally stored inbound** contracts targeting a provider app through the public API

## Authoring locally, verifying centrally

There is no local runtime verification command. The loop is:

1. author and validate contracts locally (`scaffold` + `validate` — offline,
   structure + dependency linkage only);
2. `publish` them to central storage;
3. run `verify-consumer` / `verify-provider`, which execute the published
   contracts centrally through `public-api` → Gate and return a report.

Because verification reads the **published** set, the contracts you verify are
the ones most recently published — re-run `publish` after editing local
contracts, or the central run uses the stale published set. `validate` is the
fast offline gate to run before `publish`; it does not call the provider.

## Publish behavior

`publish --app <consumerAppId>` uploads the consumer app's local contract set to
central storage through the public API
(`PUT /v1/orgs/{orgId}/products/{productId}/apps/{appId}/app-api-consumer-contracts`):

- requires a configured API key (`fusebase auth`) and `orgId`/`productId` in `fusebase.json`
- re-runs the same structural + dependency-linkage checks as `validate`; if any
  issue is found, nothing is uploaded and the command exits non-zero
- sends every valid `*.contract.json` verbatim (the contract document is the wire
  format — `kind`, `schemaVersion`, `providerAppId`, `operationId`, `cases`)
- the server replaces the consumer app's stored contract set with the posted set
  (full replacement), so re-publishing is idempotent
- prints the number of stored contracts on success

## Scaffold behavior

The scaffolder:

- runs static analysis over consumer `AppApisApi.callAppApi(...)` usages
- groups resolved calls by `providerAppId + operationId`
- generates draft `input` from the consumer-side `body` payload passed to `callAppApi(...)`
- uses exact literals where statically known and matcher placeholders for dynamic primitive leaves when possible
- generates a minimal `expect` block with `status: 200`
- scaffolds manual dependency entries that do not have resolved consumer callsites yet
- creates files only when they do not already exist, unless `--force` is used
- reports unresolved calls but does not guess contracts for them

Important constraints:

- scaffolded files are **drafts**, not final business assertions
- unresolved `callAppApi(...)` usages remain manual-only in this PoC phase

## Central verification behavior

Both `verify-consumer` and `verify-provider` call the public API, which forwards
to Gate. Gate runs the verification engine per case:

- synthesize sample values from matcher placeholders in `case.input` (an omitted
  `input` runs the operation with an empty Gate request envelope `{}`)
- validate the synthesized request against the provider manifest request schema when available
- call the real provider operation through Gate and compare `status`,
  `expect.body`, and `expect.error`
- validate the response against the provider manifest response schema when available

Defaults:

- provider manifest problems are warnings, not blockers
- invalid synthesized input, runtime transport errors, expectation mismatches, and provider response schema mismatches fail the run
- `expect.error` matches `result.data.error` for non-2xx responses

Matcher synthesis:

- `string` -> `"contract-draft"`
- `number` -> `1`
- `boolean` -> `true`
- `enum` -> first `$value`
- array matcher shapes -> single synthesized item
- `$optional: true` fields are omitted from synthesized input

### Consumer vs provider modes

Both reuse the same central engine (request synthesis, schema validation, Gate
execution, response matching). They differ only in which published contracts are
selected:

- **Consumer mode** (`verify-consumer --app <consumerAppId>`): selects this
  consumer's own published contracts, optionally filtered by
  `--provider`/`--operation`. Answers "do the providers I depend on still behave
  the way I expect?". Used by a consumer team before relying on, or after
  upgrading, a provider.
- **Provider mode** (`verify-provider --app <providerAppId>`): selects every
  published consumer contract org-wide that targets this provider. Answers "does
  the currently deployed provider runtime in this environment break any consumer
  in the org?". Used by a provider team against the target deployed environment
  after deploying the version they want to validate. Human output is grouped by
  `consumerAppId`.

Provider mode is **org-wide**: it sees every published consumer that targets the
provider, not just the consumers present in the local `fusebase.json`.

## Machine-readable output (`--json`)

`validate`, `verify-consumer`, and `verify-provider` accept `--json`. In JSON mode all human/colored output is suppressed and a single JSON document is printed to stdout; errors still go to stderr and the process still exits non-zero on failure. This is intended for CI experiments. (`publish` performs an action rather than a check, so it has no `--json` report — branch on its exit code.)

`validate --json`:

```json
{
  "command": "validate",
  "ok": false,
  "apps": [
    {
      "appId": "consumer-app-id",
      "path": "apps/consumer",
      "contractsDir": "apps/consumer/contracts/app-apis",
      "contractCount": 2,
      "status": "invalid",
      "issues": [
        { "file": "apps/consumer/contracts/app-apis/p/op.contract.json", "path": "$.cases[0].expect.status", "message": "..." }
      ]
    }
  ]
}
```

`verify-consumer --json` and `verify-provider --json` forward the central report
verbatim (the `cases` come straight from the public API). There is no
`validationIssues` field because no local validation runs:

```json
{
  "command": "verify-consumer",
  "consumerAppId": "consumer-app-id",
  "ok": true,
  "summary": { "contractCount": 1, "caseCount": 2, "passCount": 2, "failCount": 0, "warnCount": 1 },
  "cases": [
    {
      "providerAppId": "provider-app-id",
      "operationId": "listTasks",
      "caseName": "returns open tasks",
      "status": "PASS",
      "warnings": [],
      "request": { "url": "https://.../call", "envelope": { "query": { "status": "open" } } },
      "response": { "status": 200, "body": {} }
    }
  ]
}
```

```json
{
  "command": "verify-provider",
  "providerAppId": "provider-app-id",
  "ok": true,
  "summary": { "contractCount": 1, "caseCount": 2, "passCount": 2, "failCount": 0, "warnCount": 0 },
  "cases": [
    { "consumerAppId": "consumer-app-id", "providerAppId": "provider-app-id", "operationId": "listTasks", "caseName": "returns open tasks", "status": "PASS", "warnings": [] }
  ]
}
```

Notes:

- `ok` is the single field a CI step should branch on; it mirrors the process exit code.
- `verify-consumer` / `verify-provider` perform no local validation, so they have no `validationIssues`; `verify-provider` cases additionally carry `consumerAppId` because central provider verification is org-wide.
- the human summary reports `Total / Passed / Failed / Warnings`, where `Passed + Failed = Total` and `Warnings` is the count of passing cases that carried warnings.

## Unresolved manual workflow

When static analysis cannot resolve `providerAppId` or `operationId`, keep the unresolved diagnostic honest and convert the intent manually:

```bash
fusebase analyze app-apis --feature <consumerAppId>
fusebase app-api-contracts unresolved --app <consumerAppId>
fusebase app-api-contracts add-manual-dependency --app <consumerAppId> --provider <providerAppId> --operation <operationId>
fusebase app-api-contracts scaffold --app <consumerAppId> --provider <providerAppId> --operation <operationId> --force
```

Notes:

- `add-manual-dependency` writes `source: "manual"` into `apps[].fusebaseAppApiDependenciesMeta.dependencies`
- `--org <targetOrgId>` is optional and defaults to `fusebase.json` `orgId`
- manual dependency scaffolds have no consumer-derived `input` yet, so the draft starts with `expect.status: 200`

## CLI PoC status and known gaps

The CLI covers authoring (`scaffold`), structure/dependency validation
(`validate`), publishing (`publish`), and triggering central verification
(`verify-consumer`, `verify-provider`), all with `--json` for CI. The following
gaps are intentional and real, not speculative:

1. **No provider-state control.** Verification runs against whatever data the provider runtime currently holds. Cases that depend on specific records are brittle; the PoC is reliable mainly for shape/status/validation-error contracts.
2. **Shared mutable environments.** Central verification calls the real provider. Concurrent runs or environment drift can produce noisy failures; there is no isolated fixture environment.
3. **Narrow matcher model.** See "Unsupported patterns". Provider schema keywords outside the supported set are surfaced as warnings, not enforced.
4. **No real consumer-code verification.** Contracts assert the provider's behavior, not that the consumer app actually uses it correctly. Critical app pairs may still need consumer-side integration tests.
5. **Manual unresolved-call workflow.** Truly dynamic `callAppApi(...)` targets must be declared by hand via `add-manual-dependency`; there is no auto-resolution.
6. **No durable results.** Output is per-run (text or `--json`); there is no history, trend, or stored case-level diagnostics beyond what a CI job captures itself.
7. **Publish-before-verify.** There is no local runtime verification; contracts must be published before they can be runtime-verified, so a draft is verified only against the published set.

## Validating the UX on a real product

Central verification performs real network calls (public API → Gate → provider) and is not exercised by the default `bun test` run. To validate the UX end to end on a real multi-app product:

```bash
# from a project whose fusebase.json has at least one consumer app and one provider app
fusebase analyze app-apis --feature <consumerAppId>
fusebase app-api-contracts scaffold --app <consumerAppId>
# edit the generated drafts into real expectations
fusebase app-api-contracts validate --app <consumerAppId>
fusebase app-api-contracts publish --app <consumerAppId>
fusebase app-api-contracts verify-consumer --app <consumerAppId>
fusebase app-api-contracts verify-consumer --app <consumerAppId> --json
fusebase app-api-contracts verify-provider --app <providerAppId>
```

This requires a configured API key (`fusebase auth`), deployed provider apps with published manifests, and resolved consumer dependencies in `fusebaseAppApiDependenciesMeta`.
