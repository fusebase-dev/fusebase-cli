/**
 * Smoke check for the e2e harness itself.
 *
 * - When credentials are missing, the suite SKIPs cleanly so contributors can
 *   run `bun run test:e2e` locally without setting any env vars.
 * - When credentials are present, the suite reaches the configured public-api
 *   and verifies it can authenticate (`listApps`) and reach the configured
 *   test dashboard (`getInfo`). This guards against typos in the CI vars
 *   before the real smoke deploy (NIM-40901) runs.
 */

import { describe, expect, it } from "bun:test";
import {
  createApiClient,
  createDashboardClient,
  e2eEnvAvailable,
  e2eEnvMissing,
  getE2eEnv,
} from "./helpers";

if (!e2eEnvAvailable) {
  // eslint-disable-next-line no-console
  console.log(
    `[e2e] Skipping suite — missing env vars: ${e2eEnvMissing.join(", ")}`,
  );
}

describe.skipIf(!e2eEnvAvailable)("e2e harness", () => {
  it("loads env and resolves api base url", () => {
    const env = getE2eEnv();
    expect(env.apiKey.length).toBeGreaterThan(0);
    expect(env.orgId.length).toBeGreaterThan(0);
    expect(env.dashboardId.length).toBeGreaterThan(0);
    expect(env.apiBaseUrl).toMatch(/^https:\/\/public-api\./);
  });

  it("authenticates against the public-api (listApps)", async () => {
    const env = getE2eEnv();
    const api = createApiClient(env);
    const apps = await api.listApps();
    expect(Array.isArray(apps)).toBe(true);
  });

  it("can read the configured test dashboard", async () => {
    const env = getE2eEnv();
    const api = createApiClient(env);
    const dashboard = createDashboardClient(api, env);
    const info = await dashboard.getInfo();
    expect(info.id).toBeTruthy();
  });
});
