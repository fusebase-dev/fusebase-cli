import { test, expect } from "@playwright/test";
import {
  appBaseUrl,
  fetchDeployedEnvInfo,
  resolveTargetEnvironment,
} from "../helpers/env";

/**
 * Stage guard — keep this spec first. It proves the run targets the intended
 * environment before any functional test executes. If it fails, every other
 * result in this run is meaningless (wrong stage, stale deploy, or the app
 * was deployed without environment mode).
 */

const env = resolveTargetEnvironment();

test.describe("stage guard", () => {
  test(`deployment matches target environment "${env.name}"`, async () => {
    const info = await fetchDeployedEnvInfo(appBaseUrl(env));
    expect(
      info,
      "fusebase-env.json missing — deploy this app with `fusebase deploy --env <name>`",
    ).not.toBeNull();
    expect(info!.env).toBe(env.name);
    expect(info!.backend).toBe(env.config.backend);
    expect(info!.orgId).toBe(env.config.orgId);
  });

  test("app shell loads", async ({ page, baseURL }) => {
    await page.goto("/?envpanel=1", { waitUntil: "domcontentloaded" });
    // The platform may bounce anonymous visitors through the auth host
    // (session mint / sign-in). Give the bounce time to come back.
    const appHost = new URL(baseURL!).host;
    const returned = await page
      .waitForURL((url) => url.host === appHost, { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    test.skip(
      !returned,
      `platform kept the anonymous session on ${new URL(page.url()).host} — ` +
        "this app requires a signed-in session; cover it with fixture-based " +
        "sign-in specs (see auth-matrix.example.spec.ts)",
    );
    await expect(page.locator("#root")).toBeAttached();
    // The env panel (staff/debug surface) renders even while auth loads;
    // on env-aware deploys it must show the same environment name.
    const panel = page.getByTestId("fbs-env-panel-name");
    if (await panel.isVisible().catch(() => false)) {
      await expect(panel).toContainText(env.name);
    }
  });
});
