# Cross-App Contract Testing — apps-cli guide

A getting-started guide for the `fusebase app-api-contracts` flow. For the full
reference (format, matcher rules, JSON shapes, known gaps) see
[`APP_API_CONTRACTS.md`](./APP_API_CONTRACTS.md).

## What it is

When one app calls another via `AppApisApi.callAppApi(...)`, the **consumer**
depends on the **provider** operation behaving a certain way. A *contract*
captures that expectation (e.g. "`listTasks` returns `200` with a `tasks`
array"). You author contracts in the consumer repo, publish them centrally, and
verify them by running the real provider call through Gate.

A contract is identified by **`providerAppId + operationId`** — the business
contract is the provider *operation*, not the HTTP transport.

**Author & validate locally → publish → verify centrally.** There is no local
runtime verification; verification always runs server-side (`public-api → Gate`)
against the published set.

## Prerequisites

```bash
fusebase auth --api-key=<key>                              # API key
fusebase config set-flag cross-app-api-calls-analysis      # unlocks the hidden command
```

All commands below are `fusebase app-api-contracts <sub>` and require
`orgId`/`productId` in `fusebase.json`.

## The flow

**1. Analyze — discover dependencies**

```bash
fusebase analyze app-apis --feature <consumerAppId>
```

Statically scans the consumer's runtime TS for `callAppApi(...)` calls and writes
`fusebaseAppApiDependenciesMeta` (which provider+operation it depends on) into
`fusebase.json`. Dynamic calls it can't resolve are listed as *unresolved*.

**2. Scaffold — generate draft contracts**

```bash
fusebase app-api-contracts scaffold --app <consumerAppId>
```

Reads the resolved callsites and writes one draft per operation to
`<app-path>/contracts/app-apis/<providerAppId>/<operationId>.contract.json`,
inferring `input` from the call's payload (literals where known, matcher
placeholders otherwise) and a default `expect: { status: 200 }`. **Drafts are
starting points — edit them into real expectations.** `--force` overwrites
existing files.

*Dynamic call? Declare it manually, then scaffold that one:*

```bash
fusebase app-api-contracts unresolved --app <consumerAppId>          # see what's unresolved
fusebase app-api-contracts add-manual-dependency --app <consumerAppId> --provider <p> --operation <op>
fusebase app-api-contracts scaffold --app <consumerAppId> --provider <p> --operation <op> --force
```

**3. Validate — offline check**

```bash
fusebase app-api-contracts validate --app <consumerAppId>   # --json for CI
```

Checks contract **structure** and that each contract maps to a known dependency.
No network, no provider call. Run it before publishing.

**4. Publish — upload to central storage**

```bash
fusebase app-api-contracts publish --app <consumerAppId>
```

Re-validates, then uploads the full contract set to central storage (full
replacement, idempotent). Aborts and uploads nothing if any contract is invalid.

**5. Verify — run the contracts centrally**

```bash
# consumer side: do the providers I depend on still behave as expected?
fusebase app-api-contracts verify-consumer --app <consumerAppId> [--provider <p>] [--operation <op>]

# provider side (org-wide): would my provider change break any published consumer?
fusebase app-api-contracts verify-provider --app <providerAppId>
```

Both call the public API → Gate, which synthesizes inputs from the matchers,
calls the **real** provider operation, and matches `status`/`body`/`error`
against each contract (plus the provider's OpenAPI schema when available).
Reports per-case `PASS`/`FAIL` (+ `WARN`), a `Total/Passed/Failed/Warnings`
summary, and exit `1` on any failure. `--json` for CI. `verify-provider` is
org-wide and groups results by consumer.

> **Key rule:** verification reads the **published** set. After editing
> contracts, re-run `publish` before verifying — otherwise you're testing the
> old published version.

## Contract file (what you edit in step 2)

```json
{
  "kind": "app-api-consumer-contract",
  "schemaVersion": "2026-06-03",
  "providerAppId": "tasks-manager-id",
  "operationId": "listTasks",
  "cases": [
    {
      "name": "lists open tasks",
      "input":  { "query": { "status": "open" } },
      "expect": { "status": 200, "body": { "tasks": [ { "id": { "$matcher": "string" } } ] } }
    }
  ]
}
```

- `input` → the Gate request (`path`/`query`/`body`); omit to send `{}`.
- `expect.status` required; `expect.body`/`expect.error` optional.
- **Matchers** (type-only): `{"$matcher":"string"|"number"|"boolean"}`,
  `{"$matcher":"enum","$value":[...]}`. Add `"$optional":true` to tolerate an
  absent key, `"$nullable":true` to tolerate an explicit `null` (combinable).
  Plain JSON = exact match; arrays match by shape (length-1 array matches every
  element — so a nullable element in a list needs
  `[{"$matcher":"string","$nullable":true}]`). Regex/ranges/`oneOf`/formats are
  **not** supported and are ignored-with-warning if seen in the provider schema.

## TL;DR

```
analyze → scaffold → (edit drafts) → validate → publish → verify-consumer / verify-provider
```

Consumer team runs `verify-consumer` before trusting a provider; provider team
runs `verify-provider` against the target deployed environment after deploying
the provider version they want to validate.
