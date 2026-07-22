import { test, expect } from "@playwright/test";
import {
  createSignInMagicLink,
  fixtureUser,
  resolveTargetEnvironment,
} from "../../helpers/env";

/**
 * RECIPE — copy into specs/integration/ (NOT specs/<app>/).
 *
 * Portal access propagation: a fixture that registers into an app of the org
 * must reach the PORTAL that embeds the app(s), and a user who enters via the
 * portal must reach the embedded apps. Same org → shared session.
 *
 * This is an INTEGRATION flow (app ↔ portal), so it lives in the `integration`
 * project. The portal URL is app-owned config, not an app subdomain — set
 * PORTAL_URL for the target environment (or read it from your own env config).
 *
 * Requirements:
 *  - a portal in the org that embeds the product's apps
 *  - a `client` fixture + GATE_MCP_TOKEN
 *
 * Replace PORTAL_URL with the real portal URL per environment.
 */

const env = resolveTargetEnvironment();

// TODO: per-environment portal URL (portals are app-owned config, not app
// subdomains). Read it from your environments/<name>.json if you store it
// under a custom key, or hardcode per env here.
const PORTAL_URL = env.config.backend === "prod"
  ? "https://your-portal.example.com/"
  : "https://your-portal.dev.example.com/";

test.describe("app ↔ portal access propagation", () => {
  test.skip(
    !fixtureUser(env, "client"),
    `fixture "client" not configured for env "${env.name}"`,
  );
  test.skip(
    PORTAL_URL.includes("example.com"),
    "set PORTAL_URL to the real portal for this environment",
  );

  test("registered user reaches the portal", async ({ page }) => {
    const { magicLinkUrl } = await createSignInMagicLink(env, "client");
    await page.goto(magicLinkUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000); // let activation settle

    await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded" });
    // Assert the portal content loads for the authed user — adjust the
    // selector to a stable element of YOUR portal (not the sign-in screen).
    // e.g. await expect(page.getByTestId("portal-home")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(new URL(PORTAL_URL).host));
  });
});
