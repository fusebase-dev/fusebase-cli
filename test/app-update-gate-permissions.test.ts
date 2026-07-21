import { describe, expect, it, mock } from "bun:test";

// NIM-42264: `app update --sync-gate-permissions` must strip declared
// backend-only perms from the browser runtime set — the QA-tested path had its
// own sync logic and missed the subtraction that lib/sync-app-gate-permissions
// already did.
const updateCalls: Record<string, unknown>[] = [];

mock.module("../lib/api.ts", () => ({
  fetchApps: async () => ({
    apps: [{ id: "app-1", title: "App 1", permissions: undefined, manifest: {} }],
  }),
  updateApp: async (
    _apiKey: string,
    _orgId: string,
    _productId: string,
    _appId: string,
    request: Record<string, unknown>,
  ) => {
    updateCalls.push(request);
    return { id: "app-1", title: "App 1" };
  },
}));

mock.module("../lib/config.ts", () => ({
  getConfig: () => ({ apiKey: "key" }),
  loadFuseConfig: () => ({
    orgId: "o1",
    productId: "p1",
    apps: [
      {
        id: "app-1",
        path: "apps/x",
        backendOnlyGatePermissions: ["portals.read", "org.members.read"],
      },
    ],
  }),
  writeBackendOnlyGatePermissionsToFusebaseJson: () => {},
}));

mock.module("../lib/gate-sdk-analyze.ts", () => ({
  analyzeFeatureGatePermissions: async () => ({
    gatePermissions: ["portals.read", "org.read", "files.write"],
  }),
}));

const { runAppUpdate } = await import("../lib/commands/app-update.ts");

describe("runAppUpdate --sync-gate-permissions", () => {
  it("subtracts declared backend-only perms from the published gate set", async () => {
    await runAppUpdate("app-1", { syncGatePermissions: true });

    const request = updateCalls.at(-1)!;
    const permissions = request.permissions as { items: { type: string; privileges: string[] }[] };
    const gateItem = permissions.items.find((item) => item.type === "gate")!;

    expect(gateItem.privileges).toEqual(["files.write", "org.read"]);
    expect(
      (request.manifest as { backendOnlyGatePermissions: string[] }).backendOnlyGatePermissions,
    ).toContain("portals.read");
  });
});
