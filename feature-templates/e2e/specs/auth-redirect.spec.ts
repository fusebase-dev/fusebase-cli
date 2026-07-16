import { test, expect } from "@playwright/test";
import { appBaseUrl, resolveTargetEnvironment } from "../helpers/env";

/**
 * Anonymous session contract. An unauthenticated visit to the app must be
 * handed to the platform auth flow WITH a return pointer back to THIS
 * deployment — the class of flow that broke in prod incidents (gate/proxy
 * regressions on the session path). Runs without any fixtures.
 */

const env = resolveTargetEnvironment();
const baseUrl = appBaseUrl(env);

test.describe("anonymous session flow", () => {
  test("unauthenticated visit is handed to platform auth with a return url to this env", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Either the platform minted a visitor session and returned us to the
    // app, or it parked us on the auth host — both are valid states; what is
    // NEVER valid is landing anywhere else or losing the return pointer.
    await page.waitForTimeout(3000);
    const current = new URL(page.url());
    const appHost = new URL(baseUrl).host;

    if (current.host === appHost) {
      // Visitor session worked — the app itself must be serving.
      await expect(page.locator("#root")).toBeAttached();
      return;
    }

    // Parked on auth: the return pointer must reference THIS environment's
    // host — a bounce pointing at a sibling env would leak users across
    // stages.
    const appSuccess = current.searchParams.get("appSuccess");
    expect(
      appSuccess,
      `auth handoff lost the return url (landed on ${current.host})`,
    ).not.toBeNull();
    expect(new URL(appSuccess!).host).toBe(appHost);
  });

  test("auth handoff host matches this environment's backend", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const host = new URL(page.url()).host;
    const appHost = new URL(baseUrl).host;
    if (host === appHost) return; // visitor session — nothing to assert here

    // dev-backend apps must never hand sessions to prod auth hosts and vice
    // versa (the baked-host class of bugs).
    const prodAuthPatterns = /nimbusweb\.me$|thefusebase\.com$/;
    const devAuthPatterns = /dev-thefusebase\.com$/;
    if (env.config.backend === "prod") {
      expect(host).toMatch(prodAuthPatterns);
    } else {
      expect(host).toMatch(devAuthPatterns);
    }
  });
});
