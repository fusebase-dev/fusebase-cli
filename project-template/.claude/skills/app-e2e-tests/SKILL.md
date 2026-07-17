---
name: app-e2e-tests
description: Author and run environment-aware Playwright e2e tests for this Fusebase project. Use when: 1. Adding or scaffolding e2e tests (fusebase scaffold --template e2e), 2. Converting a manually verified scenario into a Playwright spec, 3. Running the same test set against dev and prod environments, 4. Wiring test users/fixtures per environment.
---

# App E2E tests (environment-aware)

One suite in `tests/e2e/`, same specs against every environment of the
project. Environments (`fusebase env`) supply everything varying between
stages: base URLs, org/app ids, test users.

## Scaffold

```bash
fusebase scaffold --template e2e --dir tests/e2e
cd tests/e2e && npx playwright install chromium
FUSEBASE_ENV=<env> npm test
```

## Non-negotiables

1. **Stage guard stays.** `specs/stage.spec.ts` asserts the deployed bundle's
   `fusebase-env.json` matches the target env. Never delete or reorder it away
   — a run against the wrong stage is worse than no run.
2. **No hardcoded env data.** Hosts, org/app ids, credentials come only from
   `helpers/env.ts` (`environments/<name>.json` + `.env.<name>`). A spec that
   embeds a URL or id will silently break on the other environment.
3. **Fixtures self-skip.** Use the `fixtureUser(env, key)` + `test.skip`
   pattern (see `examples/role-matrix.spec.ts`) so specs stay runnable while
   fixtures roll out per env.
4. **Cleanup.** Tests that create data must delete it — prod-test environments
   are real orgs.
5. **No secrets in git.** Passwords via `PW_USER_<KEY>_PASSWORD` in
   `.env.<name>` locally / CI variables in pipelines. Reports and traces are
   gitignored.

## Converting a manual QA scenario into a spec

When the user (or QA) describes a manually verified scenario:

1. Identify the **role** it runs under → fixture key (add the identity to
   `environments/<name>.json` `fixtures.testUsers` if missing; ask the human
   to set the password secret — never invent or commit one).
2. Write one spec per behavior; assert **role-differential** outcomes: what
   this role must see AND what it must not (403/absence assertions catch the
   platform's fail-open regressions, which are the expensive ones).
3. Prefer stable selectors: `data-testid` in app code (add them when missing)
   over text/CSS. The env panel exposes `fbs-env-panel*` test ids.
4. On failure, surface triage data: response status + body and the
   `x-request-id` header in the assertion message where relevant.
5. Run against dev first, then the prod-test env:
   `FUSEBASE_ENV=dev npm test && FUSEBASE_ENV=prod-test npm test`.

## Reports / CI

`reports/<env>.json` is the machine-readable result per environment — the
contract for any CI (GitLab CI, GitHub Actions: run `FUSEBASE_ENV=<env> npm
test`, keep the JSON as artifact). Central publishing to the platform registry
is planned as `fusebase test publish`.
