import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

// NIM-42264 / QA D-3: `app update --sync-gate-permissions` used to re-implement the
// analyze + backend-only split inline, so the subtractBackendOnlyFromRuntime fix
// (MR !112) landed only in syncAppGatePermissions and the command kept publishing
// declared backend-only perms (e.g. portals.read) into the browser set.
// ponytail: source-level guard — a behavioural test would need the Gate analyzer
// (network) mocked; this fails the moment the second copy comes back.
describe("gate permission sync has a single path", () => {
  const source = readFileSync(
    join(import.meta.dir, "..", "lib", "commands", "app-update.ts"),
    "utf-8",
  );

  it("app update delegates to resolveGateSyncPermissions", () => {
    expect(source).toContain("resolveGateSyncPermissions");
  });

  it("app update does not re-implement the analyze/split itself", () => {
    for (const forbidden of [
      "analyzeFeatureGatePermissions",
      "splitGatePermissionStrings",
      "buildSyncedBackendOnlyGatePermissions",
      "declareStorePermissionsBackendOnly",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
