# E2E tests (environment- and app-aware)

Playwright suite that runs the **same specs against any environment** of this
project (dev, prod-test, …) and **splits by app**. Environments are managed by
`fusebase env` (see the CLI's App Environments guide).

## Run

```bash
cd tests/e2e
npm install && npx playwright install chromium   # first time

FUSEBASE_ENV=dev npm test                 # all apps against dev
FUSEBASE_ENV=prod-test npm test           # same specs against prod-test
FUSEBASE_ENV=dev npx playwright test --project=<appKey>   # one app
npm test                                  # active env (fusebase env use)
```

Reports land in `reports/<env>.json` (machine-readable, one per environment)
and `reports/<env>-html/`.

## Layout — one Playwright project per app

```
specs/
  common/          # universal specs — run for EVERY app (stage guard,
                   #   env contract, anonymous session flow)
  <appKey>/        # that app's own specs (create one folder per app)
examples/          # opt-in recipes (not executed)
```

`playwright.config.ts` reads `fusebase.json` and generates **one project per
app** (`name` = the app's key), each pinned to that app's env-effective URL.
A project runs `specs/common/**` + `specs/<appKey>/**`. The common specs are
app-aware via the project name (`test.info().project.name`).

- **App key** = `fusebase.json` `apps[].key` (falls back to `subdomain`).
  Give apps a short `key` (e.g. `probe`) so spec folders and `--project` names
  stay clean while subdomains stay long.
- **`specs/common/stage.spec.ts` is the stage guard** — it asserts each app's
  deployed `fusebase-env.json` matches the target env and app before anything
  else. Keep it.

### Adding an app

1. Give the app a `key` in `fusebase.json` (once).
2. `mkdir specs/<key>` and put its specs there.
3. Add the key to the CI matrix `APP` list (`ci/*.yml`).

## Optional recipes (`examples/`)

`examples/` is NOT executed — copy-when-needed patterns. Today:
`role-matrix.spec.ts` — passwordless per-role sign-in via platform magic
links (fixture-driven, self-skipping). Copy it into `specs/<appKey>/` only if
that app has role-differentiated access worth testing.

## Fixtures (test users)

| What | Where | Committed |
|------|-------|-----------|
| identities (email, role, key) | `environments/<name>.json` → `fixtures.testUsers` | yes |
| passwords | `.env.<name>` → `PW_USER_<KEY>_PASSWORD` | **no** (CI variables) |

Cases self-skip when a fixture is missing for the target env — roll fixtures
out per environment without breaking runs.

## Authoring rules (human or AI)

1. One behavior per test; assert **role-differential** outcomes (what this
   role must AND must not see).
2. No hardcoded hosts, org/app ids, or credentials — only `helpers/env.ts`.
3. Tests must clean up data they create (prod-test runs against a real org).
4. A failing test should print enough to triage: prefer response bodies and
   `x-request-id` over screenshots alone.
5. Never commit secrets; traces/reports are gitignored.

## CI

Any runner works — the per-cell contract is:

```bash
FUSEBASE_ENV=<env> npx playwright test --project=<app>   # exit code + reports/<env>.json
```

Ready-made templates in `ci/` split by **environment × app** (each cell is one
parallel job, own report artifact):

- **GitLab CI** — copy the job from `ci/gitlab-e2e.yml` into your root
  `.gitlab-ci.yml` (`parallel:matrix` over `FUSEBASE_ENV` × `APP`, node_modules
  cache, playwright image, schedules for prod-test smoke).
- **GitHub Actions** — copy `ci/github-e2e.yml` to `.github/workflows/e2e.yml`.

Add an app = one line in the matrix `APP` list.

Secrets in CI (no dotenv files there): the harness falls back from
`.env.<name>` to process env — plain key or env-suffixed for matrices
(`GATE_MCP_TOKEN_DEV`, `GATE_MCP_TOKEN_PROD_TEST`,
`PW_USER_CLIENT_PASSWORD_PROD_TEST`, …). Mint gate tokens with
`fusebase env tokens --env <name>` and copy the value from `.env.<name>` into
the CI variable. Magic-link sign-in needs no passwords at all.

Keep protected (production) environments on schedules/manual runs, not on
every merge request. (Central publishing of `reports/<env>.json` to the
platform registry — coming as `fusebase test publish`.)
