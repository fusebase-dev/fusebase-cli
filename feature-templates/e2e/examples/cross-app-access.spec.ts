import { test, expect } from "@playwright/test";
import {
  appBaseUrl,
  createSignInMagicLink,
  fixtureUser,
  resolveTargetEnvironment,
} from "../../helpers/env";

/**
 * RECIPE — copy into specs/integration/ (NOT specs/<app>/).
 *
 * Cross-app access propagation: a fixture that registers / signs into one app
 * of the product must automatically reach the OTHER apps of the same org
 * without a new sign-in (platform shares the session across `*.thefusebase.app`
 * subdomains of the same org). Also verifies the REVERSE direction.
 *
 * This is an INTEGRATION flow — it spans two apps, so it lives in the
 * `integration` Playwright project (no fixed baseURL). It builds each app's
 * URL explicitly via appBaseUrl(env, key).
 *
 * Requirements:
 *  - at least two apps in fusebase.json (set their keys, e.g. `app-a`,`app-b`)
 *  - a `client` fixture in environments/<name>.json + GATE_MCP_TOKEN
 *
 * Replace APP_A / APP_B below with your real app keys.
 */

const env = resolveTargetEnvironment();

const APP_A = "app-a";
const APP_B = "app-b";

async function host(appKey: string): Promise<string> {
  return new URL(appBaseUrl(env, appKey)).host;
}

test.describe("cross-app access propagation (one org)", () => {
  test.skip(
    !fixtureUser(env, "client"),
    `fixture "client" not configured for env "${env.name}"`,
  );

  test(`signed into ${APP_A} → reaches ${APP_B} without re-login`, async ({
    page,
  }) => {
    // Product-scoped magic link: grants access to every app of the product;
    // one org → one shared session across app subdomains.
    const { magicLinkUrl } = await createSignInMagicLink(env, "client");
    await page.goto(magicLinkUrl, { waitUntil: "domcontentloaded" });
    await page.waitForURL(async (u) => u.host === (await host(APP_A)), {
      timeout: 20000,
    });
    await expect(page.locator("#root")).toBeAttached();

    // Now the OTHER app — no second sign-in. The platform must keep us on the
    // app (authed), not bounce back to the auth host.
    await page.goto(appBaseUrl(env, APP_B), { waitUntil: "domcontentloaded" });
    await page.waitForURL(async (u) => u.host === (await host(APP_B)), {
      timeout: 15000,
    });
    await expect(page.locator("#root")).toBeAttached();
  });

  test(`reverse: signed into ${APP_B} → reaches ${APP_A}`, async ({ page }) => {
    const { magicLinkUrl } = await createSignInMagicLink(env, "client");
    await page.goto(magicLinkUrl, { waitUntil: "domcontentloaded" });
    // Land anywhere in the product, then drive from B → A.
    await page.goto(appBaseUrl(env, APP_B), { waitUntil: "domcontentloaded" });
    await page.waitForURL(async (u) => u.host === (await host(APP_B)), {
      timeout: 20000,
    });
    await expect(page.locator("#root")).toBeAttached();

    await page.goto(appBaseUrl(env, APP_A), { waitUntil: "domcontentloaded" });
    await page.waitForURL(async (u) => u.host === (await host(APP_A)), {
      timeout: 15000,
    });
    await expect(page.locator("#root")).toBeAttached();
  });
});
