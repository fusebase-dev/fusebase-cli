import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  invalidateFuseConfigCache,
  writeAppPermissionsToFusebaseJson,
  writeBackendOnlyGatePermissionsToFusebaseJson,
} from "../lib/config";
import { mergeFeaturePermissions } from "../lib/permissions";

// NIM-42223: explicit cleanup of backendOnlyGatePermissions in fusebase.json.
describe("writeBackendOnlyGatePermissionsToFusebaseJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fuse-backendonly-writeback-"));
    invalidateFuseConfigCache();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeConfig = (app: Record<string, unknown>): void => {
    writeFileSync(
      join(dir, "fusebase.json"),
      JSON.stringify({ orgId: "o1", productId: "p1", apps: [app] }, null, 2) + "\n",
      "utf-8",
    );
  };

  const readApp = (): Record<string, unknown> => {
    const raw = JSON.parse(readFileSync(join(dir, "fusebase.json"), "utf-8"));
    return raw.apps[0];
  };

  it("writes a sorted non-empty list (existing behavior)", () => {
    writeConfig({ id: "app-1", path: "apps/x" });
    writeBackendOnlyGatePermissionsToFusebaseJson(dir, "app-1", [
      "portals.read",
      "org.members.read",
    ]);
    expect(readApp().backendOnlyGatePermissions).toEqual([
      "org.members.read",
      "portals.read",
    ]);
  });

  it("removes the field when cleared with an empty list", () => {
    writeConfig({ id: "app-1", path: "apps/x", backendOnlyGatePermissions: ["org.members.read"] });
    writeBackendOnlyGatePermissionsToFusebaseJson(dir, "app-1", []);
    expect(readApp()).not.toHaveProperty("backendOnlyGatePermissions");
  });

  it("leaves a legacy config untouched when clearing an absent field", () => {
    writeConfig({ id: "app-1", path: "apps/x" });
    writeBackendOnlyGatePermissionsToFusebaseJson(dir, "app-1", []);
    expect(readApp()).not.toHaveProperty("backendOnlyGatePermissions");
  });

  // NIM-42737: `app update --permissions` grants only reached the remote app record, and
  // deploy reconcile PATCHed them away because it rebuilds from fusebase.json alone.
  describe("writeAppPermissionsToFusebaseJson", () => {
    const grant = {
      items: [{ type: "gate" as const, privileges: ["app_api.analytics.vse_usage.read"] }],
    };

    it("persists the granted privileges on the app entry", () => {
      writeConfig({ id: "app-1", path: "apps/x" });
      writeAppPermissionsToFusebaseJson(dir, "app-1", grant);
      expect(readApp().permissions).toEqual(grant);
    });

    it("removes the field when cleared with an empty set", () => {
      writeConfig({ id: "app-1", path: "apps/x", permissions: grant });
      writeAppPermissionsToFusebaseJson(dir, "app-1", { items: [] });
      expect(readApp()).not.toHaveProperty("permissions");
    });

    it("survives the deploy reconcile merge that used to revert it", () => {
      writeConfig({ id: "app-1", path: "apps/x" });
      writeAppPermissionsToFusebaseJson(dir, "app-1", grant);

      // Same call shape as applyAppUpdates (lib/reconcile.ts): fusebase.json + the analyze
      // snapshot and no existingPermissions — a remote-only grant is dropped here.
      const desired = mergeFeaturePermissions({
        manualPermissions: readApp().permissions as typeof grant,
        gatePermissions: ["token.read"],
      });

      expect(desired?.items).toEqual([
        {
          type: "gate",
          privileges: ["app_api.analytics.vse_usage.read", "token.read"],
        },
      ]);
    });
  });
});
