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
});
