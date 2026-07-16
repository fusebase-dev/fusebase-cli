# App Environments (Design)

**Status:** implemented behind the `environments` flag (branch `feature/app-environments`).
**Parent:** [MULTI-ENV-APPS-AND-PLATFORM-TESTING.md](./MULTI-ENV-APPS-AND-PLATFORM-TESTING.md) — Workstream A, detailed design.

**Implementation map:** core — `lib/environments.ts` (+ overlay in
`lib/config.ts` `loadFuseConfig`); auth map — `lib/config.ts`
(`auth.<backend>`, effective-apiKey resolution) + `lib/commands/auth.ts` /
`steps/auth-flow.ts`; commands — `lib/commands/env.ts`; reconcile write-back +
first-deploy bootstrap + env-info injection — `lib/commands/deploy.ts`,
`dev.ts`, `isolated-store.ts`; panel —
`feature-templates/spa/src/components/EnvPanel.tsx`. Tests:
`test/environments.test.ts`, `test/auth-backend-config.test.ts`,
`test/env-commands.test.ts`, `test/env-overlay.test.ts`.

**Deviations from the draft:** `.env` is a materialized copy of
`.env.<active>` refreshed by `env use`/`env tokens` (instead of a symlink /
process-env injection — open question 3 resolved this way); the env-info
payload is deliberately timestamp-free so it never churns deploy hashes
(§10.1's `deployedAt`/`version` dropped); panel visibility is opt-in via
`?envpanel=1` + localStorage with role-gating left to the app (§10.2's
automatic staff detection is a follow-up); `env init` auto-derives the first
env's name from the current backend, `--name` overrides (open question 3 of
§13).

---

## 1. Motivation

A project today is hard-bound to one platform context: `orgId`/`productId`/`apps[].id`
live in `fusebase.json`, `storeId` in `apps[].isolatedStores`, dashboard UUIDs in app
code, MCP tokens in `.env`, and the CLI has exactly one auth (`~/.fusebase/config.json`
→ single `apiKey` + single `env`). Running the same app tree against a second org or a
second platform stage means hand-editing all of the above.

Goal: a project can define **named environments** and any CLI command can run against
a chosen one.

## 2. Current state (code grounding)

| Mechanism | Where | Behavior |
|-----------|-------|----------|
| Backend selection | `lib/config.ts` → `getEnv()` | global `config.env` → default `"prod"` → `process.env.ENV`; hosts derived in `getFusebaseHost()`/`getFusebaseAppHost()`, API base in `lib/api.ts getBaseUrl()` (`dev`/`prod`/`local`) |
| Auth | `lib/commands/auth.ts` | single `apiKey` in global config; `--dev` also sets global `env: "dev"` — auth and backend selection are entangled |
| Project ids | `fusebase.json` | `orgId`, `productId`, `apps[].id`, `apps[].isolatedStores.sql[].storeId`; root `env` field is *"written but not used, only for debug"* |
| Declarative manifest | flag `declarative-manifest` | `apps[]` without `id`, reconcile at deploy/dev-start binds by `subdomain` or creates; resolved id **written back into `fusebase.json`** (NIM-41875) |
| MCP tokens | `.env` via `env create` | `DASHBOARDS_MCP_*`, `GATE_MCP_*`, `FUSEBASE_HOST`, `FUSEBASE_APP_HOST` — all backend+org-scoped, i.e. already environment-specific; switching global env today silently invalidates `.env` |

## 3. Concepts

- **Environment** — a named profile binding the project to a platform context:
  which **backend** (dev/prod platform), which **org/product**, resolved app ids,
  store ids, resource ids, test fixtures. Stored in `environments/<name>.json`,
  **committed to git**.
- **Backend** — the platform stage (`dev` | `prod` | `local`), a *field inside* an
  environment, not the environment itself. Several environments may share a backend:
  `prod` = clean customer org, `prod-beta` = beta stage on the prod platform,
  `prod-test` = QA org. This deliberately splits today's overloaded "env" into two
  notions.
- **Active environment** — per-checkout selection (not committed), plus per-command
  override.
- **A deployed bundle *is* an environment.** Environment identity is deploy-time:
  tokens, `gst`/`dst`, store bindings are minted per app id. There is no runtime
  environment flipping; "switching" between deployed stages is navigation between
  their URLs (§10).

### Example

```
environments/
  prod.json        # backend: prod, customer org, protected
  prod-beta.json   # backend: prod, same or QA org, subdomainSuffix "-beta"
  dev.json         # backend: dev, dev org
.env.prod          # MCP tokens + secrets for prod (gitignored)
.env.prod-beta
.env.dev
fusebase.json      # env-neutral declaration
```

## 4. File formats

### 4.1 `environments/<name>.json` (committed, no secrets)

```json
{
  "backend": "prod",
  "orgId": "u25klv",
  "productId": "prod_abc",
  "protected": true,
  "subdomainSuffix": "",
  "apps": {
    "client-portal": {
      "id": "v1qsglj1k17qpjyy",
      "subdomain": "ovation-client-portal",
      "stores": { "client-portal": "9593240d-...-uuid" },
      "resources": {
        "CONTRACTS_DASHBOARD": "3f2a...-uuid",
        "CONTRACTS_VIEW": "77b1...-uuid"
      }
    }
  },
  "fixtures": {
    "testUsers": [
      { "key": "owner",  "email": "qa-owner@fusebase.com",  "role": "owner" },
      { "key": "client", "email": "qa-client@fusebase.com", "role": "client" }
    ]
  }
}
```

- `apps` is keyed by the **app key**: a new optional `key` field on
  `fusebase.json` `apps[]`, defaulting to the entry's `subdomain`. The key is
  env-stable by definition; subdomains are not (see below), so the key — not the
  subdomain — is the join between manifest and environments. Existing projects
  never need to set `key` explicitly until they rename a subdomain per env.
- **Per-env `subdomain`** exists because subdomains are **globally unique per
  backend** (`{subdomain}.thefusebase.app` is a DNS name): two environments on the
  same backend cannot reuse one subdomain. Canonical case — production + beta on
  the prod platform: `prod` keeps `client-portal`, `prod-beta` sets
  `client-portal-beta` (or just `subdomainSuffix: "-beta"` env-wide; explicit
  per-app `subdomain` wins over the suffix). Each env is a fully separate app
  record on the platform — own id, permissions, stores, magic links. Isolation is
  the feature: beta cannot touch production data.
- Everything the platform owns and resolves lands here (this file **is** the env
  lockfile): reconcile write-back (NIM-41875) targets this file instead of
  `fusebase.json` when environments are enabled.
- `protected: true` → mutating commands (`deploy`, `app update`, `isolated-store …
  --apply`, `secret create`) print a prominent banner (env name, backend, org) and
  require confirmation (`--yes` for CI).

### 4.2 `.env.<name>` (gitignored, secrets + tokens)

Same keys as today's `.env` (`DASHBOARDS_MCP_*`, `GATE_MCP_*`, `FUSEBASE_HOST`,
`FUSEBASE_APP_HOST`) plus user-defined secrets, e.g. Playwright credentials:

```
GATE_MCP_TOKEN=...
PW_USER_OWNER_PASSWORD=...
PW_USER_CLIENT_PASSWORD=...
```

**Split rule:** identity of fixtures (emails, roles, user keys) is committable →
`environments/<name>.json` `fixtures`; credentials are secrets → `.env.<name>`,
referenced by convention `PW_USER_<KEY>_PASSWORD`. Test runners read both.

Rationale for two layers instead of a single `.env.prod`-style dotenv: ids/stores/
resources are structured and must be diffable/committable; tokens must not be
committed. A dotenv file cannot be both.

`fusebase dev start` **injects** the active env's `.env.<name>` values into the
spawned app/backend processes, so app code that reads `FUSEBASE_HOST`/`FBS_*` from
the process env keeps working without knowing about file naming.

### 4.3 Active-environment state (gitignored)

`.fusebase/state.json` in the project root (dir added to `.gitignore` by the CLI;
also the future home for other per-checkout state — dev-server ports, caches):

```json
{ "activeEnvironment": "dev" }
```

Not in `fusebase.json` (would flip-flop between developers in git), not in the global
config (it is per-checkout, one user can have two clones).

## 5. Resolution precedence

For every command:

```
--env <name> flag  >  FUSEBASE_ENV env var  >  .fusebase/state.json  >
fusebase.json "defaultEnvironment"  >  legacy mode (no environments/ dir)
```

Backend resolution inside the chosen environment replaces today's `getEnv()`:
`environments/<name>.json → backend`. Legacy mode keeps the current chain
(global `config.env` → `process.env.ENV` → `"prod"`).

## 6. Auth model

Global config gains per-backend auth; auth is decoupled from backend selection:

```json
{
  "auth": {
    "prod": { "apiKey": "..." },
    "dev":  { "apiKey": "..." }
  },
  "env": "dev",          // legacy, still honored in legacy mode
  "apiKey": "..."        // legacy, migrated on first write
}
```

- `fusebase auth` / `fusebase auth --dev` writes `auth.prod` / `auth.dev`
  (**no longer flips global `env`** when environments are enabled). Migration: on
  first run the legacy `apiKey` is copied into `auth[getEnv()]`.
- Dual auth is therefore supported — it is just two API keys. Commands pick
  `auth[environment.backend]`.
- If the key for the target backend is missing/invalid, the command fails with a
  guided message and (in TTY) **offers to run the auth flow for that backend
  immediately**: `fusebase env use prod-test` → "No prod auth found. Run auth now?
  (opens browser)".
- CI: `FUSEBASE_API_KEY` overrides `auth[backend]` (matches existing e2e-test
  convention).

## 7. Declarative manifest integration

Environments **extend** the declarative model (NIM-41746); they don't replace it.

- `fusebase.json` becomes fully env-neutral: `apps[]` keep `key` (optional,
  defaults to `subdomain`), `subdomain` (default value), `name`, `path`, `dev`,
  `build`, `backend`, permission meta, store **aliases** — and **no `id`**.
  `orgId`/`productId` remain as legacy fallback, ignored (with a warning) when
  `environments/` exists.
- Reconcile (deploy/dev-start) works per environment: match env-effective subdomain →
  bind or create in `environment.orgId`/`productId` → **write back into
  `environments/<name>.json`**, not into `fusebase.json`.
- `writeResolvedAppIdToFusebaseJson` / storeId persistence get an env-aware
  counterpart; `requireAppId(app)` becomes `requireAppId(app, env)`.
- The `environments` feature **requires and implies `declarative-manifest`**: with
  environments enabled the declarative path is the default (no flag juggling for new
  projects). Long-term the two merge: the declarative manifest *generates* a default
  environment (§8) — a plain single-env project is just a project with one implicit
  environment.

## 8. Migration & back-compat

Three states, no cliff:

1. **Do nothing (legacy mode).** No `environments/` dir → behavior is exactly
   today's: global env, ids in `fusebase.json`, single `.env`. Hardcoded-id apps
   keep working untouched.
2. **One-command opt-in.** `fusebase env init` in an existing project:
   - creates `environments/<current-backend>.json` from the current
     `fusebase.json` (`orgId`, `productId`, `apps[].id`, `storeId`s) — the
     current context becomes the first named environment;
   - renames `.env` → `.env.<name>` (keeps a `.env` symlink/copy during a
     deprecation window for app code that reads it);
   - writes `.fusebase/state.json` with that env active;
   - ensures `.gitignore` entries;
   - leaves ids in `fusebase.json` in place (harmless; env file wins). Optional
     `fusebase env init --strip` removes them for a clean manifest.
3. **Add the second environment.** `fusebase env add dev --backend dev --org <id>`
   (or `fusebase env clone prod dev --backend dev --org <id>` to copy structure,
   fixtures skeleton, subdomain suffix). First `fusebase deploy --env dev` (or
   `--nocode`) reconciles: creates product/apps in the dev org, fills the lockfile.
   Stores/dashboards/seed data are created by deploy + app seed scripts (parent doc,
   Workstream A3).

Gate initially behind an `environments` experimental flag; graduates with
`declarative-manifest`.

## 9. Commands

New `fusebase env` subcommand group (the existing `env create` is folded in as
`tokens`, with an alias kept during deprecation):

| Command | Behavior |
|---------|----------|
| `fusebase env init [--strip]` | Adopt environments in an existing project (§8.2) |
| `fusebase env add <name> --backend <dev\|prod> --org <orgId> [--product <id>] [--subdomain-suffix <s>]` | Create a new environment file (no platform calls) |
| `fusebase env clone <from> <to> --org <orgId> [--backend …]` | New env file copying structure/fixture keys from an existing one (ids cleared) |
| `fusebase env use <name> [--tokens]` | Switch active env (writes `.fusebase/state.json`); checks `auth[backend]` and **offers re-auth** when missing; offers `env tokens` refresh when `.env.<name>` is absent/stale (`--tokens` refreshes without asking, for scripts) |
| `fusebase env list` | Envs with backend, org, active marker, auth status |
| `fusebase env status` | Active env: backend, org/product, auth ok/missing, per-app id resolved/unresolved, `.env.<name>` token fingerprints fresh/stale |
| `fusebase env tokens [--env <name>]` | Today's `env create` per environment: writes `.env.<name>` MCP tokens for that env's backend+org |
| `fusebase env diff <a> <b>` | (later) compare two envs: apps present, permissions drift, store aliases |

All existing commands gain `--env <name>` (deploy, dev start, app update, analyze,
isolated-store, secret, remote-logs, integrations/config ide where relevant).

## 10. Env-info injection & in-app env panel

The env layer gets a **runtime surface**: a floating, staff-only panel inside the
deployed app showing where you are and letting you jump between stages.

### 10.1 Injection contract (CLI-side)

At `fusebase deploy --env X` (and `dev start`) the CLI knows everything the panel
needs and bakes it into the build — no runtime "which env am I in" API:

```json
{
  "env": "prod-beta",
  "protected": false,
  "backend": "prod",
  "orgId": "u25klv",
  "productId": "prod_abc",
  "appKey": "client-portal",
  "appId": "v1qsg…",
  "deployedAt": "2026-07-14T…",
  "version": "…",
  "counterparts": [
    { "env": "prod", "url": "https://client-portal.thefusebase.app", "protected": true, "sameOrg": true }
  ]
}
```

Delivery: Vite define (`window.__FUSEBASE_ENV__`) or a `fusebase-env.json` asset
next to the bundle. `counterparts` is derived from the other `environments/*.json`
files at deploy time. Store ids / resource maps may be included for the panel's
info view; secrets never.

### 10.2 Panel semantics

- **Switching = navigation.** A deployed bundle *is* an env (§3); the switcher
  navigates to the counterpart URL. Same org on `.thefusebase.app` → session is
  shared (NIM-41842), transition is seamless. Different org → re-login; the panel
  says so explicitly ("beta: different org, sign-in required"). App state
  (open records etc.) does not carry over — entity ids differ per env by design.
- **Staff-only.** Render only for `owner`/`manager` from `getMe`; never for
  visitor/client. Ids are not secrets, but the panel is an admin surface.
- **`protected` marker.** Red "PROD" badge on protected envs — the UI mirror of
  the CLI guardrail (§4.1), cheap insurance against "thought I was on beta".
- **Debug surface.** The panel is the standard home for the in-app observability
  the issues workspace already demands (env name, ids, token role/scopes, recent
  API errors) — replaces per-app ad-hoc debug consoles.
- **Test hook.** Playwright specs (parent doc, Workstream C) read env
  name/appId from the panel via a stable selector and assert they run against the
  intended stage — cheap protection against pointing a test run at the wrong org.

### 10.3 Placement

Component ships in `project-template` (+ skill); apps never configure it by hand —
the data contract comes entirely from the CLI at deploy time.

## 11. Answers to the original design questions

1. **`.env.prod` vs `environments/prod.json`** → both, with a strict split:
   structured committable ids/fixtures in `environments/<name>.json`, secrets and
   MCP tokens in `.env.<name>` (§4).
2. **Env ≠ backend stage** → `backend` is a field inside the environment (§3);
   any number of envs per backend (clean org + beta + QA org on prod), subdomain
   uniqueness handled per env (§4.1).
3. **Test users for Playwright** → fixture identities in the env file
   (`fixtures.testUsers`), passwords in `.env.<name>` by naming convention (§4.2).
   Separate file not needed until fixtures grow; the schema leaves room
   (`fixtures` is an object).
4. **`fusebase auth --dev` vs environments** → per-backend auth map in global
   config (§6); switching to an env whose backend has no key triggers a guided
   re-auth offer. Auth stops mutating the global `env`.
5. **Switch command** → `fusebase env use` + `--env` per command + `FUSEBASE_ENV`
   (§5, §9).
6. **Declarative manifest** → environments build on it; reconcile write-back moves
   to the env lockfile; single-env projects are an implicit environment; long-term
   the manifest generates the default env (§7).
7. **Legacy apps** → untouched in legacy mode; adoption is one `fusebase env init`;
   ids left in `fusebase.json` stay harmless (§8).

## 12. Resolved decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | App key in env `apps{}` | Explicit optional `key` on `apps[]`, defaults to `subdomain` (§4.1) — subdomain itself may differ per env, so it cannot be the join key |
| 2 | `env use` token refresh | Offer in TTY; `--tokens` flag refreshes without prompting (scripts/CI) (§9) |
| 3 | App code reading `.env` | `dev start` injects `.env.<active>` into spawned processes; `.env` symlink kept during deprecation window (§4.2, §8.2) |
| 4 | `productId` per env? | Yes — products are per-backend platform entities; one per environment (§4.1) |
| 5 | Active-env state location | `.fusebase/state.json`, gitignored; future home for other per-checkout state (§4.3) |
| 6 | Same-backend stages (prod + beta) | Per-env `subdomain` / `subdomainSuffix`; separate app records; isolation by design (§4.1) |
| 7 | Runtime env awareness | Deploy-time injection + staff-only panel; switching is navigation, never runtime flipping (§10) |

## 13. Remaining open questions

1. `counterparts` in the injection contract: include **all** envs or only
   non-protected ones on the same backend? (Leaning: all, panel greys out
   cross-backend entries.)
2. Panel implementation form: template-copied component vs a tiny published
   package (`@fusebase/env-panel`) updatable via managed deps? (Leaning: managed
   package — panel fixes shouldn't require template re-scaffold.)
3. Does `env init` need a `--name` override for the first env when the current
   backend name (`prod`) is not how the team calls it?
4. Interaction with managed apps (`managed-app-org-setups`): a managed install is
   effectively a platform-side environment — should the env file be able to
   reference a managed setup instead of a raw org?
