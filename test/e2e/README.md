# Fusebase CLI e2e tests

End-to-end tests that exercise the `fusebase` CLI against a real Fusebase
environment (dev or prod). They are gated by env vars and excluded from the
default `bun test` run so contributors do not need credentials to work on the
repo.

## What the e2e tests cover

- **Smoke deploy** (`smoke-deploy.e2e.ts`) — `init` → scaffold → `deploy` of a
  single feature that combines a backend, a sidecar container, and a cron job;
  asserts the backend serves `/api/healthz`, that backend HTTP writes hit the
  test dashboard, and that the cron job writes hit the same dashboard. Calls
  `DELETE /v1/orgs/{orgId}/apps/{appId}` in teardown so the cascade in
  `nimbus-ai` removes the Container App + Container Apps Job.
- **Dev start parallel** (`dev-start-parallel.e2e.ts`) — spawns
  `fusebase dev start` for two features in parallel, polls each feature port,
  then terminates both processes (no leaked children).
- **Harness placeholder** (`harness.e2e.ts`) — fast sanity check that the
  configured env vars resolve and the public-api is reachable. Catches
  CI-variable typos before the heavy smoke run.

## Expected wall-clock

| Test                     | Typical duration        |
| ------------------------ | ----------------------- |
| Harness placeholder      | < 5s                    |
| Smoke deploy             | 10–20 min (CI cap 30m)  |
| Dev start parallel       | < 2 min                 |

The full `bun run test:e2e` run is dominated by the smoke deploy.

## Prerequisites

- An existing Fusebase **test org** on the target environment (one for `dev`,
  one for `prod`). The org is referenced by `FUSEBASE_TEST_ORG_ID`.
- A pre-provisioned **test dashboard** in that org with at least one writable
  table. The smoke test reads/writes rows but does **not** create or delete
  the dashboard. The dashboard is referenced by `FUSEBASE_TEST_DASHBOARD_ID`.
- An API key for an account that owns those resources. The dev runner uses
  `awcalibr@gmail.com`; prod uses `cli-smoke-test-nimbustest@nimbustest.com`.

## Layout

```
test/e2e/
  helpers/             # Reusable building blocks (env, CLI runner, api, dashboard).
  harness.e2e.ts       # Smoke check — auths, lists apps, reads test dashboard.
  smoke-deploy.e2e.ts  # Full CLI lifecycle smoke test (NIM-40901).
  dev-start.e2e.ts     # `fusebase dev start` two features in parallel (local).
  *.e2e.ts             # Other test files (do NOT match the default *.test.ts
                       #  pattern, so plain `bun test` skips them).
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

Pipeline jobs that run this suite (defined in `.gitlab-ci.yml`):

- `e2e:dev` — runs on non-draft MR pipelines and on the default branch
  (`main`). Gates `upload:dev` via `needs`, so a failing smoke blocks the
  dev artifact upload.
- `e2e:prod` — runs on tag pipelines. Gates `upload:prod` via `needs`, so
  a failing smoke blocks the release upload.

Each job sets the test env vars (`FUSEBASE_API_KEY`, `FUSEBASE_ENV`,
`FUSEBASE_TEST_ORG_ID`, `FUSEBASE_TEST_DASHBOARD_ID`) from per-environment
masked + protected GitLab CI variables. Configure these once in the apps-cli
project's CI/CD settings (Settings → CI/CD → Variables); the implementer
does **not** commit secret values:

| GitLab CI variable                | Used by    | Source                                                 |
| --------------------------------- | ---------- | ------------------------------------------------------ |
| `FUSEBASE_DEV_API_KEY`            | `e2e:dev`  | API key for the dev test account (`awcalibr@gmail.com`). |
| `FUSEBASE_TEST_ORG_ID_DEV`        | `e2e:dev`  | Org ID of the dev test workspace.                      |
| `FUSEBASE_TEST_DASHBOARD_ID_DEV`  | `e2e:dev`  | Pre-provisioned test dashboard in the dev org.         |
| `FUSEBASE_PROD_API_KEY`           | `e2e:prod` | API key for the prod test account (`cli-smoke-test-nimbustest@nimbustest.com`). |
| `FUSEBASE_TEST_ORG_ID_PROD`       | `e2e:prod` | Org ID of the prod test workspace.                     |
| `FUSEBASE_TEST_DASHBOARD_ID_PROD` | `e2e:prod` | Pre-provisioned test dashboard in the prod org.        |

All six should be **Masked** and **Protected** so they only resolve on
protected branches/tags and are scrubbed from logs.

If any required variable is missing on a runner, the suite logs the missing
names and SKIPs cleanly — the job exits 0 rather than failing the pipeline.

## Orphan resource cleanup

The cascade in `nimbus-ai` (NIM-40898) deletes the Azure Container App and
Container Apps Jobs whenever the public-api `DELETE /v1/orgs/{orgId}/apps/{appId}`
endpoint is called. The smoke test calls that endpoint in `afterAll` regardless
of test outcome, so the happy path leaves no orphans.

There is **no nightly orphan-cleanup job**. If a CI runner crashes between
"app created" and "app deleted" — for example, a SIGKILL from the runner host
or a network partition that prevents the teardown call — the Azure resources
will leak. This is an accepted risk per the parent-story decision: the smoke
runs ~per pipeline, the blast radius is one Container App + jobs, and the
cost of a sweeper job is not warranted at this volume.

If you suspect leaks, list test apps in the test org via the public-api and
delete the stale ones manually:

```bash
curl -H "Authorization: Bearer $FUSEBASE_API_KEY" \
  "https://public-api.dev-thefusebase.com/v1/orgs/$FUSEBASE_TEST_ORG_ID/apps" \
  | jq '.[] | select(.subdomain | startswith("e2e-cli-")) | {id, subdomain}'

curl -X DELETE -H "Authorization: Bearer $FUSEBASE_API_KEY" \
  "https://public-api.dev-thefusebase.com/v1/orgs/$FUSEBASE_TEST_ORG_ID/apps/$APP_ID"
```

## Related JIRA tickets

- NIM-40894 — parent story (e2e tests for CLI).
- NIM-40898 — nimbus-ai cascade Azure cleanup in `deleteApp`.
- NIM-40899 — public-api `DELETE /v1/orgs/{orgId}/apps/{appId}` endpoint.
- NIM-40900 — this harness (helpers + scripts + skip behaviour).
- NIM-40901 — smoke deploy test (single feature: backend + sidecar + cron).
- NIM-40902 — `fusebase dev start` parallel features test.
- NIM-40903 — CI integration.
- NIM-40904 — documentation + CI vars.
