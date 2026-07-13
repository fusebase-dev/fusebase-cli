# App Environments (Design Proposal)

**Status:** draft for discussion.
**Parent:** [MULTI-ENV-APPS-AND-PLATFORM-TESTING.md](./MULTI-ENV-APPS-AND-PLATFORM-TESTING.md) — Workstream A, detailed design.

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
  environment, not the environment itself. Several environments may share a backend
  (e.g. `prod` = clean customer org, `prod-test` = QA org on the prod platform).
  This deliberately splits today's overloaded "env" into two notions.
- **Active environment** — per-checkout selection (not committed), plus per-command
  override.

### Example

```
environments/
  prod.json        # backend: prod, org: customer, protected
  prod-test.json   # backend: prod, org: QA
  dev.json         # backend: dev, org: issues/dev org
.env.prod          # MCP tokens + secrets for prod (gitignored)
.env.prod-test
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

- `apps` is keyed by the **manifest app key** (see §7 — `subdomain` from
  `fusebase.json` is the default key). Per-env `subdomain` override exists because
  subdomains are **globally unique per backend** (`{subdomain}.thefusebase.app` is a
  DNS name): two environments on the same backend cannot reuse one subdomain.
  `subdomainSuffix` is a convenience for bulk renaming (`client-portal` →
  `client-portal-test`); explicit per-app `subdomain` wins.
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

### 4.3 Active-environment state (gitignored)

`.fusebase/state.json` in the project root (dir added to `.gitignore` by the CLI):

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

- `fusebase.json` becomes fully env-neutral: `apps[]` keep `subdomain` (the default
  match key / app key), `name`, `path`, `dev`, `build`, `backend`, permission meta,
  store **aliases** — and **no `id`**. `orgId`/`productId` remain as legacy fallback,
  ignored (with a warning) when `environments/` exists.
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
| `fusebase env use <name>` | Switch active env (writes `.fusebase/state.json`); checks `auth[backend]` and **offers re-auth** when missing; offers `env tokens` refresh when `.env.<name>` is absent/stale |
| `fusebase env list` | Envs with backend, org, active marker, auth status |
| `fusebase env status` | Active env: backend, org/product, auth ok/missing, per-app id resolved/unresolved, `.env.<name>` token fingerprints fresh/stale |
| `fusebase env tokens [--env <name>]` | Today's `env create` per environment: writes `.env.<name>` MCP tokens for that env's backend+org |
| `fusebase env diff <a> <b>` | (later) compare two envs: apps present, permissions drift, store aliases |

All existing commands gain `--env <name>` (deploy, dev start, app update, analyze,
isolated-store, secret, remote-logs, integrations/config ide where relevant).

## 10. Answers to the open design questions

1. **`.env.prod` vs `environments/prod.json`** → both, with a strict split:
   structured committable ids/fixtures in `environments/<name>.json`, secrets and
   MCP tokens in `.env.<name>` (§4).
2. **Env ≠ backend stage** → `backend` is a field inside the environment (§3);
   any number of envs per backend (clean org + QA org on prod).
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

## 11. Additional proposals (beyond the asks)

- **Prod guardrail:** `protected: true` + banner + confirmation on mutating
  commands (§4.1). Directly addresses the "QA on prod tenant" incidents (Ovation).
- **Fix an existing footgun:** today `fusebase auth --dev` silently flips the
  global env under *all* projects on the machine, and `.env` MCP tokens go stale
  without warning. Per-backend auth + per-env `.env.<name>` + `env status`
  fingerprint check eliminate the class.
- **Dev-server safety:** `fusebase dev start` against a `protected` env warns
  (local dev against a clean customer org is almost always a mistake).
- **`fusebase.json` `env` field:** currently dead ("debug only") — deprecate in
  favor of `defaultEnvironment`.
- **Resource discovery helper:** `fusebase resources discover --env <name>` to
  fill `apps.<key>.resources` by name-matching dashboards/views (parent doc, open
  question 2); apps read resources via a generated `config/resources.ts` that
  consumes env-injected values (Workstream A3).
- **CI ergonomics:** `FUSEBASE_ENV` + `FUSEBASE_API_KEY` make any pipeline
  one-liner: `FUSEBASE_ENV=prod-test fusebase deploy --yes`.
- **Sentinel/test apps** (Workstream C) get their env matrix for free: the same
  repo carries `environments/{dev,prod-test}.json` and CI switches with a flag.

## 12. Open questions

1. App key in `environments/<name>.json` `apps{}` — manifest `subdomain` (current
   declarative key) vs a new explicit `key` field on `apps[]`? Subdomain-as-key
   breaks if the default subdomain itself differs per env; an explicit optional
   `key` (defaults to subdomain) is safer. Leaning explicit optional `key`.
2. Should `env use` auto-refresh `.env.<name>` tokens (network call) or only
   offer? Leaning offer-in-TTY / flag `--tokens` for scripts.
3. `.env` compatibility for app backends that read `FBS_*`/`FUSEBASE_HOST` from
   the project `.env` during `dev start` — inject from `.env.<active>` into the
   spawned process instead of relying on the file name?
4. Does `productId` belong per-environment (current design) or can one product
   span backends? (It cannot — products are per-backend entities; per-env it is.)
5. Store the active env in `.fusebase/state.json` vs reuse the existing
   `logs/`-style app dir? New dot-dir keeps project root clean and gives a home
   for future per-checkout state (dev-server ports, caches).
