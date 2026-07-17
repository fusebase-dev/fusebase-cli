# E2E tests (environment-aware)

Playwright suite that runs the **same specs against any environment** of this
project (dev, prod-test, …). Environments are managed by `fusebase env`
(see the CLI's App Environments guide).

## Run

```bash
cd tests/e2e
npm install && npx playwright install chromium   # first time

FUSEBASE_ENV=dev npm test          # target the dev environment
FUSEBASE_ENV=prod-test npm test    # same specs against prod-test
npm test                           # active env (fusebase env use) / single env
```

Reports land in `reports/<env>.json` (machine-readable, one per environment)
and `reports/<env>-html/`.

## How targeting works

- `helpers/env.ts` resolves the target env (`FUSEBASE_ENV` > active env >
  single env) and reads `environments/<name>.json` + `.env.<name>`.
- `use.baseURL` is the app's env-effective URL — specs use relative paths.
- **`specs/stage.spec.ts` is the stage guard**: it asserts the deployed
  bundle's `fusebase-env.json` matches the target env before anything else.
  Keep it; never delete it.

## Optional recipes (`examples/`)

`examples/` is NOT executed — it holds copy-when-needed patterns. Today:
`role-matrix.spec.ts` — passwordless per-role sign-in via platform magic
links (fixture-driven, self-skipping). Copy it into `specs/` only if your app
has role-differentiated access worth testing; a public or single-role app
doesn't need it.

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

Any runner works — the contract is just:

```bash
FUSEBASE_ENV=<env> npm test   # exit code + reports/<env>.json
```

Wire it as a GitLab CI job or GitHub Actions workflow with `FUSEBASE_ENV` as
the matrix axis and `PW_USER_*` as CI secrets. (Central publishing of
`reports/<env>.json` to the platform registry — coming as `fusebase test
publish`.)
