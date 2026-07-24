# App Environment Migration Guide

This guide is a practical checklist for migrating an existing Fusebase App
project to named environments when the CLI feature flags are already enabled.
It complements the App Environments Guide, which documents the commands and
runtime model.

## Local CLI Entrypoints

When working inside a generated app, use the local agent assets shipped by the
CLI:

- Skill `fusebase-cli` for command behavior, environment commands, deploy
  reconciliation, and manifest rules.
- Skill `app-e2e-tests` for environment-aware Playwright tests and CI layout.
- Skill `app-backend` when the app has a backend or reads `process.env`.
- Skill `fusebase-gate` when runtime code calls Gate APIs, manages org access,
  magic links, isolated stores, email, files, automations, or cross-platform
  services.
- Project guide "App Environments Guide" for the environment model.
- Project guide "App Environment Migration Guide" for this migration checklist.
- Project guide "E2E Playwright Setup Guide" for adding the Playwright
  scaffold and GitLab CI.

Do not rely on source-repository links from generated app code. A user with a
locally installed CLI should be able to find the same guidance by skill name or
guide title.

## Target State

After migration:

- `fusebase.json` is environment-neutral: app records use stable keys,
  `subdomain`, `name`, and `path`; platform ids are not authored there.
- `environments/<name>.json` is committed and owns backend, org, product, app
  ids, per-env subdomains, store ids, fixtures, and the `protected` marker.
- `.env.<name>` is gitignored and owns tokens and secrets for that environment.
- `.env` is generated from the active `.env.<name>`.
- Runtime code resolves backend/org/app context from deployed env metadata,
  request host, or platform-provided env vars, not from hardcoded prod values.
- Tests can run the same readonly smoke suite against at least one environment
  and fail fast when pointed at the wrong deployment.

## 1. Inspect Before Changing

Read the project shape first:

```bash
fusebase env status || true
find . -maxdepth 3 -name fusebase.json -o -name package.json
rg -n "orgId|productId|storeId|thefusebase|dev-thefusebase|FUSEBASE_|FBS_|GATE_|DASHBOARDS_|APP_SESSION|magiclink|createAppMagicLink|isolated|callAppApi|webhook|cron|email|file|upload" .
```

Classify the app before migration:

- Single app or multi-app product.
- Frontend-only, backend-enabled, backend-only, sidecar, cron, or webhook app.
- Uses dashboards only, Gate APIs, isolated SQL/NoSQL stores, files, email,
  magic links, cross-app API calls, or custom domains.
- Has tests already, manual QA only, or no verification.
- Current production org and app access model.

Keep live infrastructure readonly while inspecting. Do not run commands that
create, update, apply migrations, change app access, or deploy until the user
explicitly agrees to that mutation.

## 2. Normalize the Manifest

Give every app a stable key and declarative identity:

```json
{
  "key": "benchmarking",
  "subdomain": "benchmarking",
  "name": "Benchmarking",
  "path": "apps/benchmarking"
}
```

Rules:

- Keep `key` stable across environments; use it in scripts, tests, and CI.
- Keep `subdomain` and `name` in `fusebase.json` as defaults.
- Do not invent or hand-write `apps[].id`.
- Do not copy platform ids between environments.
- Keep app permissions and declarative backend/build/dev config in
  `fusebase.json`; they describe the app, not a stage.
- Move product/app/store ids into env lockfiles with CLI commands, not manual
  edits when possible.

Adopt the current deployed context as the first environment:

```bash
fusebase env init --name prod --strip
```

Use a different first name if the current context is not production. Mark real
production-like environments as protected in the env file:

```json
{
  "protected": true
}
```

Then inspect:

```bash
fusebase env status --env prod
git diff -- fusebase.json environments/prod.json .gitignore
```

## 3. Add the First Non-Prod Environment

For a dev backend/org:

```bash
fusebase env add dev --backend dev --org <devOrgId>
fusebase env use dev
```

If the environment should exist on the platform before code upload, bootstrap
only the product and app bindings:

```bash
fusebase deploy --env dev --nocode
fusebase env status --env dev
```

For same-backend staging or beta environments, avoid subdomain collisions:

```bash
fusebase env clone prod prod-beta --org <orgId> --subdomain-suffix "-beta"
```

Refresh tokens after the product exists:

```bash
fusebase env tokens --env dev
```

Never commit `.env`, `.env.dev`, `.env.prod`, tokens, passwords, or traces.

## 4. Fix Env-Unsafe Runtime Code

The most common migration failure is a bundle deployed to one environment
while code still calls another backend or org.

Frontend rules:

- Prefer same-origin `/api/*` or platform proxy paths.
- Do not use `VITE_FUSEBASE_HOST`, `VITE_FUSEBASE_ORG_ID`, or app ids as the
  primary runtime context.
- Read deployed env metadata first: synchronous `window.__FUSEBASE_ENV__`
  when available, then `/fusebase-env.json`.
- Use `getMe` for the current user identity only; do not let it override
  deploy-time `orgId` or `appId`.
- Render a shell or scoped error when auth fails; do not block the whole app
  on a cross-backend `getMe` failure.

Backend rules:

- Prefer platform-provided env vars such as `FBS_ORG_ID` and
  `FBS_FEATURE_TOKEN`.
- Derive Gate/Dashboards host from the incoming app host when a request-scoped
  absolute host is required:
  `*.dev-thefusebase-app.com` maps to the dev backend,
  `*.thefusebase.app` maps to prod.
- Allow explicit host overrides only as operational escape hatches, not as the
  default path.
- Do not hardcode prod org ids, product ids, app ids, or Gate hosts.
- Do not create app secrets for public platform identifiers such as org ids,
  product ids, app subdomains, store ids, or Fusebase hosts.

Search patterns that usually need review:

```bash
rg -n "app-api\\.thefusebase|api\\.thefusebase|thefusebase\\.app|dev-thefusebase|orgId|productId|storeId|FUSEBASE_HOST|FUSEBASE_APP_HOST|VITE_FUSEBASE|FBS_ORG_ID|FBS_FEATURE_TOKEN" apps
```

## 5. Special Cases

Multi-app products:

- Add a stable `key` for every app.
- Put per-app env overrides under `environments/<name>.json` `apps.<key>`.
- Tests should create one Playwright project per app key.
- Cross-app flows belong in integration specs, not in a single app project.

Isolated stores:

- Keep aliases and permissions in the manifest.
- Let deploy/reconcile write actual store ids into env lockfiles.
- Runtime code should resolve stores through Gate/app scope by alias or
  platform binding.
- Do not put `storeId` into app runtime secrets.

Backend-only permissions:

- Keep `isolated_store.*`, `gate.*`, `app_api.*`, and other app permissions
  declarative.
- After permission changes, use the normal app update/deploy path for the
  selected environment.
- Verify with readonly checks before running write tests.

Magic links and access:

- Do not run magic-link tests against production unless explicitly approved.
- Before the first magic-link test run, ensure app access principals are
  explicit; creating links can change access semantics if the list was empty.
- Use app-owned backend exchange routes for durable app sessions when the app
  requires them.

Email, files, automations, cron, webhooks, and sidecars:

- Treat external provider credentials as per-env secrets in `.env.<name>` or
  platform secrets.
- Treat callback URLs, public app URLs, and webhook origins as env-specific.
- Keep readonly smoke tests separate from mutation tests.

Custom domains:

- Record the environment's effective app URL from `fusebase env status`.
- Do not infer backend only from a custom domain unless the platform also
  provides env metadata or a trusted server env var.

## 6. Add Minimal Readonly E2E Tests

For an app whose only available environment is production, start with readonly
smoke tests only:

```bash
fusebase scaffold --template e2e --dir tests/e2e
cd tests/e2e
npm install
FUSEBASE_ENV=prod npm test
```

Minimum suite:

- Fetch `/fusebase-env.json` and assert `env`, `backend`, `orgId`, and app key.
- Open the app in UI mode and assert it does not show a generic blank page or
  wrong-env error.
- If auth is required, assert the expected access-denied or login state rather
  than creating data.
- If an env panel is enabled for staff, assert `data-testid="fbs-env-panel"`
  and the active env name.

Only add write-path tests after a dedicated dev or prod-test environment and
fixtures exist.

For full setup instructions, including GitLab CI and environment target
selection, use the local guide **E2E Playwright Setup Guide**.

## 7. Wire CI

Use the e2e scaffold templates:

- Copy `tests/e2e/ci/gitlab-e2e.yml` into the root `.gitlab-ci.yml` include or
  job.
- For GitHub, copy `tests/e2e/ci/github-e2e.yml` into
  `.github/workflows/e2e.yml`.

CI contract:

```bash
FUSEBASE_ENV=<env> npm test --prefix tests/e2e
```

CI variables:

- `FUSEBASE_API_KEY` for the selected backend.
- Plain secrets like `PW_USER_CLIENT_PASSWORD` or env-suffixed variants such
  as `PW_USER_CLIENT_PASSWORD_DEV`.
- `GATE_MCP_TOKEN` only when tests need readonly API probes.

Keep protected environments manual or scheduled until the suite is proven
readonly.

## 8. Verification Checklist

Run local checks that match the app:

```bash
fusebase env list
fusebase env status --env prod
fusebase env status --env dev
npm test
npm run typecheck
FUSEBASE_ENV=dev npm test --prefix tests/e2e
FUSEBASE_ENV=prod npm test --prefix tests/e2e
```

Skip unavailable scripts rather than inventing replacements. Report exactly
which checks passed, which were skipped, and why.

Before deploy:

- `git diff` shows no secrets.
- `fusebase.json` has no env-specific app ids introduced by hand.
- Env lockfiles contain only ids for their own backend/org.
- Runtime host/org resolution is multi-env safe.
- CI has at least a readonly smoke job.

## 9. Final Handoff

Summarize:

- Environments created or adopted.
- Manifest changes.
- Runtime hardcoding removed.
- Tests and CI added.
- Commands run and results.
- Remaining manual operations, especially deploys, permission updates, or
  secrets that require human approval.
