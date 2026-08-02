import { describe, expect, it, mock } from "bun:test";
import type { AppPermissions } from "../lib/api.ts";

// NIM-42739: `--sync-gate-permissions` rebuilt the gate item from static analysis alone,
// so every privilege the analyzer cannot infer was deleted on an exit-0 sync (prod lost
// `app_magic_link.write` and `app_api.tenancy.membership.read` this way).
const updateCalls: Record<string, unknown>[] = [];
const permissionsWriteBacks: { appId: string; permissions: AppPermissions }[] = [];
const analyzeCalls: Record<string, unknown>[] = [];

let localApp: Record<string, unknown> = { id: "app-1", path: "apps/x" };
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
  analyzeFeatureGatePermissions: async (args: Record<string, unknown>) => {
    analyzeCalls.push(args);
    return { gatePermissions: ["org.read", "token.read"] };
  },
}));

const { runAppUpdate } = await import("../lib/commands/app-update.ts");

function gatePrivileges(request: Record<string, unknown>): string[] {
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

    expect(gatePrivileges(updateCalls.at(-1)!)).toEqual([
      "app_api.tenancy.membership.read",
      "app_magic_link.write",
      "org.read",
      "token.read",
    ]);
  });

  it("does not resurrect a privilege that moved to the backend-only manifest", async () => {
    reset();
    localApp = { id: "app-1", path: "apps/x", backendOnlyGatePermissions: ["portals.read"] };
    remotePermissions = { items: [{ type: "gate", privileges: ["portals.read"] }] };

    await runAppUpdate("app-1", { syncGatePermissions: true });

    expect(gatePrivileges(updateCalls.at(-1)!)).toEqual(["org.read", "token.read"]);
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

    expect(gatePrivileges(updateCalls.at(-1)!)).toEqual(["org.read", "token.read"]);
    // Otherwise deploy reconcile re-grants it from fusebase.json on the next deploy.
    expect(permissionsWriteBacks.at(-1)!.permissions.items).toEqual([]);
    expect(analyzeCalls.at(-1)!.prunePermissions).toBe(true);
  });
});
