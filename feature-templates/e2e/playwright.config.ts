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
  },
  metadata: {
    fusebaseEnv: env.name,
    backend: env.config.backend,
    orgId: env.config.orgId,
  },
});
