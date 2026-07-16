import { test, expect } from "@playwright/test";
import {
  appBaseUrl,
  fetchDeployedEnvInfo,
  resolveTargetEnvironment,
} from "../helpers/env";

/**
 * Environment contract of the deployed bundle. These cases are pure HTTP
 * (static assets are public), so they run green on any environment without a
 * session — and they catch the expensive class of mistakes: a bundle deployed
 * with the wrong env-info, ids leaking between environments, or counterpart
 * links pointing at the wrong stage.
 */

const env = resolveTargetEnvironment();
const baseUrl = appBaseUrl(env);

test.describe("deployed env contract", () => {
  test("env-info matches the environment lockfile", async () => {
    const info = await fetchDeployedEnvInfo(baseUrl);
    expect(info).not.toBeNull();

    expect(info!.env).toBe(env.name);
    expect(info!.backend).toBe(env.config.backend);
    expect(info!.orgId).toBe(env.config.orgId);

    // appId must be THIS environment's id from the lockfile — never a
    // sibling's (cross-env id leakage is the bug class this guards).
    const lockfileIds = Object.values(env.config.apps ?? {})
      .map((a) => a.id)
      .filter(Boolean);
    expect(lockfileIds).toContain(info!.appId);
  });

  test("env-info url points at this deployment", async () => {
    const info = (await fetchDeployedEnvInfo(baseUrl))!;
    expect(info).not.toBeNull();
    const raw = info as unknown as { url?: string; subdomain?: string };
    expect(raw.url).toBeDefined();
    expect(new URL(raw.url!).host).toBe(new URL(baseUrl).host);
  });

  test("counterparts are live and honest", async () => {
    const info = (await fetchDeployedEnvInfo(baseUrl)) as unknown as {
      env: string;
      appId?: string;
      counterparts: Array<{
        env: string;
        backend: string;
        url: string;
        sameOrg: boolean;
      }>;
    };
    expect(info).not.toBeNull();

    for (const counterpart of info.counterparts) {
      // A counterpart must never point back at this same deployment.
      expect(new URL(counterpart.url).host).not.toBe(new URL(baseUrl).host);

      // The counterpart deployment (when it exists) must identify as ITS env,
      // with a different appId — environments are standalone apps.
      const remote = await fetchDeployedEnvInfo(
        counterpart.url.replace(/\/$/, ""),
      );
      if (remote === null) {
        // Not deployed yet — acceptable; skip symmetry checks for it.
        continue;
      }
      expect(remote.env).toBe(counterpart.env);
      expect(remote.appId).not.toBe(info.appId);

      // Symmetry: the counterpart's own counterpart list mentions us.
      const remoteFull = remote as unknown as {
        counterparts?: Array<{ env: string }>;
      };
      expect(
        remoteFull.counterparts?.map((c) => c.env) ?? [],
        `counterpart "${counterpart.env}" should link back to "${env.name}" — redeploy it with --force after adding environments`,
      ).toContain(env.name);
    }
  });

  test("static assets referenced by the bundle are served", async () => {
    // fusebase-env.json is baked next to the bundle; if it serves, the static
    // path works. Assert content-type sanity to catch stub/interception.
    const res = await fetch(`${baseUrl}/fusebase-env.json`, {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("json");
  });
});
