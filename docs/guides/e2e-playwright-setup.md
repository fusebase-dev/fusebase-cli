# E2E Playwright Setup Guide

This guide is for AI agents and engineers adding the CLI-provided Playwright
e2e setup to an existing Fusebase App project, including GitLab CI.

Primary rule: inspect environments first. The target environment determines
whether tests are safe to run automatically, manually, or not at all.

## Local CLI Entrypoints

Use local guide and skill names that are available in generated projects:

- Skill `fusebase-cli` for `fusebase env`, `fusebase scaffold`, and deploy
  behavior.
- Skill `app-e2e-tests` for Playwright harness rules, fixture conventions, and
  CI details.
- Skill `app-backend` when tests hit app backend routes.
- Skill `fusebase-gate` when tests use Gate APIs, org access, magic links,
  isolated stores, files, email, or automations.
- Project guide "App Environments Guide" for the environment model.
- Project guide "App Environment Migration Guide" if the app is not yet
  environment-aware.
- Project guide "E2E Playwright Setup Guide" for this setup checklist.

## 1. Audit Environments First

Run from the project root:

```bash
fusebase env list
fusebase env status
find . -maxdepth 2 -type f -path "./environments/*.json" -print
```

Classify the result:

- **No `environments/` directory or env commands fail because envs are not
  adopted:** recommend migrating to named environments first. Use "App
  Environment Migration Guide" before adding CI. Do not create a CI job that
  depends on ambiguous legacy `.env` state.
- **Only `prod` exists:** warn that running tests against a production account
  can be unsafe, even for smoke tests, because auth, rate limits, access
  checks, emails, webhooks, and future test additions can touch real users or
  data. Recommend creating at least `dev` and preferably `prod-test` or
  `beta` before enabling automated CI. If the user still asks to proceed,
  add readonly tests only and make the prod CI job manual or scheduled.
- **`prod` plus non-prod envs exist:** configure tests for non-prod envs first
  (`dev`, `prod-test`, `beta`, or similar). Warn that prod should remain
  readonly and manual/scheduled unless explicitly approved.
- **No prod env, only non-prod envs:** set up tests on the available non-prod
  envs and record that production coverage is not configured.

Suggested target priority:

1. `dev` for fast integration smoke.
2. `prod-test` or `beta` for production-platform smoke in a safe org.
3. `prod` only for readonly manual/scheduled smoke after explicit approval.

Do not run mutating tests against live environments without explicit approval.

## 2. Scaffold the E2E Suite

From the project root:

```bash
fusebase scaffold --template e2e --dir tests/e2e
```

The scaffold copies the Playwright harness and runs `npm install` in
`tests/e2e`. Then install the browser once locally:

```bash
cd tests/e2e
npx playwright install chromium
```

If `tests/e2e` already exists, inspect it first. Do not overwrite existing
tests; merge the CLI template patterns manually or ask before replacing files.

## 3. Confirm App Keys

The Playwright config creates one project per app in `fusebase.json`.
Give every app a stable, short `key`:

```json
{
  "key": "client",
  "subdomain": "client-portal",
  "name": "Client Portal",
  "path": "apps/client-portal"
}
```

Use this key for:

- `tests/e2e/specs/<appKey>/`
- `npx playwright test --project=<appKey>`
- GitLab CI matrix variable `APP`

For cross-app or portal flows, create `tests/e2e/specs/integration/` and add
`integration` to the CI `APP` matrix.

## 4. Keep the First Suite Readonly

Start with the scaffold's common stage guard and add only safe smoke checks:

- Fetch or open the app and verify it is not blank.
- Assert `/fusebase-env.json` matches the selected `FUSEBASE_ENV`, backend,
  org, and app key.
- Assert expected unauthenticated, login, or access-denied states.
- If staff env panel is enabled, assert `data-testid="fbs-env-panel"` and the
  active env name.
- Avoid creating rows, sending emails, creating magic links, uploading files,
  applying migrations, registering users, or changing access.

Only add write-path tests after a dedicated non-prod env and cleanup strategy
exist.

## 5. Run Locally Per Environment

Run non-prod first:

```bash
cd tests/e2e
FUSEBASE_ENV=dev npm test
FUSEBASE_ENV=prod-test npm test
```

Run one app:

```bash
FUSEBASE_ENV=dev npx playwright test --project=<appKey>
```

If only `prod` exists and the user approved readonly smoke:

```bash
FUSEBASE_ENV=prod npm test
```

In the final report, explicitly say that prod coverage is readonly and should
not be expanded without a dedicated `dev`, `prod-test`, or `beta` environment.

## 6. Fixtures and Secrets

Committed fixture identities live in env lockfiles:

```jsonc
// environments/dev.json
"fixtures": {
  "testUsers": [
    { "key": "client", "email": "qa-client@example.com", "role": "client" }
  ]
}
```

Secrets stay outside git:

```bash
# .env.dev
PW_USER_CLIENT_PASSWORD=...
```

CI may use either plain or env-suffixed variable names:

- `PW_USER_CLIENT_PASSWORD`
- `PW_USER_CLIENT_PASSWORD_DEV`
- `PW_USER_CLIENT_PASSWORD_PROD_TEST`
- `GATE_MCP_TOKEN_DEV`
- `GATE_MCP_TOKEN_PROD_TEST`

Magic-link tests should normally run only on non-prod envs. They can mutate
app access semantics if access principals are not explicitly pinned first.

## 7. Add GitLab CI

Copy the template from the scaffold:

```bash
cp tests/e2e/ci/gitlab-e2e.yml .gitlab-ci.yml
```

If a root `.gitlab-ci.yml` already exists, include the local template or merge
the `e2e` job manually:

```yaml
include:
  - local: tests/e2e/ci/gitlab-e2e.yml
```

Set the matrix to non-prod envs by default:

```yaml
parallel:
  matrix:
    - FUSEBASE_ENV: ["dev"]
      APP: ["client"]
    - FUSEBASE_ENV: ["prod-test"]
      APP: ["client"]
```

For prod, keep it manual or scheduled and readonly:

```yaml
    # - FUSEBASE_ENV: ["prod"]
    #   APP: ["client"]
    #   # Enable only for readonly smoke on schedule/manual.
```

Required GitLab CI variables:

- `FUSEBASE_API_KEY` for the target backend when tests need CLI/API access.
- `GATE_MCP_TOKEN_<ENV>` when tests need readonly Gate probes.
- `PW_USER_<KEY>_PASSWORD[_<ENV>]` for password-based fixtures.

Use masked variables. Use protected variables only if the job runs on protected
branches/tags or schedules that have access to them.

## 8. CI Rules

Recommended policy:

- Merge requests: run `dev` only.
- Default branch: run `dev`; optionally run `prod-test` or `beta`.
- Schedule: run broader non-prod smoke.
- Prod: manual or scheduled only, readonly only, and only after explicit human
  approval.

Never silently add `prod` to an always-on merge-request matrix.

## 9. Verification Checklist

Before handoff:

```bash
fusebase env list
fusebase env status --env <non-prod>
npm test --prefix tests/e2e
FUSEBASE_ENV=<non-prod> npm test --prefix tests/e2e
```

Also verify:

- `tests/e2e/package-lock.json` exists.
- `tests/e2e/ci/gitlab-e2e.yml` exists.
- Root `.gitlab-ci.yml` exists or includes the e2e template.
- CI matrix uses app keys from `fusebase.json`.
- Reports and traces are gitignored.
- No secrets were committed.
- Prod is absent from automatic MR jobs unless the user explicitly approved a
  readonly prod smoke policy.

## 10. Final Handoff

Report:

- Which environments exist.
- Which environments tests were configured for.
- Whether prod was excluded, manual-only, or not configured.
- Which app keys are in the Playwright and GitLab matrices.
- Commands run and results.
- Any missing envs, fixtures, passwords, or CI variables the user must create.
