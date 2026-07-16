import { defineConfig } from "@playwright/test";
import { appBaseUrl, resolveTargetEnvironment } from "./helpers/env";

/**
 * Environment-aware Playwright config. The target env is resolved once here
 * (FUSEBASE_ENV > active env > single env) and exposed to specs via
 * `use.baseURL` and the JSON report name. Same specs, any environment:
 *
 *   FUSEBASE_ENV=dev npm test
 *   FUSEBASE_ENV=prod-test npm test
 */
const env = resolveTargetEnvironment();

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // Normalized JSON report per environment — the artifact CI publishes
  // (and, later, `fusebase test publish` pushes to the central registry).
  reporter: [
    ["list"],
    ["json", { outputFile: `reports/${env.name}.json` }],
    ["html", { open: "never", outputFolder: `reports/${env.name}-html` }],
  ],
  use: {
    baseURL: appBaseUrl(env),
    trace: "retain-on-failure",
    // "New headless" (real Chrome binary) — the classic headless shell trips
    // the platform's bot heuristics on session handoffs (magic-link
    // activation loops on ERR_TOO_MANY_REDIRECTS). The prod auth host is
    // stricter still — hide the automation marker as well; if a session
    // handoff spec keeps looping locally, verify with `npm run test:headed`.
    channel: "chromium",
    launchOptions: {
      args: ["--disable-blink-features=AutomationControlled"],
    },
  },
  metadata: {
    fusebaseEnv: env.name,
    backend: env.config.backend,
    orgId: env.config.orgId,
  },
});
