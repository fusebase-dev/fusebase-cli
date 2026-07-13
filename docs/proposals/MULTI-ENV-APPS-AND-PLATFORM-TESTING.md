# Multi-Env Apps, Backward Compatibility, and End-to-End Platform Testing (Preliminary Plan)

**Status:** draft for discussion — expect corrections.
**Scope:** apps-cli + platform services (fusebase-gate, nimbus-ai, api-nx/app-wrapper) + QA process.
**Evidence base:** `/Users/di/Fusebase/issues` investigations (008, 024, 030, 035, 038, 041, 043, 046, …).

---

## The Three Pains

### Pain 1 — an app built for prod cannot be tested on dev

Every identifier in a deployed app is env-bound: `orgId`, `productId`, `apps[].id`,
isolated store `storeId`, dashboard/view UUIDs, users/roles, feature secrets. Bug
reports against prod apps (Ovation 038/041) are debugged and verified **directly on
prod** because there is no dev twin. Fix cycles are gated by prod rollouts.

### Pain 2 — platform changes break already-deployed apps

Vibecode apps are **frozen artifacts**: users do not redeploy when gate / api-nx /
nimbus-ai ship. Recent regressions of this class:

- gate v2.3.28 + api-nx `forward-proxy`: `loa` + gst overrode `Internal ${userId}:web`
  → prod invite 403 (issue 043);
- Gate SDK 2.3.29 + permission re-sync → prod auth lockout (`getMe` → `health.read`,
  issue 041);
- bare `--sync-gate-permissions` wipes `backendOnlyGatePermissions` (NIM-42101).

Compat flags exist (`legacyOwnerAuthFallback`, `preferGateServiceTokenAuth`,
`x-legacy-owner-auth`) but are ad-hoc, one per incident. The compat checklist
(`issues/AGENTS.md` §2.5) is executed by humans after the incident, not by CI before
the deploy.

### Pain 3 — no end-to-end testing of the whole vibe-app chain

Unit/service tests exist per service but never cross the chain
(browser → app-wrapper/api-nx proxies → nimbus-ai mint → gate/dashboard → stores).
Manual QA is slow and its dev and prod test sets have diverged (consequence of
Pain 1). Ad-hoc Playwright verification scripts already prove the approach works
(issue 043 post-fix smoke, issue 038 Blocker A verify) but are single-use and live in
issue folders.

**Key insight:** the three pains form one system. The env-portability mechanism
(Pain 1) is what makes "same test cases on dev and prod" possible (Pain 3), and the
test-app fleet (Pain 3) is the detection mechanism for compat regressions (Pain 2).

---

## Workstream A — env-portable apps (Pain 1)

> **Detailed design:** [APP-ENVIRONMENTS.md](./APP-ENVIRONMENTS.md) — named
> environment profiles (`environments/<name>.json` + `.env.<name>`), backend as a
> field inside the environment, per-backend auth, `fusebase env` command group,
> migration path. Supersedes the sketch below where they differ.

### What already exists

- **`declarative-manifest` flag** (NIM-41746/41963): `apps[]` entries without `id`,
  deploy-time reconcile binds by `subdomain` or creates the app. This is already the
  core mechanism for "attach the same tree to a different org". The blocker is only
  that the resolved `id` is written back into the shared `fusebase.json`, killing
  portability.
- **`issues/scripts/rebuild-issue-app-for-dev.sh`** — proves a prod app snapshot can
  be re-registered in a dev org (`fusebase init` + `app create` loop + gate meta
  merge), but as a one-shot copy, not a sustained two-env workflow.

### A1. Env-neutral manifest + per-env lockfile (core CLI change)

- `fusebase.json` keeps only the declaration: `subdomain`, `name`, `path`,
  `dev`/`build`, isolated-store **aliases**, permissions meta.
- All resolved identifiers move to `fusebase.env.<env>.json` (one per env, e.g.
  `fusebase.env.dev.json`, `fusebase.env.prod.json`): `orgId`, `productId`,
  `apps[].id`, `storeId`, discovered resource ids.
- Reconcile write-back (NIM-41875) targets the env lockfile instead of the shared
  entry. `deploy` / `dev start` / `app update` / `isolated-store sql bundle` accept
  `--env <dev|prod>` (default from global config, as today).
- Incremental change on top of `declarative-manifest`, not a redesign.

### A2. Isolated stores by alias

The rule already stated in README ("runtime resolves stores by alias; `storeId` is
operator/CI tooling only") becomes enforced: `storeId` lives in the env lockfile;
migrations stay env-neutral (journal already lives in Gate per stage).

### A3. Dashboard/view UUIDs — the hard blocker

Prod dashboard UUIDs hardcoded in app code do not exist on dev (confirmed by the
dev-rebuild checklist). Plan:

- template convention: **all** platform resource ids go through a single
  `config/resources.ts`, values from env (feature secrets per env) or from
  discovery-by-name on first boot, cached into the env lockfile;
- per-app **seed script** convention (`fusebase deploy --nocode` + seeding) so the
  dev twin gets data;
- bake this into `project-template` from day one — without it app portability does
  not materialize. This is the riskiest item of the whole plan.

### A4. Users and secrets per env

Fixture user set per env (visitor, `orgRole:client`, member, manager, owner) in a
dedicated dev org; magic-link invites scripted. Feature secrets are already per-app,
hence per-env once apps differ.

### A5. Phasing

- **P0 (no platform changes):** generalize the issues rebuild script into
  `fusebase env clone` / `fusebase promote` — a wrapper over existing `init` /
  `app create` / meta-merge.
- **P1:** native env profiles + lockfile in the CLI (ticket next to NIM-42101 — the
  same sync/persist logic is being touched there anyway).

---

## Workstream B — backward compatibility for deployed apps (Pain 2)

### B1. Token-path replay tests in platform CI (cheapest, highest value)

`issues/AGENTS.md` §2.5 requires "replay two token paths: service token (`token`
subject) and forwarded session token (`user` subject)" — turn this into an automated
suite in fusebase-gate and api-nx CI: for every MCP-visible op, replay both subjects
and fail when the authz matrix changes without an explicit breaking marker. Both
issue 043 (`forward-proxy` + `loa`) and issue 041 (2.3.29 `getMe` lockout) would have
been caught by exactly this.

### B2. Canary fleet of frozen apps

3–5 reference apps deployed with **old** CLI/SDK versions and never redeployed, on
dev and prod. Smoke them after every gate / api-nx / nimbus-ai deploy. By definition
this detects the "frozen app code + contract regression" class that per-service tests
cannot see. (Implementation-wise these are the Workstream C sentinel apps with pinned
versions — the second fleet is nearly free.)

### B3. Systematic `compatLevel` instead of ad-hoc flags

`loa` / `pgst` accumulate one per incident. Introduce a scaffold **generation** in
the app manifest (`compatLevel`; the CLI already records coding-agent/model at
creation, NIM-41997). New enforcement in gate / nimbus-ai activates only for
`generation >= N`; legacy apps keep old behavior automatically; opt-in happens by
redeploying with a fresh CLI.

### B4. Process

- Blast-radius classification (§2.5 step 1: "new apps only vs all deployed apps") as
  a mandatory MR-template field in gate / api-nx / nimbus-ai.
- fusebase-gate changelog discipline already exists — add a required "legacy paths
  affected" line.

---

## Workstream C — end-to-end sentinel apps (Pain 3)

Do not build a separate QA harness. Make testability a property of vibecode apps
themselves: an app that runs in both envs (Workstream A) carries Playwright specs
that run in both envs.

### C1. Sentinel apps by capability area

Each is a normal vibecode app plus a `tests/` folder of Playwright specs:

| App | Covers | Incident classes |
|-----|--------|------------------|
| `auth-matrix` | roles × access, magic links, embed/iframe, sessions | 008, 012, 024, 029, 030, 035, 043, 046 |
| `store-probe` | isolated SQL: migrations, RLS personas, actor/scope | 021, 023, 028, 036, 038 |
| `dashboard-probe` | batchPut, resourceScope, files/multipart, 429 backoff | 005, 006, 018, 020, 039 |
| `backend-probe` | cron, sidecars, secrets, gate service tokens | 011, 017 |
| `x-app-caller` + `x-app-provider` | cross-app API discovery/contracts | 037, 040 |

### C2. Env-parameterized specs

Base URL, fixture users, resource ids come from the Workstream A env lockfile. The
same case set runs on dev and prod **by construction** — the dev/prod QA test-set
divergence disappears as a category.

### C3. Runner and reporting

GitLab CI schedule (or the scout agent, already on AKS): smoke on dev after each
platform-service deploy, on prod after releases; report to the Teams
`service-status` channel. Manual invocation is an acceptable start — the pattern is
already proven by issue 043's one-command three-app post-fix smoke.

### C4. QA + AI authoring loop

QA verifies a new feature manually → in the same sentinel-app repo an agent converts
the manual steps into a Playwright spec (patterns from `issues/AGENTS.md` §3.8:
snapshot/refs, no secrets in git) → QA reviews → the case joins the regression set of
both envs. A `test-authoring` skill in the sentinel repos keeps generated specs
uniform.

### C5. Keep it light

Start with **one** app (`auth-matrix` — the auth/token class is the most frequent
incident source) plus the P0 env mechanics, run manually on dev and prod. Expand only
after the loop proves itself.

---

## Phasing Summary

| Phase | Deliverables | Pains addressed |
|-------|--------------|-----------------|
| **0** (~2 weeks) | `fusebase env clone` from the rebuild script; sentinel `auth-matrix` with specs; manual dev+prod runs | 1 (partial), 3 (core loop) |
| **1** | Env profiles + lockfile in CLI (with NIM-42101); CI runner + Teams reporting; token-path replay tests in gate/api-nx CI | 1, 2 (detection), 3 |
| **2** | Frozen-version canary fleet; `compatLevel` in manifest; remaining sentinel apps | 2, 3 (coverage) |

---

## Open Questions

1. **Env lockfile shape** — separate `fusebase.env.<env>.json` files vs a single
   `environments:` block inside `fusebase.json`? Separate files keep the manifest
   clean and diff-friendly; a block is simpler for the CLI. Leaning separate files
   (secrets-free, committable).
2. **Dashboard resource mapping** — discovery-by-name vs explicit per-env map in the
   lockfile? Names are user-editable on the platform; probably explicit map with a
   `fusebase resources discover` helper.
3. **Where sentinel apps live** — GitLab `vibecode/` group (like customer apps) vs a
   dedicated `platform-tests/` group? Needs CI-runner access either way.
4. **compatLevel semantics** — per-manifest integer vs date-based generation vs
   deriving from the CLI version recorded at create time?
5. **Prod smoke safety** — sentinel apps on prod mutate real (own-org) data; define a
   dedicated prod org + cleanup discipline, and which cases are read-only-on-prod.
6. **Ownership** — replay-test suite lives in fusebase-gate/api-nx repos (service
   teams) while sentinel fleet is cross-team; who owns the runner and triage rota?
