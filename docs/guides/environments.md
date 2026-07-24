# App Environments — User Guide

One project, several platform contexts: `prod` (customer org), `prod-beta`
(beta stage on the prod platform), `dev` (org on the dev platform). Each
environment owns its platform ids; the code tree stays shared.

Experimental — enable once per machine:

```bash
fusebase config set-flag environments
```

(Declarative deploy reconcile — binding/creating products and apps and
filling the env lockfile — is default CLI behavior.)

Design rationale: [APP-ENVIRONMENTS.md](../proposals/APP-ENVIRONMENTS.md).
Migrating an existing app? Use
[App Environment Migration Guide](environment-migration.md) as the conversion
checklist.
Adding tests? Use
[E2E Playwright Setup Guide](e2e-playwright-setup.md) to choose safe env
targets and wire CI.

---

## Mental model

- **An environment is a named profile**, stored in `environments/<name>.json`
  (committed): which `backend` (dev/prod platform), which `orgId`/`productId`,
  resolved app `id`s, per-env `subdomain`s, isolated-store ids, test-user
  fixtures, `protected` marker.
- **`fusebase.json` stays env-neutral** — apps are declared by
  `subdomain`/`name`/`path`, without platform ids. The CLI overlays the active
  environment on top of it at read time.
- **Ids never travel between environments.** Each env's ids are resolved by
  deploy reconcile and recorded in that env's file only. Never copy an id
  from one env file to another.
- **A deployed bundle IS an environment.** Switching stages in a browser is
  navigation between deployments, not a runtime toggle.
- **Backend ≠ environment.** Several environments can share one backend
  (prod + prod-beta). Subdomains are globally unique per backend, so same-backend
  environments need per-app `subdomain` overrides or an env-wide
  `subdomainSuffix`.

## Files

| File | Committed | Contents |
|------|-----------|----------|
| `fusebase.json` | yes | env-neutral app declarations (`subdomain`, `name`, `path`, `dev`/`build`, store aliases, optional `key`) |
| `environments/<name>.json` | yes | the env lockfile: backend, org, product, resolved ids, subdomain overrides, `fixtures`, `protected` |
| `.env.<name>` | **no** (gitignored) | MCP tokens + secrets for that env (e.g. `PW_USER_<KEY>_PASSWORD` for tests) |
| `.env` | **no** | materialized copy of the **active** env's `.env.<name>` — the single file IDE configs, the dev server, and app code keep reading |
| `.fusebase/state.json` | **no** | per-checkout active environment |

## Getting started

### Adopt an existing project

```bash
cd my-project
fusebase env init --strip
```

The current `fusebase.json` context (org, product, app ids, store ids) becomes
the first environment, named after the current backend (`prod` or `dev`;
override with `--name`). `--strip` moves the ids out of `fusebase.json` into
the lockfile (recommended; without it the leftover ids are harmless — the env
file wins). Your `.env` is copied to `.env.<name>` and stays materialized.

### Add a second environment

```bash
# Interactive (recommended when you don't know the org id): prompts for
# backend, organization (picked from the live org list of that backend),
# name, subdomain suffix, and the protected marker:
fusebase env add

# Fully non-interactive:
fusebase env add dev --backend dev --org <devOrgId>

# Or copy the structure of an existing one (ids cleared automatically):
fusebase env clone prod prod-beta --org <orgId> --subdomain-suffix "-beta"
```

Any option you pass skips its prompt; in non-TTY (CI) `<name>`, `--backend`,
and `--org` are required. The dev/prod backend question is internal-only:
without the `dev-backend` flag the interactive flow silently targets **prod**
(customers only ever deploy there); enable the prompt with
`fusebase config set-flag dev-backend`, or pass `--backend dev` explicitly —
that always works. The environment file is just written — no platform
calls (except listing orgs for the interactive picker). Mark production-like
envs with `--protected` (mutating commands will print a banner and ask for
confirmation).

### Bootstrap it on the platform

```bash
fusebase env use dev
fusebase deploy --nocode      # or: fusebase deploy --env dev --nocode
```

The first deploy of a fresh environment creates the **product** in that org
(named after the project folder), binds or creates each app under its
env-effective subdomain, and writes the resolved ids back into
`environments/dev.json`. `--nocode` stops there (infrastructure only); a full
`fusebase deploy` also builds and uploads the code.

```bash
fusebase env tokens           # MCP tokens for the active env → .env.dev (+ .env)
```

## Day-to-day commands

```bash
fusebase env list                      # environments: backend, org, auth state, active marker
fusebase env status [--env <name>]     # org/product, auth, per-app id resolution, token freshness
fusebase env use <name> [--tokens]     # switch this checkout's active env
fusebase deploy [--env <name>]         # deploy to the active (or named) env
fusebase dev start [--env <name>]      # dev server against the active (or named) env
fusebase env tokens [--env <name>]     # refresh MCP tokens for an env
fusebase env remove <name> [--yes]     # delete local env files (lockfile + .env.<name>);
                                       # platform product/apps are NOT deleted
fusebase env strip [--into <name>]     # move leftover ids (apps[].id, storeId) from
                                       # fusebase.json into an env lockfile (for projects
                                       # adopted without `env init --strip`)
```

Selection precedence for every command:

```
--env <name>  >  FUSEBASE_ENV  >  fusebase env use (state)  >
fusebase.json "defaultEnvironment"  >  the only env (auto-pick)
```

Without an `environments/` directory the CLI behaves exactly as before
(legacy single-env mode) — old projects are untouched until you run
`env init`.

## Authentication (per backend)

Keys are stored per backend in `~/.fusebase/config.json` → `auth.dev` /
`auth.prod`:

```bash
fusebase auth          # binds a key to prod
fusebase auth --dev    # binds a key to dev
```

Run each once — commands pick the key matching the target env's backend.
`fusebase env use` offers the auth flow when the backend has no key;
`env list`/`env status` show per-backend auth state. If you see
`auth legacy-key`, run the matching `fusebase auth [--dev]` once to bind the
key to its backend explicitly.

CI: `FUSEBASE_API_KEY` overrides everything —
`FUSEBASE_ENV=prod-test FUSEBASE_API_KEY=$KEY fusebase deploy --nocode`.

## The in-app environment panel

Every env-mode deploy bakes **`fusebase-env.json`** into the bundle: env name,
backend, org/product/app ids, effective subdomain, and links to the same
app's deployments in other environments (`counterparts`). The SPA template
ships a floating **EnvPanel** that renders it:

- open the app with **`?envpanel=1`** (persists in localStorage; `?envpanel=0`
  turns it off);
- red **PROD** badge on `protected` environments;
- counterpart links navigate to the sibling deployment (same org on
  `*.thefusebase.app` shares the session; a different org requires sign-in);
- the panel renders even while the app is still authenticating — that is
  exactly when you need to know which stage you are on;
- stable test ids (`data-testid="fbs-env-panel"`, `…-name`, `…-app-id`) let
  Playwright suites assert they run against the intended stage.

Keep it staff-only: gate rendering behind your app's role check before
exposing it in client-facing apps.

## Test fixtures

Committable identities live in the env file, secrets in the dotenv:

```jsonc
// environments/prod-test.json
"fixtures": {
  "testUsers": [
    { "key": "owner",  "email": "qa-owner@…",  "role": "owner" },
    { "key": "client", "email": "qa-client@…", "role": "client" }
  ]
}
```

```bash
# .env.prod-test (gitignored)
PW_USER_OWNER_PASSWORD=…
PW_USER_CLIENT_PASSWORD=…
```

Test runners read both: same case set on every environment by construction.

## Gotchas

- **Hash-skip vs env metadata.** The frontend hash is computed from sources,
  so redeploying the *same* code to another env can report "no changes" and
  skip the upload. The env's bundle keeps the `fusebase-env.json` from its
  last real upload; after changing env files (e.g. new counterpart) refresh
  with `fusebase deploy --env <name> --force`.
- **Same-backend environments collide on subdomains** unless you set
  `subdomainSuffix` or per-app `subdomain` overrides in the env file
  (`env clone --subdomain-suffix` does it for you).
- **`env tokens` needs a product.** A fresh env has no `productId` until the
  first `deploy --nocode` bootstraps it — the error message tells you so.
- **Don't hand-edit resolved ids.** `id`/`productId`/store ids in env files
  are written by reconcile; hand-authoring them causes double registration.
- **After `fusebase auth --dev` prod kept working?** It should: the first
  auth to a new backend preserves the previously stored key into its own
  slot. If a prod command ever fails with `401 API key not recognized`, run
  `fusebase auth` (prod) once and check `fusebase env list` auth column.
- **`.env` is generated.** With environments enabled, edit `.env.<name>`,
  not `.env` — the header comment in `.env` says which file it came from.
- **Don't bake hosts into the frontend.** `deploy --env <name>` injects that
  env's `.env.<name>` values into the build process, but app code should not
  rely on build-time hosts at all — resolve at runtime (same-origin paths,
  `window.location.hostname`, or `fusebase-env.json` `backend`). A baked
  wrong-backend host shows up as `getMe` failing with status 0 (network/CORS).

## Quick reference

| Task | Command |
|------|---------|
| Enable feature | `fusebase config set-flag environments` |
| Adopt project | `fusebase env init --strip` |
| New env | `fusebase env add` (interactive) or `fusebase env add <name> --backend <dev\|prod> --org <orgId>` |
| Copy env | `fusebase env clone <from> <to> --org <orgId> [--subdomain-suffix <s>]` |
| Switch | `fusebase env use <name>` |
| Inspect | `fusebase env list` / `fusebase env status` |
| Bootstrap on platform | `fusebase deploy --env <name> --nocode` |
| Deploy | `fusebase deploy [--env <name>]` |
| Tokens | `fusebase env tokens [--env <name>]` |
| Remove (local files only) | `fusebase env remove <name>` (`--yes` for CI) |
| Auth per backend | `fusebase auth` / `fusebase auth --dev` |
| CI | `FUSEBASE_ENV=<name> FUSEBASE_API_KEY=<key> fusebase deploy` |
