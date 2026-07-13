import { describe, expect, it } from "bun:test";
import { findGatePermissionDiagnostics } from "../lib/gate-sdk-permission-diagnostics.ts";

describe("findGatePermissionDiagnostics", () => {
  it("warns when an RLS bypass operation lacks the bypass permission", () => {
    expect(
      findGatePermissionDiagnostics({
        usedOps: ["selectIsolatedStoreSqlRowsRlsBypass"],
        permissions: ["isolated_store.read"],
      }),
    ).toEqual([
      expect.stringContaining("isolated_store.rls.bypass"),
    ]);
  });

  it("does not warn when the expected permission is present", () => {
    expect(
      findGatePermissionDiagnostics({
        usedOps: ["selectIsolatedStoreSqlRowsRlsBypass"],
        permissions: ["isolated_store.read", "isolated_store.rls.bypass"],
      }),
    ).toEqual([]);
  });

  it("warns when sync removes permissions that were previously granted", () => {
    const diagnostics = findGatePermissionDiagnostics({
      usedOps: ["listOrgUsers"],
      permissions: ["org.members.read"],
      previousPermissions: ["health.read", "org.members.read"],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("will remove permission(s)");
    expect(diagnostics[0]).toContain("health.read");
  });
});
