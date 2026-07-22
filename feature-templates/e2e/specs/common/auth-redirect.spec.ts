import { test, expect } from "@playwright/test";
import { resolveTargetEnvironment } from "../../helpers/env";

/**
 * Anonymous session contract — runs for every app project. An unauthenticated
 * visit must be handed to the platform auth flow WITH a return pointer back to
 * THIS deployment (the class of flow that broke in prod session/proxy
 * regressions). Runs without any fixtures.
 */

const env = resolveTargetEnvironment();

test.describe("anonymous session flow", () => {
  test("unauthenticated visit is handed to platform auth with a return url to this app", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const current = new URL(page.url());
    const appHost = new URL(baseURL!).host;

    if (current.host === appHost) {
      // Visitor session worked — the app itself must be serving.
      await expect(page.locator("#root")).toBeAttached();
      return;
    }

    // Parked on auth: the return pointer must reference THIS app's host —
    // a bounce pointing elsewhere would leak users across apps/stages.
    const appSuccess = current.searchParams.get("appSuccess");
    expect(
      appSuccess,
      `auth handoff lost the return url (landed on ${current.host})`,
    ).not.toBeNull();
    expect(new URL(appSuccess!).host).toBe(appHost);
  });

  test("auth handoff host matches this environment's backend", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const host = new URL(page.url()).host;
    if (host === new URL(baseURL!).host) return; // visitor session — nothing to assert

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
