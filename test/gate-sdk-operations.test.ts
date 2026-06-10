import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  updateGateSdkPermissionsInFusebaseJson,
  writeGateSdkOperationsToFusebaseJson,
} from "../lib/config.ts";

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
    expect(snap.permissions).toBeUndefined();
    expect(snap.usedOpsChangedAt).toBe(analyzedAt);

    const raw = JSON.parse(readFileSync(fusebasePath, "utf-8")) as {
      apps: Array<{
        id: string;
        fusebaseGateMeta: { usedOps: string[]; permissions?: string[] };
      }>;
    };
    expect(raw.apps[0]?.fusebaseGateMeta.usedOps).toEqual(["listOrgUsers", "listTokens"]);
    expect(raw.apps[0]?.fusebaseGateMeta.permissions).toBeUndefined();

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
    expect(snap.permissions).toBeUndefined();

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
    expect(snap.permissions).toEqual(["isolated_store.rls.bypass"]);

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
