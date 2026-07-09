import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  invalidateFuseConfigCache,
  writeBackendOnlyGatePermissionsToFusebaseJson,
} from "../lib/config";

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
});
