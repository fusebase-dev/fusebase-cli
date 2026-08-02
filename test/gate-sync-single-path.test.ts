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

// NIM-42739: a grant can sit in the app record or in local apps[].permissions alone, so every
// reader of "what a sync publishes" must take the union. Hand-built in three places, it drifted
// twice — the drift check predicted a union while syncAppGatePermissions still read the remote
// alone, and the default-yes sync prompt then returned on every Gate-SDK bump.
// ponytail: source-level guard for the same reason as above — the sync path needs the network.
describe("stored gate permissions are read through one union helper", () => {
  const files = [
    join("lib", "commands", "app-update.ts"),
    join("lib", "gate-permissions-drift.ts"),
    join("lib", "sync-app-gate-permissions.ts"),
  ];

  for (const file of files) {
    const source = readFileSync(join(import.meta.dir, "..", file), "utf-8");

    it(`${file} merges against unionStoredPermissions`, () => {
      expect(source).toContain("unionStoredPermissions(");
    });

    it(`${file} does not read one copy alone`, () => {
      // Both the argument form (`storedPermissions: x`) and the local (`const storedPermissions = x`)
      // — matching only one leaves that file's assertion vacuous.
      for (const [, argument] of source.matchAll(/storedPermissions(?::|\s*=)\s*([^,\n]+)/g)) {
        expect(argument).toContain("unionStoredPermissions(");
      }
    });
  }
});
