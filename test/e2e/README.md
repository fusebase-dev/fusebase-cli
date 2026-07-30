# Fusebase CLI e2e tests

End-to-end tests that exercise the `fusebase` CLI against a real Fusebase
environment (dev or prod). They are gated by env vars and excluded from the
default `bun test` run so contributors do not need credentials to work on the
repo.

## What the e2e tests cover

- **Smoke deploy** (`smoke-deploy.e2e.ts`) — `init` → scaffold → `deploy` of a
  single app that combines a backend, a sidecar container, and a cron job.
  Verifies the deployed backend `/api/healthz` responds, and that both backend
  HTTP writes and the cron job hit the backend's in-memory marker store keyed
  by a per-run `runId`. Calls `DELETE /v1/orgs/{orgId}/products/{productId}` in
  teardown so the cascade in `nimbus-ai` removes the Container App + Container
  Apps Job.
- **Reconcile deploy** (`reconcile-deploy.e2e.ts`) — declarative
  `fusebase.json` (NIM-41746): one product, an SPA feature, three sequential
  deploys proving reconcile **creates** a missing app (no id, new subdomain),
  **binds** the same id-less entry on re-deploy (no duplicate feature), and
  trusts a **legacy** entry that carries the real id. Asserts `fusebase.json`
  is never mutated with the resolved id. Frontend-only, so it skips container
  provisioning and runs much faster than the smoke deploy. Teardown deletes the
  product (cascade removes the features).
- **Dev start parallel** (`dev-start-parallel.e2e.ts`) — spawns
  `fusebase dev start` for two apps in parallel, polls each app port,
  then terminates both processes (no leaked children).
- **Harness placeholder** (`harness.e2e.ts`) — fast sanity check that the
  configured env vars resolve and the public-api is reachable. Catches
  CI-variable typos before the heavy smoke run.

## Expected wall-clock

| Test                     | Typical duration        |
| ------------------------ | ----------------------- |
| Harness placeholder      | < 5s                    |
| Smoke deploy             | 10–20 min (CI cap 30m)  |
| Reconcile deploy         | 3–8 min (3 SPA deploys) |
| Dev start parallel       | < 2 min                 |

The full `bun run test:e2e` run is dominated by the smoke deploy.

## Prerequisites

- An existing Fusebase **test org** on the target environment (one for `dev`,
  one for `prod`). The org is referenced by `FUSEBASE_TEST_ORG_ID`.
- An API key for an account that owns those resources. The dev runner uses
  `awcalibr@gmail.com`; prod uses `cli-smoke-test-nimbustest@nimbustest.com`.

## Layout

```
test/e2e/
  helpers/             # Reusable building blocks (env, CLI runner, api).
  harness.e2e.ts       # Smoke check — auths and lists apps via public-api.
  smoke-deploy.e2e.ts  # Full CLI lifecycle smoke test (NIM-40901).
  reconcile-deploy.e2e.ts  # Declarative deploy reconcile (NIM-41746).
  dev-start.e2e.ts     # `fusebase dev start` two apps in parallel (local).
  *.e2e.ts             # Other test files (do NOT match the default *.test.ts
                       #  pattern, so plain `bun test` skips them).
```

## Running

```bash
# 1. Set the env vars (see "Required env vars" below).
export FUSEBASE_API_KEY=...
export FUSEBASE_ENV=dev          # or "prod"
export FUSEBASE_TEST_ORG_ID=...

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
  `deleteApp` call hits `DELETE /v1/orgs/{orgId}/products/{productId}` (added under
  NIM-40899) and treats 404 as success so it can be used idempotently in
  teardown.

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
  a failing smoke blocks the release upload. Also runs on **scheduled**
  pipelines as the prod synthetic monitor — see below.

Scheduled pipelines run `e2e:prod` and nothing else: `validate-skills`,
`build`, `e2e:dev` and `upload:dev` all carry the `.not-on-schedule` guard, and
`e2e:prod`'s `needs: build` is `optional: true` so the pipeline stays valid
without it.

Each job sets the test env vars (`FUSEBASE_API_KEY`, `FUSEBASE_ENV`,
`FUSEBASE_TEST_ORG_ID`) from per-environment masked + protected GitLab CI
variables. Configure these once in the apps-cli project's CI/CD settings
(Settings → CI/CD → Variables); the implementer does **not** commit secret
values:

| GitLab CI variable                | Used by    | Source                                                 |
| --------------------------------- | ---------- | ------------------------------------------------------ |
| `FUSEBASE_DEV_API_KEY`            | `e2e:dev`  | API key for the dev test account (`awcalibr@gmail.com`). |
| `FUSEBASE_TEST_ORG_ID_DEV`        | `e2e:dev`  | Org ID of the dev test workspace.                      |
| `FUSEBASE_PROD_API_KEY`           | `e2e:prod` | API key for the prod test account (`cli-smoke-test-nimbustest@nimbustest.com`). |
| `FUSEBASE_TEST_ORG_ID_PROD`       | `e2e:prod` | Org ID of the prod test workspace.                     |

All four should be **Masked** and **Protected** so they only resolve on
protected branches/tags and are scrubbed from logs.

If any required variable is missing on a runner, the suite logs the missing
names and SKIPs cleanly — the job exits 0 rather than failing the pipeline.

## Prod synthetic monitor (every 3 hours)

`e2e:prod` doubles as a **synthetic monitor of production app deploys**. A
GitLab *pipeline schedule* re-runs the same suite every 3 hours, so a prod
regression — the deploy pipeline, Azure Container Apps provisioning, the app
gateway, or the delete cascade — surfaces within ~3 hours instead of at the
next release tag.

Why a GitLab schedule and not a CloudWatch Synthetics canary in
`synthetic-monitoring`: canaries are Lambda-based Puppeteer scripts with a hard
**14-minute** timeout and no bun/node/npm on the runtime. A full
`init → scaffold → deploy → verify → teardown` cycle needs the real CLI and
runs 10–20 minutes, so it does not fit that substrate. The scheduled pipeline
reuses the runner image, the harness, and the prod CI variables that already
exist here.

Set it up once — left sidebar **Build → Pipeline schedules → New schedule**
(`https://gl.nimbusweb.co/cli/apps-cli/-/pipeline_schedules`). Note this is
*not* under Settings → CI/CD, where the `FUSEBASE_*` variables live:

| Field           | Value                                             |
| --------------- | ------------------------------------------------- |
| Description     | `prod synthetic — CLI app deploy lifecycle`       |
| Interval        | Custom cron `0 */3 * * *`                          |
| Cron timezone   | UTC                                                |
| Target branch   | `main`                                             |
| Variables       | *(none — the job reads the same `FUSEBASE_*` CI variables as the tag run)* |
| Activated       | ✅                                                  |

The schedule **owner** must have access to the protected `FUSEBASE_PROD_*`
variables, otherwise the suite SKIPs (green pipeline, no signal). Verify the
first run manually with the ▶ button on the schedule row.

If *Pipeline schedules* is missing from the sidebar, CI/CD is disabled for the
project or your role is below Developer — check Settings → General →
Visibility → *CI/CD* and your project membership.

### Alerting

A failed scheduled pipeline is the alert: the pipeline runs as the schedule
owner, and GitLab emails that user on every failure. Notification level *Watch*
on the project fans it out further. There is no CloudWatch/SNS wiring — this
monitor does not page on-call through the same path as the
`synthetic-monitoring` canaries.

### Triage

1. Open the failed `e2e:prod` job log. The smoke test prints the last 60 lines
   of `fusebase deploy` output plus, on an HTTP failure, the last status /
   content-type / body it saw from `/api/healthz`.
2. `[e2e teardown] Deleted app <id>` at the end means cleanup ran. If it is
   missing or reports a failure, check for a leaked product (see *Orphan
   resource cleanup* below).
3. A failure in *deploy* points at nimbus-ai / ACR / Container Apps; a failure
   in the `/api/healthz` poll with a deployed app points at the app gateway or
   the visitor-access path.

### What the scheduled run does **not** assert

Kept deliberately identical to the release-gating run, so the two never
diverge:

- **Cron execution is not verified at runtime** — the test asserts
  `fusebase job create` succeeded and the deploy completed with the job
  present, not that a tick actually fired (see step 12 in
  `smoke-deploy.e2e.ts` for why).
- **Azure resource removal is not verified** — teardown calls
  `DELETE /v1/orgs/{orgId}/products/{productId}` and trusts the nimbus-ai
  cascade to remove the Container App and Container Apps Job. A silently
  broken cascade would leak resources without failing this monitor.

## Orphan resource cleanup

The cascade in `nimbus-ai` (NIM-40898) deletes the Azure Container App and
Container Apps Jobs whenever the public-api `DELETE /v1/orgs/{orgId}/products/{productId}`
endpoint is called. The smoke test calls that endpoint in `afterAll` regardless
of test outcome, so the happy path leaves no orphans.

There is **no nightly orphan-cleanup job**. If a CI runner crashes between
"app created" and "app deleted" — for example, a SIGKILL from the runner host
or a network partition that prevents the teardown call — the Azure resources
will leak. This was an accepted risk per the parent-story decision: the blast
radius is one Container App + jobs, and the cost of a sweeper job was not
warranted at the original volume.

**The 3-hourly prod schedule raises that volume** from ~per release to 8 prod
runs a day, so leaks now accumulate 8× faster on the prod test org. Nothing
prunes them automatically — check the org periodically, or add a sweeper if
leaks show up in practice.

Listing and deleting leaked products (`main` uses `sub` for the generated
product slug and `title` for the `e2e-cli-…` name the test passes to
`fusebase init`; there is no `subdomain` field, and the list response is
wrapped in `products`):

```bash
# prod: public-api.thefusebase.com · dev: public-api.dev-thefusebase.com
API=https://public-api.thefusebase.com

curl -s -H "Authorization: Bearer $FUSEBASE_API_KEY" \
  "$API/v1/orgs/$FUSEBASE_TEST_ORG_ID/products" \
  | jq '.products[] | select(.title | startswith("e2e-cli-")) | {id, title, createdAt}'

curl -s -X DELETE -H "Authorization: Bearer $FUSEBASE_API_KEY" \
  "$API/v1/orgs/$FUSEBASE_TEST_ORG_ID/products/$PRODUCT_ID"
```

Deleting the product is enough — the `nimbus-ai` cascade removes the Container
App and Container Apps Jobs. To confirm directly in Azure, the names are
derivable: resource group `nimbus-org-<orgId>` (`-dev` suffix on dev),
backend Container App `nimbus-app-<appId>`, cron job
`j-<appId>-<sha1(orgId+appId+jobName)[0:13]>`.

```bash
az containerapp list     -g nimbus-org-$FUSEBASE_TEST_ORG_ID --query "[].name" -o tsv
az containerapp job list -g nimbus-org-$FUSEBASE_TEST_ORG_ID --query "[].name" -o tsv
```

Both should come back **empty** between runs. What legitimately stays behind is
the per-org shared infrastructure the first deploy provisions — the resource
group, the Log Analytics workspace `nimbus-law-<orgId>`, and the Container Apps
managed environment `nimbus-env-<orgId>`. These are not per-app and are not
removed by the cascade; leave them in place (re-creating the managed
environment costs ~2 minutes on the next run).
