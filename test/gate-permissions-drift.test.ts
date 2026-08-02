import { describe, expect, it } from "bun:test";
import { buildGateSdkOperationsSnapshot } from "../lib/config.ts";
import {
  diffSortedStringSets,
  extractPublishedGateRuntimePermissions,
  formatGatePermissionsDriftLines,
  gatePermissionSetsEqual,
  sortedUniqueStrings,
  type GatePermissionsDrift,
} from "../lib/gate-permissions-drift.ts";
import type { App } from "../lib/api.ts";

describe("gate-permissions-drift", () => {
  it("diffSortedStringSets reports added and removed values", () => {
    expect(diffSortedStringSets(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });

  it("extractPublishedGateRuntimePermissions reads gate privileges", () => {
    const app = {
      id: "app1",
      permissions: {
        items: [
          { type: "gate", privileges: ["portals.read", "org.read"] },
          { type: "dashboardView", resource: { dashboardId: "d", viewId: "v" }, privileges: ["read"] },
        ],
      },
    } as App;

    expect(extractPublishedGateRuntimePermissions(app)).toEqual([
      "org.read",
      "portals.read",
    ]);
  });

  it("gatePermissionSetsEqual compares sorted unique sets", () => {
    expect(gatePermissionSetsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(gatePermissionSetsEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("sortedUniqueStrings trims, dedupes, and sorts", () => {
    expect(sortedUniqueStrings([" b ", "a", "b", ""])).toEqual(["a", "b"]);
  });

  it("buildGateSdkOperationsSnapshot drops stale permissions only when pruning", () => {
    const prev = {
      sdkVersion: "2.3.28-sdk.3",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      usedOpsChangedAt: "2026-01-01T00:00:00.000Z",
      usedOps: ["listOrgUsers"],
      permissions: ["org.read"],
    };
    const input = {
      analyzedAt: "2026-06-01T00:00:00.000Z",
      usedOps: ["listOrgUsers"],
      sdkVersion: "2.3.28-sdk.3",
    };

    expect(
      buildGateSdkOperationsSnapshot(prev, input, { prunePermissions: true }).permissions,
    ).toBeUndefined();
    // Default is merge (NIM-42739): the drift check re-resolves on top of the stored set
    // instead of expecting a set that would delete hand-declared grants once synced.
    expect(buildGateSdkOperationsSnapshot(prev, input).permissions).toEqual(["org.read"]);
  });

  it("formatGatePermissionsDriftLines includes platform and local meta deltas", () => {
    const drift: GatePermissionsDrift = {
      appId: "vilb35plotkcwg4g",
      featureTitle: "rls-demo",
      path: "apps/rls-demo",
      sources: ["local-meta"],
      remoteAppMissing: true,
      publishedPermissions: [],
      expectedPermissions: [
        "isolated_store.execute",
        "isolated_store.read",
        "org.members.read",
        "org.read",
      ],
      platformAddedPermissions: [],
      platformRemovedPermissions: [],
      localMetaPermissions: ["isolated_store.execute", "org.read"],
      localMetaAddedPermissions: ["isolated_store.read", "org.members.read"],
      localMetaRemovedPermissions: [],
      metaUsedOps: ["executeIsolatedStoreSql", "listOrgUsers", "queryIsolatedStoreSql"],
      expectedUsedOps: [
        "executeIsolatedStoreSql",
        "getMyOrgAccess",
        "listOrgUsers",
        "queryIsolatedStoreSql",
      ],
      previousSdkVersion: "2.3.28-sdk.3",
      currentSdkVersion: "2.3.28-sdk.3",
    };

    const text = formatGatePermissionsDriftLines(drift).join("\n");
    expect(text).toContain("fusebaseGateMeta + isolated_store.read");
    expect(text).toContain("platform: app not found");
    expect(text).toContain("+ getMyOrgAccess");
  });
});
