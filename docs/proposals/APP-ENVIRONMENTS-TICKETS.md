# Jira ticket drafts — App Environments + Sentinel PW Testing

Ready-to-create drafts for project **NIM**. Source designs:
[APP-ENVIRONMENTS.md](./APP-ENVIRONMENTS.md) (implemented on apps-cli branch
`feature/app-environments`) and
[MULTI-ENV-APPS-AND-PLATFORM-TESTING.md](./MULTI-ENV-APPS-AND-PLATFORM-TESTING.md)
(Workstream C).

Conventions: types per NIM issue-type table; labels free-form (`apps`,
`environments`, `e2e-tests` suggested); child tickets link via Epic Link.

> **Created in Jira (2026-07-16)** — Epic A went in as Story
> [NIM-42430](https://nimbusweb.atlassian.net/browse/NIM-42430) with sub-tasks:
> A1 → NIM-42431, A2 → NIM-42432, A3 → NIM-42433, A4 → NIM-42434,
> A5 → NIM-42435, A6 → NIM-42436, A6a → NIM-42437.
> Epic B (sentinel PW testing) — not created yet, to be detailed later.

---

## Epic A — App Environments in apps-cli

> **Type:** Epic
> **Summary:** App Environments: one app project targeting dev/prod/beta platform contexts
> **Labels:** `apps`, `environments`
> **Description:**
> Named environment profiles in apps-cli: `environments/<name>.json`
> (committed lockfile: backend, org, product, resolved app ids, per-env
> subdomains, store ids, fixtures, protected marker) + gitignored
> `.env.<name>`; per-backend auth; `fusebase env` command group; `--env <name>`
> on every command; reconcile write-back into the env lockfile; env-info baked
> into deployed bundles + in-app EnvPanel. Fixes the "prod apps cannot be
> tested on dev" pain (Ovation 038/041 class). Design:
> `apps-cli/docs/proposals/APP-ENVIRONMENTS.md`. Implementation exists behind
> the `environments` flag on branch `feature/app-environments`.

### A1 — Review & merge the environments implementation

- **Type:** Task
- **Summary:** apps-cli: review/merge `feature/app-environments` (env core, auth map, env commands, overlay, EnvPanel)
- **Labels:** `apps`, `environments`
- **Description:** 6 commits on `feature/app-environments`
  (`3ba7b5a..a52c280`): `lib/environments.ts` core + `getEnv()` wiring;
  per-backend `auth.dev/auth.prod` with effective-apiKey resolution;
  `fusebase env init/add/clone/use/list/status/tokens`; environment overlay in
  `loadFuseConfig` + `persistResolvedAppId` write-back (deploy / dev start /
  isolated-store); first-deploy product bootstrap; `fusebase-env.json`
  injection + spa-template EnvPanel; docs. All behind the `environments` flag;
  legacy mode byte-identical. 361 unit tests green incl. 4 new suites.
- **AC:** branch merged; flag documented; legacy-mode regression pass
  (`bun test`, `env`-less project smoke).

### A2 — Real-API e2e: two-environment lifecycle

- **Type:** Task
- **Summary:** apps-cli e2e: env init → env add dev → deploy --env dev bootstraps product/apps → status/tokens
- **Labels:** `apps`, `environments`, `e2e-tests`
- **Description:** Extend `test/e2e/` (needs `FUSEBASE_API_KEY`,
  `FUSEBASE_TEST_ORG_ID`): adopt a project (`env init`), add a second env in
  the test org, run `deploy --env <name> --nocode`, assert product/app created
  and ids written into `environments/<name>.json` (not fusebase.json), assert
  `env status` resolution and `.env.<name>` token creation. Include the
  subdomain-suffix path (same backend, two envs).
- **AC:** e2e green in CI; orphan cleanup for created products/apps.

### A3 — EnvPanel staff auto-gating

- **Type:** Improvement
- **Summary:** EnvPanel: gate visibility by org role (owner/manager) instead of manual opt-in only
- **Labels:** `apps`, `environments`
- **Description:** Panel is currently `?envpanel=1` + localStorage opt-in with
  role-gating left to the app. Wire a default role check (getMe / auth
  context from the template) so the panel can be shown automatically to staff
  and never to visitor/client. Keep the opt-in escape hatch.

### A4 — Persist created isolated-store ids into the env lockfile

- **Type:** Task
- **Summary:** apps-cli: write storeId into environments/<name>.json when a store is created/bound for an env
- **Labels:** `apps`, `environments`, `isolated-stores`
- **Description:** Reads already come from the lockfile (overlay maps
  `stores.<alias>` → `isolatedStores.sql[].storeId`). Write path missing: when
  Gate provisions/binds a store during `isolated-store sql bundle --apply` or
  deploy, persist the id under the active env's app entry, alias-keyed.

### A5 — Distribute EnvPanel + env guidance to existing apps via `fusebase update`

- **Type:** Task
- **Summary:** fusebase update: refresh EnvPanel component and env skill sections in generated apps
- **Labels:** `apps`, `environments`
- **Description:** EnvPanel ships in `feature-templates/spa` (new scaffolds
  only). Decide distribution for existing apps: managed asset via
  `fusebase update` agent-assets stage vs published package
  (`@fusebase/env-panel`, design §13.2). Include skill/AGENTS guidance refresh.

### A6a — Gate: org-mismatch hint in FORBIDDEN responses (platform, nice-to-have)

- **Type:** Improvement
- **Summary:** fusebase-gate: append a diagnostic hint when the requested org differs from the caller token's org
- **Labels:** `apps`, `environments`, `gate`
- **Description:** Multi-env apps hit a recurring client-side race: a stale
  baked org id sends Gate calls for another backend's org, producing
  `FORBIDDEN — User does not have access to this organization (userId=…,
  orgId=…)`. The platform response is correctly fail-closed; this ticket only
  improves diagnosability: when the **path org differs from the org bound to
  the caller's token context** (feature token / gst org, `roid`), extend the
  error body with a hint, e.g. `hint: "requested orgId (ucp0t) differs from
  the app token's org (uk1u) — check runtime org context
  (window.__FUSEBASE_ENV__ / fusebase-env.json)"`. Same pattern as existing
  `AppTokenValidationError` hints. Client-side closure already shipped in
  apps-cli (synchronous `window.__FUSEBASE_ENV__` injection + context-priority
  skill guidance); this makes remaining stragglers self-diagnosing.
- **AC:** hint present only on org-mismatch (not on plain membership denials);
  covered by a gate contract test; release note per fusebase-gate changelog
  discipline.

### A6 — Pilot migration + flag graduation plan

- **Type:** Task
- **Summary:** Environments pilot: migrate one real app (env init + dev env), then graduate the `environments` flag
- **Labels:** `apps`, `environments`
- **Description:** Pick a pilot (candidate: an Ovation-class prod app or an
  internal managed app), run `env init` + `env add dev`, bootstrap on the dev
  platform, document friction (dashboard UUID mapping — Workstream A3 of the
  umbrella plan — expected to be the main gap). Exit criteria for removing the
  experimental flag.

---

## Epic B — Sentinel Playwright testing (dev = prod cases)

> **Type:** Epic
> **Summary:** Sentinel vibecode apps with env-parameterized Playwright suites (same cases on dev and prod)
> **Labels:** `apps`, `e2e-tests`
> **Description:**
> End-to-end testing of the whole vibe-app chain (browser → app-wrapper →
> api-nx proxies → nimbus-ai mint → gate/dashboard → stores) via sentinel
> apps that run in both dev and prod environments (Epic A mechanics) and carry
> their own Playwright specs. Replaces divergent manual dev/prod QA sets;
> detects platform regressions on deployed apps (043/041 class). Plan:
> `apps-cli/docs/proposals/MULTI-ENV-APPS-AND-PLATFORM-TESTING.md` Workstream C.

### B1 — Env-parameterized Playwright harness

- **Type:** Task
- **Summary:** PW harness: fixtures/base URLs from environments/<name>.json + .env.<name>; stage assertion via fusebase-env.json
- **Labels:** `apps`, `e2e-tests`, `environments`
- **Description:** Shared harness (playwright.config + helpers) that reads the
  target env's lockfile (base URL from effective subdomain, `fixtures.testUsers`)
  and credentials from `.env.<name>` (`PW_USER_<KEY>_PASSWORD` convention).
  Every spec asserts the intended stage via `fusebase-env.json` /
  `data-testid="fbs-env-panel-name"` before running. Selected with
  `FUSEBASE_ENV=<name>`.
- **AC:** one command runs the same spec set against dev and prod-test envs.

### B2 — Sentinel app #1: `auth-matrix`

- **Type:** Story
- **Summary:** Sentinel app auth-matrix: roles × access, magic links, embed/session PW cases on dev and prod
- **Labels:** `apps`, `e2e-tests`, `auth`, `magic-link`
- **Description:** Vibecode app covering the most frequent incident class
  (008, 012, 024, 029, 030, 035, 043, 046): role matrix
  (visitor/client/member/manager/owner) × app access, `getMe`/access checks,
  magic-link request/activation/session-domain, embed iframe token
  delivery/renewal, gate proxy calls per role. Fixture users per env; specs on
  the B1 harness. Environments: `dev` + `prod-test` (dedicated QA org on prod;
  `protected` on the clean org only).
- **AC:** full run green on dev and prod-test; failures produce
  request-id/trace output suitable for `issues/` triage.

### B3 — CI runner + Teams reporting

- **Type:** Task
- **Summary:** CI: scheduled sentinel smoke on dev after platform deploys; prod-test after releases; report to Teams service-status
- **Labels:** `e2e-tests`
- **Description:** GitLab CI schedule (or scout agent) running the sentinel
  suite: dev after each gate/api-nx/nimbus-ai deploy (hook into
  helm-chart-updater flow), prod-test after release. Result summary to the
  Teams `service-status` channel with per-case status and request ids on
  failure. `FUSEBASE_ENV` + `FUSEBASE_API_KEY` one-liner invocation.

### B4 — QA authoring loop (manual check → PW spec)

- **Type:** Task
- **Summary:** test-authoring skill: agent converts QA manual steps into env-parameterized PW specs in sentinel repos
- **Labels:** `e2e-tests`
- **Description:** Skill + conventions in sentinel repos so an agent turns a
  QA-verified manual scenario into a Playwright spec (snapshot/refs patterns
  per `issues/AGENTS.md` §3.8; no secrets in git; fixtures by key). QA reviews
  the spec; the case joins the shared dev/prod regression set.

### B5 — Sentinel apps #2–#3: store-probe, dashboard-probe

- **Type:** Story
- **Summary:** Sentinel apps store-probe (isolated SQL/RLS/migrations) and dashboard-probe (batchPut/resourceScope/files/429)
- **Labels:** `apps`, `e2e-tests`, `isolated-stores`
- **Description:** After the auth-matrix loop proves itself: store-probe
  covers migrations/actor/scope/RLS personas (021, 023, 028, 036, 038);
  dashboard-probe covers write paths, resourceScope, multipart files, 429
  backoff (005, 006, 018, 020, 039). Same harness and env set.

### B6 — Frozen canary fleet (backward-compat detector)

- **Type:** Task
- **Summary:** Canary fleet: deploy sentinel apps with pinned old CLI/SDK versions; smoke after every platform deploy
- **Labels:** `apps`, `e2e-tests`, `TechDebt`
- **Description:** Deploy copies of sentinel apps built with older CLI/SDK
  generations and never redeploy them; run their smoke after gate / api-nx /
  nimbus-ai deploys. Detects the "frozen app + platform contract regression"
  class (gate v2.3.28 forward-proxy 403, SDK 2.3.29 lockout) before customers
  do. Umbrella plan Workstream B2.

---

## Creation notes

- Suggested order: A1 → A2/B1 in parallel → B2 → B3 → rest.
- Cross-links: B1 depends on A1 (env mechanics); B6 relates to NIM-41248
  (authz enforcement) history; A4 relates to NIM-41280/41842 areas.
- Put A/B epics on NIM board 12 backlog (`Feature Backlog`), not the active sprint.
