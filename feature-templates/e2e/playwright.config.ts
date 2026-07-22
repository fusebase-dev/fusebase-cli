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
  // "New headless" (real Chrome) + hide the automation marker — the classic
  // headless shell and the visible marker trip the platform's bot heuristics
  // on session handoffs (magic-link activation loops on ERR_TOO_MANY_REDIRECTS).
  channel: "chromium",
  launchOptions: { args: ["--disable-blink-features=AutomationControlled"] },
};

export default defineConfig({
  fullyParallel: true,
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
