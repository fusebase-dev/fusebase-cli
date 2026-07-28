import { describe, expect, it, mock } from "bun:test";
import type { AppPermissions } from "../lib/api.ts";

// NIM-42264: `app update --sync-gate-permissions` must strip declared
// backend-only perms from the browser runtime set — the QA-tested path had its
// own sync logic and missed the subtraction that lib/sync-app-gate-permissions
// already did.
const updateCalls: Record<string, unknown>[] = [];
const permissionsWriteBacks: { appId: string; permissions: AppPermissions }[] = [];
let localApp: Record<string, unknown> = {
  id: "app-1",
  path: "apps/x",
  backendOnlyGatePermissions: ["portals.read", "org.members.read"],
};

let remotePermissions: AppPermissions | undefined;

mock.module("../lib/api.ts", () => ({
  fetchApps: async () => ({
    apps: [{ id: "app-1", title: "App 1", permissions: remotePermissions, manifest: {} }],
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
  loadFuseConfig: () => ({ orgId: "o1", productId: "p1", apps: [localApp] }),
  writeBackendOnlyGatePermissionsToFusebaseJson: () => {},
  writeAppPermissionsToFusebaseJson: (
    _projectRoot: string,
    appId: string,
    permissions: AppPermissions,
  ) => {
    permissionsWriteBacks.push({ appId, permissions });
  },
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

// NIM-42737: a hand-granted privilege that only reaches the remote app record is reverted by
// the next `fusebase deploy` — reconcile rebuilds the permission set from fusebase.json alone.
describe("runAppUpdate --permissions persists the grant into fusebase.json", () => {
  const gatePrivileges = (permissions: AppPermissions): string[] =>
    permissions.items.find((item) => item.type === "gate")?.privileges ?? [];

  it("writes the granted capability back to the local app entry", async () => {
    localApp = { id: "app-1", path: "apps/x" };
    await runAppUpdate("app-1", { permissions: "app_api.analytics.vse_usage.read" });

    const written = permissionsWriteBacks.at(-1)!;
    expect(written.appId).toBe("app-1");
    expect(gatePrivileges(written.permissions)).toEqual(["app_api.analytics.vse_usage.read"]);
  });

  it("unions with privileges already declared locally", async () => {
    localApp = {
      id: "app-1",
      path: "apps/x",
      permissions: { items: [{ type: "gate", privileges: ["org.members.read"] }] },
    };
    await runAppUpdate("app-1", { permissions: "app_api.tenancy.invite_claim.write" });

    expect(gatePrivileges(permissionsWriteBacks.at(-1)!.permissions)).toEqual([
      "app_api.tenancy.invite_claim.write",
      "org.members.read",
    ]);
  });

  it("keeps remote-only permissions so the next deploy cannot narrow the app", async () => {
    localApp = { id: "app-1", path: "apps/x" };
    remotePermissions = {
      items: [
        {
          type: "dashboardView",
          resource: { dashboardId: "d1", viewId: "v1" },
          privileges: ["read"],
        },
      ],
    };
    await runAppUpdate("app-1", { permissions: "app_api.analytics.vse_usage.read" });
    remotePermissions = undefined;

    // Writing only the hand-granted item would make deploy PATCH the dashboard grant away:
    // reconcile sends the local set verbatim and the remote entry is not mirrored anywhere.
    const written = permissionsWriteBacks.at(-1)!.permissions;
    expect(written.items.map((item) => item.type).sort()).toEqual(["dashboardView", "gate"]);
  });

  it("does not write when the app is not declared in this project", async () => {
    localApp = { id: "other-app", path: "apps/y" };
    const before = permissionsWriteBacks.length;
    await runAppUpdate("app-1", { permissions: "app_api.analytics.vse_usage.read" });

    expect(permissionsWriteBacks.length).toBe(before);
  });
});
