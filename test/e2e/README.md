# Fusebase CLI e2e tests

End-to-end tests that exercise the `fusebase` CLI against a real Fusebase
environment (dev or prod). They are gated by env vars and excluded from the
default `bun test` run so contributors do not need credentials to work on the
repo.

## Layout

```
test/e2e/
  helpers/         # Reusable building blocks (env, CLI runner, api, dashboard).
  *.e2e.ts         # Test files (do NOT match the default *.test.ts pattern,
                   #  so plain `bun test` skips them).
```

## Running

```bash
# 1. Set the env vars (see "Required env vars" below).
export FUSEBASE_API_KEY=...
export FUSEBASE_ENV=dev          # or "prod"
export FUSEBASE_TEST_ORG_ID=...
export FUSEBASE_TEST_DASHBOARD_ID=...

# 2. Run the e2e suite.
bun run test:e2e
```

If any env var is missing, the suite logs the missing names and SKIPs cleanly
(non-zero exit only on real failures).

## Required env vars

| Var                          | Required | Purpose                                             |
| ---------------------------- | -------- | --------------------------------------------------- |
| `FUSEBASE_API_KEY`           | Yes      | Bearer key for the public Fusebase API.             |
| `FUSEBASE_ENV`               | Yes      | `dev` or `prod`. Resolves the public-api base URL.  |
| `FUSEBASE_TEST_ORG_ID`       | Yes      | Org under which test apps are created/deleted.      |
| `FUSEBASE_TEST_DASHBOARD_ID` | Yes      | Pre-provisioned test dashboard (one per env).       |

## Helpers

- `helpers/env.ts` — loads the env vars above; exposes `e2eEnvAvailable`,
  `e2eEnvMissing`, and `getE2eEnv()`. Tests gate themselves with
  `describe.skipIf(!e2eEnvAvailable)` so missing creds produce a SKIP.
- `helpers/cli.ts` — `createCliWorkspace` (isolated `HOME` + `cwd` with a
  seeded `~/.fusebase/config.json`), `runCli` (one-shot exec) and
  `runCliStreaming` (long-running, with `waitForReady`/`kill`) used by the
  `dev start` test.
- `helpers/api.ts` — fetch wrapper around the public Fusebase API (`listApps`,
  `getApp`, `deleteApp`, plus a generic `request<T>()` escape hatch). The
  `deleteApp` call hits `DELETE /v1/orgs/{orgId}/apps/{appId}` (added under
  NIM-40899) and treats 404 as success so it can be used idempotently in
  teardown.
- `helpers/dashboard.ts` — read helpers for the pre-provisioned test
  dashboard (`getInfo`, `listRows`, `findRowsByField`). Used by the smoke
  test to verify backend + cron writes.

## Conventions

- E2E test filenames end in `.e2e.ts` (NOT `.test.ts`). This keeps them out
  of the default `bun test` pattern; the dedicated `test:e2e` script picks
  them up explicitly.
- Each test creates a uniquely-named app (`e2e-cli-${CI_PIPELINE_ID:-local}-${randomSuffix}`)
  and deletes it in `afterAll` so concurrent CI runs do not collide.
- Long-running CLI processes (`dev start`) must be terminated in a teardown
  hook — the streaming runner sends `SIGTERM` then `SIGKILL` after 5s.

## CI

Pipeline jobs that run this suite (configured under NIM-40903):

- `e2e:dev` — runs on MR (non-draft) and `master` against the dev environment.
- `e2e:prod` — runs on tag pipelines against prod, before `upload:prod`.

Both jobs read the env vars above from masked GitLab CI variables.

## Related JIRA tickets

- NIM-40894 — parent story (e2e tests for CLI).
- NIM-40898 — nimbus-ai cascade Azure cleanup in `deleteApp`.
- NIM-40899 — public-api `DELETE /v1/orgs/{orgId}/apps/{appId}` endpoint.
- NIM-40900 — this harness (helpers + scripts + skip behaviour).
- NIM-40901 — smoke deploy test (single feature: backend + sidecar + cron).
- NIM-40902 — `fusebase dev start` parallel features test.
- NIM-40903 — CI integration.
- NIM-40904 — documentation + CI vars.
