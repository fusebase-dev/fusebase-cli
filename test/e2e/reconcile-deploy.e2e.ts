/**
 * Declarative deploy reconcile (NIM-41746/NIM-41752/NIM-41875): proves
 * `fusebase deploy` resolves a declarative `fusebase.json` (no real app id)
 * against a real environment — bind existing apps, create missing ones —
 * without the double-registration conflict, and writes the resolved id back
 * after a successful deploy.
 *
 * Uses a **frontend-only SPA** so each deploy exercises the reconcile step and a
 * real static upload, but skips the heavy Azure container provisioning of the
 * smoke test. All three cases run against one product (one `init`) sequentially:
 *
 *   1. create-missing — declarative entry, new subdomain → reconcile CREATES the
 *      platform app and deploys to it. The resolved id is written back into
 *      fusebase.json.
 *   2. bind-existing  — reset the entry to id-less, deploy again → reconcile
 *      BINDS to the app created in (1); no duplicate feature appears; the id is
 *      written back again.
 *   3. id-present     — entry carrying the resolved id → reconcile binds it to
 *      the same app (`bound`); no duplicate, no re-create.
 *
 * The reconcile summary (`created/bound …`) prints before the deploy
 * loop, so it is observable even when the unchanged-hash skip fires on the
 * repeat deploys.
 *
 * Skipped automatically when the FUSEBASE_* env vars are not set.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CliWorkspace,
  createApiClient,
  createCliWorkspace,
  e2eEnvAvailable,
  e2eEnvMissing,
  getE2eEnv,
  runCli,
} from "./helpers";

if (!e2eEnvAvailable) {
  // eslint-disable-next-line no-console
  console.log(
    `[e2e] Skipping reconcile-deploy — missing env vars: ${e2eEnvMissing.join(", ")}`,
  );
}

// Unique, platform-wide subdomain per run (the subdomain is the app's domain).
const RUN_ID = sanitizeSub(
  `${process.env.CI_PIPELINE_ID ?? "local"}-${
    process.env.CI_JOB_ID ?? Date.now()
  }`,
);
const APP_SUB = trimTrailingDashes(`e2e-recon-${RUN_ID}`.slice(0, 40));
const FEATURE_SUBDOMAIN = trimTrailingDashes(`${APP_SUB}-main`.slice(0, 60));

// Three SPA deploys (npm install + lint each, build+upload once). No container
// provisioning, so this stays well under the smoke test's budget.
const TEST_TIMEOUT_MS = 18 * 60_000;

describe.skipIf(!e2eEnvAvailable)("apps-cli declarative deploy reconcile", () => {
  let workspace: CliWorkspace;
  let createdProductId: string | undefined;

  beforeAll(() => {
    const env = getE2eEnv();
    // The declarative manifest + deploy reconcile is always on: deploy resolves
    // each entry's app id (bind/create) instead of requiring a legacy id.
    workspace = createCliWorkspace({
      env: env.env,
      apiKey: env.apiKey,
    });
  });

  afterAll(async () => {
    if (createdProductId) {
      const env = getE2eEnv();
      const api = createApiClient(env);
      try {
        // Cascade deletes the features created/bound during the test.
        await api.deleteApp(createdProductId);
        // eslint-disable-next-line no-console
        console.log(`[e2e teardown] Deleted product ${createdProductId}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[e2e teardown] Failed to delete product ${createdProductId}:`,
          err,
        );
      }
    }
    workspace?.cleanup();
  });

  it(
    "create-missing → bind-existing → id-present idempotent rebind",
    async () => {
      const env = getE2eEnv();
      const api = createApiClient(env);
      const fuseJsonPath = join(workspace.cwd, "fusebase.json");
      const appDir = "apps/main";

      // 0. init (product) + scaffold an SPA shell.
      const init = await runCli(
        ["init", "--name", APP_SUB, "--org", env.orgId, "--skip-git"],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(init.exitCode, debugOutput("init", init)).toBe(0);
      const initial = readFuseJson(fuseJsonPath);
      expect(initial.productId).toBeTruthy();
      // Record immediately so teardown runs even if the test throws later.
      createdProductId = initial.productId;

      const spa = await runCli(
        ["scaffold", "--template", "spa", "--dir", appDir],
        { cwd: workspace.cwd, home: workspace.home },
      );
      expect(spa.exitCode, debugOutput("scaffold spa", spa)).toBe(0);

      const declarative = {
        ...initial,
        apps: [
          {
            subdomain: FEATURE_SUBDOMAIN,
            name: "Reconcile E2E",
            path: appDir,
            dev: { command: "npm run dev" },
            build: { command: "npm run build", outputDir: "dist" },
          },
        ],
      };
      writeFuseJson(fuseJsonPath, declarative);

      // ── Case 1: create-missing ───────────────────────────────────────────
      const deploy1 = await runCli(["deploy"], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      expect(deploy1.exitCode, debugOutput("deploy #1 (create)", deploy1)).toBe(
        0,
      );
      expect(
        deploy1.stdout,
        `deploy #1 should CREATE the missing app.\n${deploy1.stdout}`,
      ).toContain(`created ${appDir} →`);

      // Exactly one platform feature now carries our subdomain.
      const afterCreate = await listFeatures(api, env.orgId, createdProductId!);
      const created = afterCreate.filter((f) => f.sub === FEATURE_SUBDOMAIN);
      expect(
        created.length,
        `expected exactly one feature with sub ${FEATURE_SUBDOMAIN}, got ${created.length}`,
      ).toBe(1);
      const createdId = created[0]!.id;
      expect(createdId).toBeTruthy();

      // Id write-back (NIM-41875): the resolved id is persisted into the entry.
      expect(
        readFuseJson(fuseJsonPath).apps?.[0]?.id,
        "deploy must write the resolved id back into fusebase.json",
      ).toBe(createdId);

      // ── Case 2: bind-existing ────────────────────────────────────────────
      // Reset to an id-less declarative entry so reconcile takes the bind path
      // (an existing platform app matched by its immutable path), not a create.
      const rebind = readFuseJson(fuseJsonPath);
      delete rebind.apps![0]!.id;
      writeFuseJson(fuseJsonPath, rebind);

      const deploy2 = await runCli(["deploy"], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      expect(deploy2.exitCode, debugOutput("deploy #2 (bind)", deploy2)).toBe(0);
      expect(
        deploy2.stdout,
        `deploy #2 should BIND to the existing app.\n${deploy2.stdout}`,
      ).toContain(`bound ${appDir} → ${createdId}`);

      // No duplicate feature was created by the bind.
      const afterBind = await listFeatures(api, env.orgId, createdProductId!);
      expect(
        afterBind.filter((f) => f.sub === FEATURE_SUBDOMAIN).length,
        "bind must not create a duplicate feature",
      ).toBe(1);
      // Bind also writes the resolved id back (NIM-41875).
      expect(
        readFuseJson(fuseJsonPath).apps?.[0]?.id,
        "bind must write the resolved id back into fusebase.json",
      ).toBe(createdId);

      // ── Case 3: id present → idempotent bind ─────────────────────────────
      // The entry already carries the resolved id (from case 2's write-back).
      // Reconcile still matches it (by immutable path, then by stored id) and
      // binds to the SAME app — a stored id must not trigger a duplicate or a
      // re-create. (Set the id explicitly so the case is self-contained.)
      const withId = readFuseJson(fuseJsonPath);
      withId.apps![0]!.id = createdId;
      writeFuseJson(fuseJsonPath, withId);

      const deploy3 = await runCli(["deploy"], {
        cwd: workspace.cwd,
        home: workspace.home,
      });
      expect(
        deploy3.exitCode,
        debugOutput("deploy #3 (id present)", deploy3),
      ).toBe(0);
      expect(
        deploy3.stdout,
        `deploy #3 should BIND the id-carrying entry to the same app.\n${deploy3.stdout}`,
      ).toContain(`bound ${appDir} → ${createdId}`);

      // Still exactly one feature; the id-carrying deploy created nothing new.
      const afterRebind = await listFeatures(api, env.orgId, createdProductId!);
      expect(
        afterRebind.filter((f) => f.sub === FEATURE_SUBDOMAIN).length,
        "id-carrying deploy must not create a new feature",
      ).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );
});

interface FeatureSummary {
  id: string;
  sub?: string;
}

interface FuseConfigShape {
  orgId?: string;
  productId?: string;
  apps?: Array<{ id?: string; subdomain?: string; path?: string }>;
  [key: string]: unknown;
}

/** List the product's features (`GET .../products/{productId}/apps`). */
async function listFeatures(
  api: ReturnType<typeof createApiClient>,
  orgId: string,
  productId: string,
): Promise<FeatureSummary[]> {
  const res = await api.request<{ apps?: FeatureSummary[] }>(
    "GET",
    `/v1/orgs/${encodeURIComponent(orgId)}/products/${encodeURIComponent(productId)}/apps`,
  );
  return res.apps ?? [];
}

function readFuseJson(path: string): FuseConfigShape {
  return JSON.parse(readFileSync(path, "utf-8")) as FuseConfigShape;
}

function writeFuseJson(path: string, value: FuseConfigShape): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf-8");
}

function debugOutput(
  label: string,
  res: { stdout: string; stderr: string },
): string {
  return `${label} failed.\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
}

function sanitizeSub(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function trimTrailingDashes(value: string): string {
  return value.replace(/-+$/, "");
}
