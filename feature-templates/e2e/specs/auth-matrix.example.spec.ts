import { test, expect } from "@playwright/test";
import { fixtureUser, resolveTargetEnvironment } from "../helpers/env";

/**
 * EXAMPLE: fixture-driven role matrix. Copy this pattern for real cases.
 *
 * Fixture identities live in `environments/<name>.json` → fixtures.testUsers
 * (committed); passwords live in `.env.<name>` as PW_USER_<KEY>_PASSWORD
 * (gitignored / CI variables). A case self-skips when its fixture is not
 * configured for the target env, so the same spec set stays runnable on every
 * environment while fixtures are being rolled out.
 *
 * Never hardcode credentials or ids in specs — everything comes from the env.
 */

const env = resolveTargetEnvironment();

const ROLES = ["owner", "member", "client"] as const;

for (const roleKey of ROLES) {
  test.describe(`role: ${roleKey}`, () => {
    const user = fixtureUser(env, roleKey);
    test.skip(
      !user,
      `fixture "${roleKey}" not configured for env "${env.name}" ` +
        `(add to environments/${env.name}.json fixtures.testUsers + ` +
        `PW_USER_${roleKey.toUpperCase()}_PASSWORD to .env.${env.name})`,
    );

    test("loads the app entry", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator("#root")).toBeAttached();
      // TODO: sign in as `user` via your app's auth flow (magic link /
      // platform login), then assert what THIS role must and must not see.
      // Keep assertions role-differential: a client must NOT see admin
      // surfaces; an owner must.
    });
  });
}
