import { test, expect } from "@playwright/test";
import {
  fetchDeployedEnvInfo,
  resolveTargetEnvironment,
} from "../../helpers/env";

/**
 * Stage guard — runs for every app project (project name = app key). Proves
 * the deployment under test is the intended environment AND the intended app
 * before any functional spec executes. If it fails, other results for this
 * app in this run are meaningless (wrong stage/app, stale deploy, or the app
 * was deployed without environment mode).
 */

const env = resolveTargetEnvironment();

test.describe("stage guard", () => {
  test("deployment matches target environment and app", async ({
    baseURL,
  }, testInfo) => {
    const appKey = testInfo.project.name;
    const info = await fetchDeployedEnvInfo(baseURL!);
    expect(
      info,
      "fusebase-env.json missing — deploy this app with `fusebase deploy --env <name>`",
    ).not.toBeNull();
    expect(info!.env).toBe(env.name);
    expect(info!.backend).toBe(env.config.backend);
    expect(info!.orgId).toBe(env.config.orgId);

    // The deployed bundle must be THIS project's app, not a sibling.
    const expectedId = env.config.apps?.[appKey]?.id;
    if (expectedId) expect(info!.appId).toBe(expectedId);
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
        "sign-in specs (see examples/role-matrix.spec.ts).",
    );
    await expect(page.locator("#root")).toBeAttached();
    const panel = page.getByTestId("fbs-env-panel-name");
    if (await panel.isVisible().catch(() => false)) {
      await expect(panel).toContainText(env.name);
    }
  });
});
