import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  updateGateSdkPermissionsInFusebaseJson,
  writeGateSdkOperationsToFusebaseJson,
} from "../lib/config.ts";
import {
  ENVIRONMENTS_DIR,
  resetEnvironmentsStateForTests,
  setEnvironmentOverride,
  writeActiveEnvironmentState,
  writeEnvironmentConfig,
} from "../lib/environments.ts";

describe("writeGateSdkOperationsToFusebaseJson", () => {
  it("shrinks usedOps when the analyzer reports fewer operations", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-"));
    const fusebasePath = join(dir, "fusebase.json");
    writeFileSync(
      fusebasePath,
      JSON.stringify(
        {
          orgId: "x",
          productId: "y",
          apps: [
            {
              id: "app-1",
              path: "apps/a",
              fusebaseGateMeta: {
                sdkVersion: "1.0.0",
                analyzedAt: "2020-01-01T00:00:00.000Z",
                usedOpsChangedAt: "2020-01-01T00:00:00.000Z",
                permissionsChangedAt: "2020-01-01T00:00:00.000Z",
                usedOps: ["addOrgUser", "createToken", "listOrgUsers", "listTokens"],
                permissions: ["token.read", "token.write", "org.members.read"],
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const analyzedAt = new Date().toISOString();
    const snap = writeGateSdkOperationsToFusebaseJson(dir, "app-1", {
      analyzedAt,
      usedOps: ["listOrgUsers", "listTokens"],
      sdkVersion: "1.0.0",
    });

    expect(snap.usedOps).toEqual(["listOrgUsers", "listTokens"]);
    // Merge by default (NIM-42739): shrinking usedOps must not delete stored grants —
    // the resolver refills only what it can infer, so clearing here wipes hand-declared ones.
    expect(snap.permissions).toEqual([
      "org.members.read",
      "token.read",
      "token.write",
    ]);
    expect(snap.usedOpsChangedAt).toBe(analyzedAt);

    const raw = JSON.parse(readFileSync(fusebasePath, "utf-8")) as {
      apps: Array<{
        id: string;
        fusebaseGateMeta: { usedOps: string[]; permissions?: string[] };
      }>;
    };
    expect(raw.apps[0]?.fusebaseGateMeta.usedOps).toEqual(["listOrgUsers", "listTokens"]);
    expect(raw.apps[0]?.fusebaseGateMeta.permissions).toEqual([
      "org.members.read",
      "token.read",
      "token.write",
    ]);

    const pruned = writeGateSdkOperationsToFusebaseJson(
      dir,
      "app-1",
      { analyzedAt, usedOps: ["listOrgUsers", "listTokens"], sdkVersion: "1.0.0" },
      { prunePermissions: true },
    );
    expect(pruned.permissions).toBeUndefined();

    rmSync(dir, { recursive: true });
  });

  it("writes empty usedOps when no Gate API calls remain in the app", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-"));
    const fusebasePath = join(dir, "fusebase.json");
    writeFileSync(
      fusebasePath,
      JSON.stringify(
        {
          orgId: "x",
          productId: "y",
          apps: [
            {
              id: "app-1",
              path: "apps/a",
              fusebaseGateMeta: {
                sdkVersion: "1.0.0",
                analyzedAt: "2020-01-01T00:00:00.000Z",
                usedOpsChangedAt: "2020-01-01T00:00:00.000Z",
                usedOps: ["listTokens"],
                permissions: ["token.read"],
                permissionsChangedAt: "2020-01-01T00:00:00.000Z",
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const analyzedAt = new Date().toISOString();
    const snap = writeGateSdkOperationsToFusebaseJson(dir, "app-1", {
      analyzedAt,
      usedOps: [],
      sdkVersion: "1.0.0",
    });

    expect(snap.usedOps).toEqual([]);
    expect(snap.permissions).toEqual(["token.read"]);

    expect(
      writeGateSdkOperationsToFusebaseJson(
        dir,
        "app-1",
        { analyzedAt, usedOps: [], sdkVersion: "1.0.0" },
        { prunePermissions: true },
      ).permissions,
    ).toBeUndefined();

    rmSync(dir, { recursive: true });
  });

  it("migrates legacy top-level gate meta into the only configured app", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-"));
    const fusebasePath = join(dir, "fusebase.json");
    writeFileSync(
      fusebasePath,
      JSON.stringify(
        {
          orgId: "x",
          productId: "y",
          apps: [
            {
              id: "app-1",
              path: "apps/a",
            },
          ],
          fusebaseGateMeta: {
            sdkVersion: "1.0.0",
            analyzedAt: "2020-01-01T00:00:00.000Z",
            usedOpsChangedAt: "2020-01-01T00:00:00.000Z",
            permissionsChangedAt: "2020-01-01T00:00:00.000Z",
            usedOps: ["listTokens"],
            permissions: ["token.read"],
          },
        },
        null,
        2,
      ),
    );

    const snap = writeGateSdkOperationsToFusebaseJson(dir, "app-1", {
      analyzedAt: "2020-01-01T00:00:00.000Z",
      usedOps: ["listTokens"],
      sdkVersion: "1.0.0",
    });

    expect(snap.permissions).toEqual(["token.read"]);

    const raw = JSON.parse(readFileSync(fusebasePath, "utf-8")) as {
      fusebaseGateMeta?: unknown;
      apps: Array<{
        id: string;
        fusebaseGateMeta?: { usedOps: string[]; permissions?: string[] };
      }>;
    };
    expect(raw.fusebaseGateMeta).toBeUndefined();
    expect(raw.apps[0]?.fusebaseGateMeta?.permissions).toEqual(["token.read"]);

    rmSync(dir, { recursive: true });
  });

  it("preserves manual Gate permissions when usedOps change", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-"));
    const fusebasePath = join(dir, "fusebase.json");
    writeFileSync(
      fusebasePath,
      JSON.stringify(
        {
          orgId: "x",
          productId: "y",
          apps: [
            {
              id: "app-1",
              path: "apps/a",
              fusebaseGateMeta: {
                sdkVersion: "1.0.0",
                analyzedAt: "2020-01-01T00:00:00.000Z",
                usedOpsChangedAt: "2020-01-01T00:00:00.000Z",
                permissionsChangedAt: "2020-01-01T00:00:00.000Z",
                usedOps: ["selectIsolatedStoreSqlRows"],
                manualPermissions: ["isolated_store.rls.bypass"],
                permissions: [
                  "isolated_store.read",
                  "isolated_store.rls.bypass",
                ],
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const analyzedAt = new Date().toISOString();
    const snap = writeGateSdkOperationsToFusebaseJson(dir, "app-1", {
      analyzedAt,
      usedOps: ["countIsolatedStoreSqlRows"],
      sdkVersion: "1.0.0",
    });

    expect(snap.manualPermissions).toEqual(["isolated_store.rls.bypass"]);
    // Previously resolved permissions are carried forward alongside the manual ones
    // until the resolver (or an explicit prune) replaces them (NIM-42739).
    expect(snap.permissions).toEqual([
      "isolated_store.read",
      "isolated_store.rls.bypass",
    ]);

    const raw = JSON.parse(readFileSync(fusebasePath, "utf-8")) as {
      apps: Array<{
        fusebaseGateMeta?: {
          manualPermissions?: string[];
          permissions?: string[];
        };
      }>;
    };
    expect(raw.apps[0]?.fusebaseGateMeta?.manualPermissions).toEqual([
      "isolated_store.rls.bypass",
    ]);
    expect(raw.apps[0]?.fusebaseGateMeta?.permissions).toEqual([
      "isolated_store.read",
      "isolated_store.rls.bypass",
    ]);

    rmSync(dir, { recursive: true });
  });

  it("merges manual Gate permissions with resolved permissions", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-"));
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify(
        {
          orgId: "x",
          productId: "y",
          apps: [
            {
              id: "app-1",
              path: "apps/a",
              fusebaseGateMeta: {
                sdkVersion: "1.0.0",
                analyzedAt: "2020-01-01T00:00:00.000Z",
                usedOpsChangedAt: "2020-01-01T00:00:00.000Z",
                usedOps: ["selectIsolatedStoreSqlRows"],
                manualPermissions: ["isolated_store.rls.bypass"],
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    const snap = updateGateSdkPermissionsInFusebaseJson(
      dir,
      "app-1",
      ["isolated_store.read"],
      new Date().toISOString(),
    );

    expect(snap.manualPermissions).toEqual(["isolated_store.rls.bypass"]);
    expect(snap.permissions).toEqual([
      "isolated_store.read",
      "isolated_store.rls.bypass",
    ]);

    rmSync(dir, { recursive: true });
  });
});

describe("writeGateSdkOperationsToFusebaseJson with env-stripped ids", () => {
  it("writes fusebaseGateMeta by reverse-looking up platform id via environments/<name>.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "fusebase-gate-env-"));
    const prevCwd = process.cwd();
    process.chdir(dir);

    try {
      resetEnvironmentsStateForTests();
      mkdirSync(join(dir, ENVIRONMENTS_DIR), { recursive: true });
      writeEnvironmentConfig(dir, "beta", {
        backend: "prod",
        orgId: "org-beta",
        productId: "prod-beta",
        apps: {
          "admin-area": { id: "49gxiw8zpz0xzmai" },
          "customer-portal": { id: "8i1ibjmsxyw2q1he" },
        },
      });
      writeActiveEnvironmentState(dir, "beta");
      setEnvironmentOverride("beta");

      writeFileSync(
        join(dir, "fusebase.json"),
        JSON.stringify(
          {
            apps: [
              { key: "admin-area", path: "apps/admin-area", subdomain: "admin" },
              {
                key: "customer-portal",
                path: "apps/customer-portal",
                subdomain: "portal",
              },
            ],
          },
          null,
          2,
        ),
      );

      const analyzedAt = new Date().toISOString();
      const snap = writeGateSdkOperationsToFusebaseJson(dir, "49gxiw8zpz0xzmai", {
        analyzedAt,
        usedOps: ["listIsolatedStores"],
        sdkVersion: "2.0.0",
      });

      expect(snap.usedOps).toEqual(["listIsolatedStores"]);

      const raw = JSON.parse(readFileSync(join(dir, "fusebase.json"), "utf-8")) as {
        apps: Array<{
          key?: string;
          id?: string;
          fusebaseGateMeta?: { usedOps: string[] };
        }>;
      };
      expect(raw.apps[0]?.id).toBeUndefined();
      expect(raw.apps[0]?.key).toBe("admin-area");
      expect(raw.apps[0]?.fusebaseGateMeta?.usedOps).toEqual(["listIsolatedStores"]);
      expect(raw.apps[1]?.fusebaseGateMeta).toBeUndefined();
    } finally {
      resetEnvironmentsStateForTests();
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true });
    }
  });
});
