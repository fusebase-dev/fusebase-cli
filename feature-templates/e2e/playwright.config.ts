import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import {
  appBaseUrl,
  listAppKeys,
  resolveTargetEnvironment,
} from "./helpers/env";

/**
 * Environment- AND app-aware Playwright config.
 *
 * The target environment is resolved once (FUSEBASE_ENV > active env > single
 * env). One PROJECT is generated per app declared in fusebase.json — each
 * pinned to that app's env-effective URL. Every project runs:
 *   - `specs/common/**`   universal checks, app-aware via the project name
 *   - `specs/<appKey>/**` that app's own specs
 *
 * Plus an optional `integration` project (present when `specs/integration/`
 * exists) for cross-app / portal flows that span MORE THAN ONE app — those
 * have no single baseURL, so their specs build per-app URLs via
 * `appBaseUrl(env, key)`.
 *
 * Run everything (all apps, one environment):   FUSEBASE_ENV=dev npm test
 * Run a single app:                             npx playwright test --project=<appKey>
 * Run cross-app flows:                          npx playwright test --project=integration
 * CI splits by environment × app (see ci/).
 */
const env = resolveTargetEnvironment();
const appKeys = listAppKeys(env.projectRoot);
const hasIntegration = existsSync(join(__dirname, "specs", "integration"));

const sharedUse = {
  trace: "retain-on-failure" as const,
  // App backends scale to zero (`backend.minReplicas` defaults to 0), so the
  // FIRST request after a deploy — which is exactly when this suite runs — or
  // after an idle period always pays a cold start (~10s). 30s is CloudFront's
  // origin-response ceiling: a value covering a single request must stay under
  // it, so 15s leaves room for the cold start without ever masking a real hang.
  actionTimeout: 15_000,
  // A navigation is a redirect chain (auth handoff), not one request — give it
  // the full platform ceiling.
  navigationTimeout: 30_000,
  // "New headless" (real Chrome) + hide the automation marker — the classic
  // headless shell and the visible marker trip the platform's bot heuristics
  // on session handoffs (magic-link activation loops on ERR_TOO_MANY_REDIRECTS).
  channel: "chromium",
  launchOptions: { args: ["--disable-blink-features=AutomationControlled"] },
};

export default defineConfig({
  fullyParallel: true,
  // Playwright's defaults (30s per test, 5s per expect) assume a warm target.
  // A cold backend eats most of a 5s expect on its own, so the first spec of a
  // run fails and then "passes on retry" — i.e. reads as flakiness when it is
  // really the cold start. Sized so the first request after a deploy passes
  // WITHOUT a retry.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Real platform (auth handoffs, magic-link activation) is legitimately
  // sensitive to concurrent auth-host traffic — retry once everywhere, twice
  // in CI. A genuine break fails all attempts; a flaky handoff recovers.
  retries: process.env.CI ? 2 : 1,
  reporter: [
    ["list"],
    ["json", { outputFile: `reports/${env.name}.json` }],
    ["html", { open: "never", outputFolder: `reports/${env.name}-html` }],
  ],
  projects: [
    ...appKeys.map((appKey) => ({
      name: appKey,
      testDir: "./specs",
      testMatch: [`common/**/*.spec.ts`, `${appKey}/**/*.spec.ts`],
      use: { baseURL: appBaseUrl(env, appKey), ...sharedUse },
    })),
    // Cross-app / portal flows span multiple apps → no fixed baseURL; specs
    // build per-app URLs via appBaseUrl(env, key). Only added when the folder
    // exists, so a single-app project stays clean.
    ...(hasIntegration
      ? [
          {
            name: "integration",
            testDir: "./specs",
            testMatch: [`integration/**/*.spec.ts`],
            use: { ...sharedUse },
          },
        ]
      : []),
  ],
  metadata: {
    fusebaseEnv: env.name,
    backend: env.config.backend,
    orgId: env.config.orgId,
  },
});
