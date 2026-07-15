import { describe, it, expect } from "bun:test";
import {
  buildSyncedBackendOnlyGatePermissions,
  declareStorePermissionsBackendOnly,
  findUnknownGatePermissions,
  isBackendOnlyGatePermissionsDeclared,
  isStoreGatePermission,
  mergeFeaturePermissions,
  parsePermissions,
  parsePrincipals,
  readBackendOnlyGatePermissionsFromManifest,
  splitGatePermissionStrings,
  withTrustedRuntimeContextDelegatePermission,
} from "../lib/permissions.ts";

// ---------------------------------------------------------------------------
// parsePrincipals
// ---------------------------------------------------------------------------

describe("parsePrincipals", () => {
  describe("empty input", () => {
    it("returns [] for empty string", () => {
      expect(parsePrincipals("")).toEqual([]);
    });

    it("returns [] for whitespace-only string", () => {
      expect(parsePrincipals("   ")).toEqual([]);
    });
  });

  describe("visitor", () => {
    it("parses bare 'visitor' with default id 0", () => {
      expect(parsePrincipals("visitor")).toEqual([{ type: "visitor", id: "0" }]);
    });

    it("parses 'visitor:0' explicitly", () => {
      expect(parsePrincipals("visitor:0")).toEqual([{ type: "visitor", id: "0" }]);
    });

    it("accepts any id for visitor", () => {
      expect(parsePrincipals("visitor:abc")).toEqual([{ type: "visitor", id: "abc" }]);
    });

    it("trims whitespace around visitor", () => {
      expect(parsePrincipals("  visitor  ")).toEqual([{ type: "visitor", id: "0" }]);
    });
  });

  describe("orgRole", () => {
    const validRoles = ["guest", "client", "member", "manager", "owner"];

    for (const role of validRoles) {
      it(`parses orgRole:${role}`, () => {
        expect(parsePrincipals(`orgRole:${role}`)).toEqual([{ type: "orgRole", id: role }]);
      });
    }

    it("rejects unknown orgRole id", () => {
      expect(() => parsePrincipals("orgRole:admin")).toThrow(/Invalid orgRole id/);
    });

    it("rejects empty orgRole id", () => {
      expect(() => parsePrincipals("orgRole:")).toThrow(/Invalid orgRole id/);
    });
  });

  describe("multiple principals", () => {
    it("parses visitor and orgRole:member", () => {
      expect(parsePrincipals("visitor,orgRole:member")).toEqual([
        { type: "visitor", id: "0" },
        { type: "orgRole", id: "member" },
      ]);
    });

    it("parses three principals", () => {
      expect(parsePrincipals("visitor,orgRole:member,orgRole:guest")).toEqual([
        { type: "visitor", id: "0" },
        { type: "orgRole", id: "member" },
        { type: "orgRole", id: "guest" },
      ]);
    });

    it("trims whitespace around commas", () => {
      expect(parsePrincipals("visitor , orgRole:owner")).toEqual([
        { type: "visitor", id: "0" },
        { type: "orgRole", id: "owner" },
      ]);
    });
  });

  describe("invalid input", () => {
    it("rejects unknown type without colon", () => {
      expect(() => parsePrincipals("admin")).toThrow(/Invalid principal/);
    });

    it("rejects unknown type with colon", () => {
      expect(() => parsePrincipals("user:123")).toThrow(/Invalid principal type/);
    });
  });
});

// ---------------------------------------------------------------------------
// parsePermissions
// ---------------------------------------------------------------------------

describe("parsePermissions", () => {
  describe("valid input", () => {
    it("parses a single read permission", () => {
      const result = parsePermissions("dashboardView.dash123:view456.read");
      expect(result).toEqual({
        items: [
          {
            type: "dashboardView",
            resource: { dashboardId: "dash123", viewId: "view456" },
            privileges: ["read"],
          },
        ],
      });
    });

    it("parses a single read,write permission", () => {
      const result = parsePermissions("dashboardView.dash123:view456.read,write");
      const [item] = result.items;
      expect(item?.privileges).toEqual(["read", "write"]);
    });

    it("parses multiple permissions separated by semicolons", () => {
      const result = parsePermissions(
        "dashboardView.dash1:view1.read;dashboardView.dash2:view2.read,write"
      );
      expect(result.items).toHaveLength(2);
      const [first, second] = result.items;
      expect(first?.resource).toEqual({ dashboardId: "dash1", viewId: "view1" });
      expect(second?.resource).toEqual({ dashboardId: "dash2", viewId: "view2" });
      expect(second?.privileges).toEqual(["read", "write"]);
    });

    it("ignores trailing semicolons", () => {
      const result = parsePermissions("dashboardView.dash1:view1.read;");
      expect(result.items).toHaveLength(1);
    });

    it("normalises privilege casing to lowercase", () => {
      const result = parsePermissions("dashboardView.d:v.READ,WRITE");
      const [item] = result.items;
      expect(item?.privileges).toEqual(["read", "write"]);
    });

    it("parses database permission by id", () => {
      const result = parsePermissions("database.id:db123.read,write");
      expect(result).toEqual({
        items: [
          {
            type: "database",
            resource: { databaseId: "db123" },
            privileges: ["read", "write"],
          },
        ],
      });
    });

    it("parses database permission by alias", () => {
      const result = parsePermissions("database.alias:customers.read");
      expect(result).toEqual({
        items: [
          {
            type: "database",
            resource: { databaseAlias: "customers" },
            privileges: ["read"],
          },
        ],
      });
    });

    it("parses mixed dashboard and database permissions", () => {
      const result = parsePermissions(
        "dashboardView.dash1:view1.read;database.id:db1.write",
      );
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        type: "dashboardView",
        resource: { dashboardId: "dash1", viewId: "view1" },
        privileges: ["read"],
      });
      expect(result.items[1]).toEqual({
        type: "database",
        resource: { databaseId: "db1" },
        privileges: ["write"],
      });
    });
  });

  describe("invalid input", () => {
    it("throws on too few segments (no dot separators)", () => {
      expect(() => parsePermissions("dashboardView")).toThrow(/Invalid permission format/);
    });

    it("throws on wrong permission type", () => {
      expect(() => parsePermissions("unknownType.dash:view.read")).toThrow(
        /Invalid permission type/
      );
    });

    it("throws when dashboardId is missing", () => {
      expect(() => parsePermissions("dashboardView.:view.read")).toThrow();
    });

    it("throws when viewId is missing", () => {
      expect(() => parsePermissions("dashboardView.dash:.read")).toThrow();
    });

    it("throws on invalid privilege", () => {
      expect(() => parsePermissions("dashboardView.d:v.execute")).toThrow(
        /Invalid privilege/
      );
    });

    it("throws when no privileges provided", () => {
      expect(() => parsePermissions("dashboardView.d:v.")).toThrow();
    });

    it("throws when resource has no colon separator", () => {
      expect(() => parsePermissions("dashboardView.dashview.read")).toThrow(
        /Expected "dashboardId:viewId"/
      );
    });

    it("throws on unsupported database selector", () => {
      expect(() => parsePermissions("database.name:customers.read")).toThrow(
        /Invalid database resource selector/
      );
    });

    it("throws when database identifier is empty", () => {
      expect(() => parsePermissions("database.id:.read")).toThrow(
        /Database identifier cannot be empty/
      );
    });
  });
});

describe("mergeFeaturePermissions", () => {
  it("merges manual resource permissions with local gate permissions", () => {
    const result = mergeFeaturePermissions({
      manualPermissions: parsePermissions("dashboardView.dash1:view1.read;database.id:db1.write"),
      gatePermissions: ["token.write", "org.members.read"],
    });

    expect(result).toEqual({
      items: [
        {
          type: "dashboardView",
          resource: { dashboardId: "dash1", viewId: "view1" },
          privileges: ["read"],
        },
        {
          type: "database",
          resource: { databaseId: "db1" },
          privileges: ["write"],
        },
        {
          type: "gate",
          privileges: ["org.members.read", "token.write"],
        },
      ],
    });
  });

  it("preserves existing gate permissions when no local gate snapshot is available", () => {
    const result = mergeFeaturePermissions({
      manualPermissions: parsePermissions("dashboardView.dash1:view1.read"),
      existingPermissions: {
        items: [
          {
            type: "gate",
            privileges: ["token.read"],
          },
        ],
      },
    });

    expect(result).toEqual({
      items: [
        {
          type: "dashboardView",
          resource: { dashboardId: "dash1", viewId: "view1" },
          privileges: ["read"],
        },
        {
          type: "gate",
          privileges: ["token.read"],
        },
      ],
    });
  });

  it("preserves existing resource permissions when syncing only gate permissions", () => {
    const result = mergeFeaturePermissions({
      existingPermissions: {
        items: [
          {
            type: "dashboardView",
            resource: { dashboardId: "dash1", viewId: "view1" },
            privileges: ["read"],
          },
          {
            type: "database",
            resource: { databaseId: "db1" },
            privileges: ["write"],
          },
          {
            type: "gate",
            privileges: ["token.read"],
          },
        ],
      },
      gatePermissions: ["org.members.read"],
    });

    expect(result).toEqual({
      items: [
        {
          type: "dashboardView",
          resource: { dashboardId: "dash1", viewId: "view1" },
          privileges: ["read"],
        },
        {
          type: "database",
          resource: { databaseId: "db1" },
          privileges: ["write"],
        },
        {
          type: "gate",
          privileges: ["org.members.read"],
        },
      ],
    });
  });

  it("clears existing gate permissions when local snapshot resolves to an empty set", () => {
    const result = mergeFeaturePermissions({
      existingPermissions: {
        items: [
          {
            type: "dashboardView",
            resource: { dashboardId: "dash1", viewId: "view1" },
            privileges: ["read"],
          },
          {
            type: "gate",
            privileges: ["token.read"],
          },
        ],
      },
      gatePermissions: [],
    });

    expect(result).toEqual({
      items: [
        {
          type: "dashboardView",
          resource: { dashboardId: "dash1", viewId: "view1" },
          privileges: ["read"],
        },
      ],
    });
  });
});

describe("splitGatePermissionStrings", () => {
  it("routes delegate and bypass into backend-only permissions", () => {
    expect(
      splitGatePermissionStrings([
        "isolated_store.read",
        "isolated_store.rls.delegate",
        "isolated_store.rls.bypass",
      ]),
    ).toEqual({
      runtimePermissions: ["isolated_store.read"],
      backendOnlyPermissions: [
        "isolated_store.rls.bypass",
        "isolated_store.rls.delegate",
      ],
    });
  });
});

describe("isStoreGatePermission", () => {
  it("matches isolated_store.* permissions", () => {
    expect(isStoreGatePermission("isolated_store.read")).toBe(true);
    expect(isStoreGatePermission("isolated_store.data.write")).toBe(true);
    expect(isStoreGatePermission("org.groups.write")).toBe(false);
    expect(isStoreGatePermission("files.write")).toBe(false);
  });
});

describe("declareStorePermissionsBackendOnly", () => {
  it("moves store permissions into backend-only, keeps non-store runtime", () => {
    expect(
      declareStorePermissionsBackendOnly([
        "isolated_store.read",
        "isolated_store.data.write",
        "org.groups.write",
        "files.write",
      ]),
    ).toEqual({
      runtimePermissions: ["files.write", "org.groups.write"],
      backendOnlyPermissions: [
        "isolated_store.data.write",
        "isolated_store.read",
      ],
    });
  });

  it("returns empty backend-only when there are no store permissions", () => {
    expect(declareStorePermissionsBackendOnly(["org.groups.write"])).toEqual({
      runtimePermissions: ["org.groups.write"],
      backendOnlyPermissions: [],
    });
  });
});

describe("buildSyncedBackendOnlyGatePermissions", () => {
  it("merges platform-fixed, declared store, and fusebase.json extras", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: ["isolated_store.rls.delegate"],
        declaredStoreBackendOnly: ["isolated_store.read"],
        fromFusebaseJson: ["org.members.read", "portals.read"],
        fromRemoteManifest: ["org.groups.write"],
      }),
    ).toEqual([
      "isolated_store.read",
      "isolated_store.rls.delegate",
      "org.members.read",
      "portals.read",
    ]);
  });

  it("falls back to remote manifest extras when fusebase.json list is empty", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: ["isolated_store.data.write"],
        fromFusebaseJson: [],
        fromRemoteManifest: ["org.groups.write", "files.write"],
      }),
    ).toEqual([
      "files.write",
      "isolated_store.data.write",
      "org.groups.write",
    ]);
  });

  it("prefers fusebase.json over remote manifest for extras", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: [],
        fromFusebaseJson: ["org.members.read"],
        fromRemoteManifest: ["org.groups.write"],
      }),
    ).toEqual(["org.members.read"]);
  });

  it("clears extras when fusebase.json declares an empty list (no remote resurrection)", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: [],
        fromFusebaseJson: [],
        fusebaseJsonDeclared: true,
        fromRemoteManifest: ["org.groups.write", "files.write"],
      }),
    ).toEqual([]);
  });

  it("keeps platform-fixed/declared-store even when fusebase.json clears extras", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: ["isolated_store.rls.delegate"],
        declaredStoreBackendOnly: ["isolated_store.read"],
        fromFusebaseJson: [],
        fusebaseJsonDeclared: true,
        fromRemoteManifest: ["org.groups.write"],
      }),
    ).toEqual(["isolated_store.read", "isolated_store.rls.delegate"]);
  });

  it("falls back to remote manifest when the field is absent (not declared)", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: [],
        fromFusebaseJson: [],
        fusebaseJsonDeclared: false,
        fromRemoteManifest: ["org.groups.write"],
      }),
    ).toEqual(["org.groups.write"]);
  });
});

describe("findUnknownGatePermissions", () => {
  it("returns [] for known Gate permissions", () => {
    expect(
      findUnknownGatePermissions([
        "org.members.read",
        "portals.read",
        "isolated_store.read",
        "isolated_store.rls.delegate",
        "files.write",
      ]),
    ).toEqual([]);
  });

  it("returns the unknown entries", () => {
    expect(
      findUnknownGatePermissions([
        "org.members.read",
        "not_a_real_permission.bogus.write",
      ]),
    ).toEqual(["not_a_real_permission.bogus.write"]);
  });
});

describe("buildSyncedBackendOnlyGatePermissions validation", () => {
  it("throws on a bogus fusebase.json extra", () => {
    expect(() =>
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: [],
        fromFusebaseJson: ["not_a_real_permission.bogus.write"],
        fromRemoteManifest: [],
      }),
    ).toThrow(/not_a_real_permission\.bogus\.write/);
  });

  it("throws on a bogus remote-manifest fallback extra", () => {
    expect(() =>
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: [],
        fromFusebaseJson: [],
        fromRemoteManifest: ["totally.made.up"],
      }),
    ).toThrow(/totally\.made\.up/);
  });

  it("accepts valid non-store extras", () => {
    expect(
      buildSyncedBackendOnlyGatePermissions({
        platformBackendOnly: [],
        declaredStoreBackendOnly: [],
        fromFusebaseJson: ["org.members.read", "portals.read"],
        fromRemoteManifest: [],
      }),
    ).toEqual(["org.members.read", "portals.read"]);
  });
});

describe("isBackendOnlyGatePermissionsDeclared", () => {
  it("is true for a present array (even empty)", () => {
    expect(isBackendOnlyGatePermissionsDeclared({ backendOnlyGatePermissions: [] })).toBe(true);
    expect(
      isBackendOnlyGatePermissionsDeclared({ backendOnlyGatePermissions: ["org.members.read"] }),
    ).toBe(true);
  });

  it("is false when the field is absent or not an array", () => {
    expect(isBackendOnlyGatePermissionsDeclared({})).toBe(false);
    expect(
      isBackendOnlyGatePermissionsDeclared({ backendOnlyGatePermissions: "org.members.read" as unknown }),
    ).toBe(false);
  });
});

describe("readBackendOnlyGatePermissionsFromManifest", () => {
  it("reads and normalizes manifest.backendOnlyGatePermissions", () => {
    expect(
      readBackendOnlyGatePermissionsFromManifest({
        backendOnlyGatePermissions: ["portals.read", "org.members.read", "portals.read"],
      }),
    ).toEqual(["org.members.read", "portals.read"]);
  });
});

describe("withTrustedRuntimeContextDelegatePermission", () => {
  it("adds isolated_store.rls.delegate when trustedRuntimeContext is used", () => {
    expect(
      withTrustedRuntimeContextDelegatePermission(
        ["isolated_store.read"],
        true,
      ),
    ).toEqual(["isolated_store.read", "isolated_store.rls.delegate"]);
  });

  it("leaves permissions unchanged when trustedRuntimeContext is not used", () => {
    expect(
      withTrustedRuntimeContextDelegatePermission(
        ["isolated_store.read"],
        false,
      ),
    ).toEqual(["isolated_store.read"]);
  });
});
