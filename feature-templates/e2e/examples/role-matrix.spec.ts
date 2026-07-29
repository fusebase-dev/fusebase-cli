import { test, expect } from "@playwright/test";
import {
  appBaseUrl,
  createSignInMagicLink,
  fixtureUser,
  resolveTargetEnvironment,
} from "../../helpers/env";

/**
 * RECIPE — not executed from examples/. Copy into specs/<appKey>/ when your app has
 * role-differentiated access worth testing (public/single-role apps don't).
 *
 * Fixture-driven role matrix:
 *
 * Sign-in is passwordless: Gate mints a magic link for the fixture email and
 * the spec activates it (the platform sets session cookies). Requirements:
 *  - fixture identities in `environments/<name>.json` → fixtures.testUsers
 *  - `GATE_MCP_TOKEN` in `.env.<name>` (refresh: `fusebase env tokens`)
 *
 * A case self-skips when its fixture is not configured for the target env, so
 * the same spec set stays runnable everywhere while fixtures roll out.
 * Never hardcode credentials or ids — everything comes from the env.
 */

const env = resolveTargetEnvironment();
const appHost = new URL(appBaseUrl(env)).host;

const ROLES = ["owner", "member", "client"] as const;

for (const roleKey of ROLES) {
  test.describe(`role: ${roleKey}`, () => {
    const user = fixtureUser(env, roleKey);
    test.skip(
      !user,
      `fixture "${roleKey}" not configured for env "${env.name}" ` +
        `(add to environments/${env.name}.json fixtures.testUsers)`,
    );

    test("signs in via magic link and reaches the app", async ({ page }) => {
      const { magicLinkUrl } = await createSignInMagicLink(env, roleKey);
      await page.goto(magicLinkUrl, { waitUntil: "domcontentloaded" });
      // Activation sets session cookies and redirects into the app.
      await page.waitForURL((url) => url.host === appHost);
      await expect(page.locator("#root")).toBeAttached();

      // TODO: assert what THIS role must and must not see. Keep assertions
      // role-differential: a client must NOT see admin surfaces; an owner
      // must. Absence assertions catch fail-open regressions — the expensive
      // class.
    });
  });
}
