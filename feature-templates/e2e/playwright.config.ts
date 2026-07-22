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
 * Run everything (all apps, one environment):   FUSEBASE_ENV=dev npm test
 * Run a single app:                             npx playwright test --project=<appKey>
 * CI splits by environment × app (see ci/).
 */
const env = resolveTargetEnvironment();
const appKeys = listAppKeys(env.projectRoot);

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
  projects: appKeys.map((appKey) => ({
    name: appKey,
    testDir: "./specs",
    testMatch: [`common/**/*.spec.ts`, `${appKey}/**/*.spec.ts`],
    use: { baseURL: appBaseUrl(env, appKey), ...sharedUse },
  })),
  metadata: {
    fusebaseEnv: env.name,
    backend: env.config.backend,
    orgId: env.config.orgId,
  },
});
