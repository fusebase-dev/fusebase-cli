import { test, expect } from "@playwright/test";
import {
  fetchDeployedEnvInfo,
  resolveTargetEnvironment,
} from "../../helpers/env";

/**
 * Environment contract of the deployed bundle — runs for every app project.
 * Pure HTTP (static assets are public), so it runs green on any environment
 * without a session, and catches the expensive class of mistakes: a bundle
 * deployed with the wrong env-info, ids leaking between environments, or
 * counterpart links pointing at the wrong stage.
 */

const env = resolveTargetEnvironment();

test.describe("deployed env contract", () => {
  test("env-info matches the environment lockfile", async ({
    baseURL,
  }, testInfo) => {
    const appKey = testInfo.project.name;
    const info = await fetchDeployedEnvInfo(baseURL!);
    expect(info).not.toBeNull();

    expect(info!.env).toBe(env.name);
    expect(info!.backend).toBe(env.config.backend);
    expect(info!.orgId).toBe(env.config.orgId);

    // appId must be THIS app's id from the lockfile for THIS environment —
    // never a sibling app's or a sibling env's (id leakage is the bug class
    // this guards).
    const expectedId = env.config.apps?.[appKey]?.id;
    if (expectedId) expect(info!.appId).toBe(expectedId);
  });

  test("env-info url points at this deployment", async ({ baseURL }) => {
    const info = (await fetchDeployedEnvInfo(baseURL!))!;
    expect(info).not.toBeNull();
    const raw = info as unknown as { url?: string };
    expect(raw.url).toBeDefined();
    expect(new URL(raw.url!).host).toBe(new URL(baseURL!).host);
  });

  test("counterparts are live and honest", async ({ baseURL }) => {
    const info = (await fetchDeployedEnvInfo(baseURL!)) as unknown as {
      env: string;
      appId?: string;
      counterparts: Array<{ env: string; url: string; sameOrg: boolean }>;
    };
    expect(info).not.toBeNull();
    const appHost = new URL(baseURL!).host;

    for (const counterpart of info.counterparts) {
      expect(new URL(counterpart.url).host).not.toBe(appHost);

      const remote = await fetchDeployedEnvInfo(
        counterpart.url.replace(/\/$/, ""),
      );
      if (remote === null) continue; // counterpart not deployed yet — ok

      expect(remote.env).toBe(counterpart.env);
      expect(remote.appId).not.toBe(info.appId);

      const remoteFull = remote as unknown as {
        counterparts?: Array<{ env: string }>;
      };
      expect(
        remoteFull.counterparts?.map((c) => c.env) ?? [],
        `counterpart "${counterpart.env}" should link back to "${env.name}" — redeploy it with --force after adding environments`,
      ).toContain(env.name);
    }
  });

  test("static assets referenced by the bundle are served", async ({
    baseURL,
  }) => {
    const res = await fetch(`${baseURL}/fusebase-env.json`, {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("json");
  });
});
