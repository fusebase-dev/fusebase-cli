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
  requireAppId: (app: { id?: string }) => {
    if (!app.id) throw new Error("missing id");
    return app.id;
  },
  resolveLocalAppFromFuseConfig: (
    fuseConfig: { apps?: Record<string, unknown>[] },
    appRef: string,
  ) => {
    const apps = fuseConfig.apps ?? [];
    const match =
      apps.find((app) => app.id === appRef) ??
      apps.find(
        (app) =>
          app.key === appRef || app.path === appRef || app.subdomain === appRef,
      );
    if (!match) throw new Error(`App "${appRef}" not found in fusebase.json`);
    return match;
  },
  writeBackendOnlyGatePermissionsToFusebaseJson: () => {},
  writeAppPermissionsToFusebaseJson: (
    _projectRoot: string,
    appId: string,
    permissions: AppPermissions,
  ) => {
    permissionsWriteBacks.push({ appId, permissions });
  },
}));

const analyzeCalls: Record<string, unknown>[] = [];

mock.module("../lib/gate-sdk-analyze.ts", () => ({
  analyzeFeatureGatePermissions: async (args: Record<string, unknown>) => {
    analyzeCalls.push(args);
    return { gatePermissions: ["portals.read", "org.read", "files.write"] };
  },
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

  it("keeps remote-only gate privileges so the first grant cannot revoke them", async () => {
    localApp = { id: "app-1", path: "apps/x" };
    remotePermissions = {
      items: [{ type: "gate", privileges: ["org.members.read", "token.read"] }],
    };
    await runAppUpdate("app-1", { permissions: "app_api.analytics.vse_usage.read" });
    remotePermissions = undefined;

    expect(gatePrivileges(permissionsWriteBacks.at(-1)!.permissions)).toEqual([
      "app_api.analytics.vse_usage.read",
      "org.members.read",
      "token.read",
    ]);
  });

  it("leaves analyzed privileges to fusebaseGateMeta so sync can still prune them", async () => {
    localApp = {
      id: "app-1",
      path: "apps/x",
      fusebaseGateMeta: { permissions: ["token.read"] },
    };
    remotePermissions = {
      items: [{ type: "gate", privileges: ["org.members.read", "token.read"] }],
    };
    await runAppUpdate("app-1", { permissions: "app_api.analytics.vse_usage.read" });
    remotePermissions = undefined;

    expect(gatePrivileges(permissionsWriteBacks.at(-1)!.permissions)).toEqual([
      "app_api.analytics.vse_usage.read",
      "org.members.read",
    ]);
  });

  it("does not write when the app is not declared in this project", async () => {
    localApp = { id: "other-app", path: "apps/y" };
    const before = permissionsWriteBacks.length;
    await runAppUpdate("app-1", { permissions: "app_api.analytics.vse_usage.read" });

    expect(permissionsWriteBacks.length).toBe(before);
  });
});

function syncedGatePrivileges(request: Record<string, unknown>): string[] {
  const permissions = request.permissions as {
    items: { type: string; resource?: unknown; privileges: string[] }[];
  };
  return permissions.items.find((item) => item.type === "gate" && !item.resource)!.privileges;
}

function reset(): void {
  updateCalls.length = 0;
  permissionsWriteBacks.length = 0;
  analyzeCalls.length = 0;
  localApp = { id: "app-1", path: "apps/x" };
  remotePermissions = undefined;
}

describe("--sync-gate-permissions merges by default", () => {
  it("keeps a hand-granted privilege the analyzer cannot see, and adds the new ops", async () => {
    reset();
    remotePermissions = {
      items: [
        {
          type: "gate",
          privileges: ["app_api.tenancy.membership.read", "app_magic_link.write"],
        },
      ],
    };

    await runAppUpdate("app-1", { syncGatePermissions: true });

    expect(syncedGatePrivileges(updateCalls.at(-1)!)).toEqual([
      "app_api.tenancy.membership.read",
      "app_magic_link.write",
      "files.write",
      "org.read",
      "portals.read",
    ]);
  });

  it("does not resurrect a privilege that moved to the backend-only manifest", async () => {
    reset();
    localApp = { id: "app-1", path: "apps/x", backendOnlyGatePermissions: ["portals.read"] };
    remotePermissions = { items: [{ type: "gate", privileges: ["portals.read"] }] };

    await runAppUpdate("app-1", { syncGatePermissions: true });

    expect(syncedGatePrivileges(updateCalls.at(-1)!)).toEqual(["files.write", "org.read"]);
  });

  it("preserves a resource-scoped gate item that static analysis never produces", async () => {
    reset();
    remotePermissions = {
      items: [
        { type: "gate", resource: { kind: "portal", ids: ["p1"] }, privileges: ["portals.read"] },
      ],
    };

    await runAppUpdate("app-1", { syncGatePermissions: true });

    const items = (updateCalls.at(-1)!.permissions as { items: Record<string, unknown>[] }).items;
    expect(items).toContainEqual({
      type: "gate",
      resource: { kind: "portal", ids: ["p1"] },
      privileges: ["portals.read"],
    });
  });

  it("leaves the analyze snapshot merged (no prune) so the local meta keeps its grants", async () => {
    reset();
    await runAppUpdate("app-1", { syncGatePermissions: true });

    expect(analyzeCalls.at(-1)!.prunePermissions).toBeFalsy();
  });
});

describe("--prune-gate-permissions is the explicit revoke path", () => {
  it("removes the extras, prunes fusebase.json and prunes the analyze snapshot", async () => {
    reset();
    remotePermissions = {
      items: [{ type: "gate", privileges: ["app_api.tenancy.membership.read", "org.read"] }],
    };
    localApp = {
      id: "app-1",
      path: "apps/x",
      permissions: {
        items: [{ type: "gate", privileges: ["app_api.tenancy.membership.read"] }],
      },
    };

    await runAppUpdate("app-1", {
      syncGatePermissions: true,
      pruneGatePermissions: true,
    });

    expect(syncedGatePrivileges(updateCalls.at(-1)!)).toEqual([
      "files.write",
      "org.read",
      "portals.read",
    ]);
    // Otherwise deploy reconcile re-grants it from fusebase.json on the next deploy.
    expect(permissionsWriteBacks.at(-1)!.permissions.items).toEqual([]);
    expect(analyzeCalls.at(-1)!.prunePermissions).toBe(true);
  });

  it("prunes a privilege that exists only in the local apps[] entry", async () => {
    reset();
    remotePermissions = { items: [{ type: "gate", privileges: ["org.read"] }] };
    localApp = {
      id: "app-1",
      path: "apps/x",
      permissions: {
        items: [{ type: "gate", privileges: ["app_magic_link.write"] }],
      },
    };

    await runAppUpdate("app-1", {
      syncGatePermissions: true,
      pruneGatePermissions: true,
    });

    // Reading only the remote record reported "nothing to prune" and left this behind,
    // so the next deploy re-granted it from fusebase.json.
    expect(permissionsWriteBacks.at(-1)!.permissions.items).toEqual([]);
  });
});
