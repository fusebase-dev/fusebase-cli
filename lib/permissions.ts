import type {
  AppAccessPrincipal,
  AppAccessPrincipalType,
  AppGatePermissionItem,
  AppPermissionItem,
  AppPermissions,
  AppResourcePermissionPrivilege,
} from "./api.ts";

const VALID_ORG_ROLES = ['guest', 'client', 'member', 'manager', 'owner'];
const VALID_RESOURCE_PRIVILEGES: AppResourcePermissionPrivilege[] = ["read", "write"];

const RESOURCE_PERMISSION_TYPES = ["dashboardView", "database"];

/**
 * Gate privilege string accepted by `--permissions` (NIM-42737). Deliberately the
 * intersection of what nimbus-ai stores and what Gate can mint into a token, so a
 * grant that would be silently dropped at mint is rejected here instead.
 * Covers both 2-segment built-ins (`notes.read`) and app API capabilities
 * (`app_api.<namespace>.<capability>.<action>`).
 */
const GATE_PRIVILEGE_PATTERN =
  /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*\.(?:read|write|delete|execute|create|manage|delegate|bypass)$/;

// Portal-scoped, context-relative principals. They match against the portal the
// app is embedded in (the platform resolves them from the verified portal context),
// so they take no id. Outside a portal they never match.
const PORTAL_PRINCIPALS: Record<string, AppAccessPrincipalType> = {
  portalmember: 'portalMember',
  portalmanager: 'portalManager',
  portalclient: 'portalClient',
};

/**
 * Parse access principals string into AppAccessPrincipal array.
 * Format: comma-separated list of "type" or "type:id"
 * Examples:
 *   "visitor" → [{ type: "visitor", id: "0" }]
 *   "orgRole:member" → [{ type: "orgRole", id: "member" }]
 *   "portalClient" → [{ type: "portalClient", id: "" }]
 *   "visitor,orgRole:member,orgRole:guest" → [visitor, member, guest]
 */
export function parsePrincipals(input: string): AppAccessPrincipal[] {
  if (!input.trim()) return [];

  const parts = input.split(',').map(p => p.trim()).filter(p => p);
  const principals: AppAccessPrincipal[] = [];

  for (const part of parts) {
    const colonIdx = part.indexOf(':');

    if (colonIdx === -1) {
      const type = part.toLowerCase();
      if (type === 'visitor') {
        principals.push({ type: 'visitor', id: '0' });
      } else if (PORTAL_PRINCIPALS[type]) {
        principals.push({ type: PORTAL_PRINCIPALS[type], id: '' });
      } else {
        throw new Error(`Invalid principal "${part}". Use "visitor", "orgRole:<id>", or a portal principal (${Object.values(PORTAL_PRINCIPALS).join(', ')}). Valid orgRole ids: ${VALID_ORG_ROLES.join(', ')}`);
      }
    } else {
      const type = part.substring(0, colonIdx).trim().toLowerCase();
      const id = part.substring(colonIdx + 1).trim();

      if (type === 'visitor') {
        principals.push({ type: 'visitor', id: id || '0' });
      } else if (type === 'orgrole') {
        if (!VALID_ORG_ROLES.includes(id)) {
          throw new Error(`Invalid orgRole id "${id}". Valid ids: ${VALID_ORG_ROLES.join(', ')}`);
        }
        principals.push({ type: 'orgRole', id });
      } else if (PORTAL_PRINCIPALS[type]) {
        // Portal principals are context-relative and take no id.
        throw new Error(`Portal principal "${PORTAL_PRINCIPALS[type]}" does not accept an id. Use it bare, e.g. "${PORTAL_PRINCIPALS[type]}".`);
      } else {
        throw new Error(`Invalid principal type "${type}". Valid types: visitor, orgRole, ${Object.values(PORTAL_PRINCIPALS).join(', ')}`);
      }
    }
  }

  return principals;
}

/**
 * Parse permissions string into AppPermissions object.
 * Format:
 *   "dashboardView.dashboardId:viewId.read,write"
 *   "database.id:databaseId.read,write"
 *   "database.alias:databaseAlias.read"
 *   "app_api.analytics.vse_usage.read"   (Gate privilege, incl. app API capabilities)
 * Multiple permission items are separated by semicolons.
 * Each permission item is separated by semicolon.
 * Each item format: type.resource.privileges (privileges comma-separated)
 */
export function parsePermissions(permissionsStr: string): AppPermissions {
  const items: AppPermissionItem[] = [];
  const gatePrivileges: string[] = [];

  const parts = permissionsStr.split(';').map(p => p.trim()).filter(p => p);

  for (const part of parts) {
    const segments = part.split('.');

    // Anything that is not a dashboardView/database resource permission is read as a
    // Gate privilege string (NIM-42737) — additive, the resource DSL is unchanged.
    if (!RESOURCE_PERMISSION_TYPES.includes(segments[0]?.trim() ?? "")) {
      if (!GATE_PRIVILEGE_PATTERN.test(part)) {
        throw new Error(
          `Invalid permission type "${segments[0] ?? part}". Allowed values: ${RESOURCE_PERMISSION_TYPES.join(', ')}, ` +
            `or a Gate privilege such as "org.members.read" / "app_api.<namespace>.<capability>.<action>".`,
        );
      }
      assertGrantableGatePrivilege(part);
      gatePrivileges.push(part);
      continue;
    }

    if (segments.length < 3) {
      throw new Error(
        `Invalid permission format: "${part}". Expected "dashboardView.dashboardId:viewId.privileges" or "database.id:databaseId.privileges"`,
      );
    }

    if (!segments[0] || !segments[1] || !segments[2]) {
      throw new Error(`Invalid permission format: "${part}". None of the segments can be empty.`);
    }

    const permissionType = segments[0].trim();
    const resourceStr = segments[1].trim();
    const privilegesStr = segments.slice(2).join('.').trim();

    const privileges = privilegesStr
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p);

    for (const priv of privileges) {
      if (!VALID_RESOURCE_PRIVILEGES.includes(priv as AppResourcePermissionPrivilege)) {
        throw new Error(`Invalid privilege "${priv}". Allowed values: ${VALID_RESOURCE_PRIVILEGES.join(', ')}`);
      }
    }

    if (privileges.length === 0) {
      throw new Error(
        `Invalid permission format: "${part}". At least one privilege (${VALID_RESOURCE_PRIVILEGES.join('/')}) is required.`,
      );
    }

    if (permissionType === "dashboardView") {
      const resourceParts = resourceStr.split(':');
      if (resourceParts.length !== 2) {
        throw new Error(`Invalid resource format: "${resourceStr}". Expected "dashboardId:viewId"`);
      }

      if (!resourceParts[0] || !resourceParts[1]) {
        throw new Error(`Invalid resource format: "${resourceStr}". Dashboard ID and View ID cannot be empty.`);
      }

      const dashboardId = resourceParts[0].trim();
      const viewId = resourceParts[1].trim();

      if (!dashboardId || !viewId) {
        throw new Error(`Invalid permission format: "${part}". Dashboard ID and View ID are required.`);
      }

      items.push({
        type: "dashboardView",
        resource: { dashboardId, viewId },
        privileges: privileges as AppResourcePermissionPrivilege[],
      });
      continue;
    }

    if (permissionType === "database") {
      const resourceParts = resourceStr.split(':');
      if (resourceParts.length !== 2) {
        throw new Error(`Invalid resource format: "${resourceStr}". Expected "id:databaseId" or "alias:databaseAlias"`);
      }

      const resourceKey = resourceParts[0].trim().toLowerCase();
      const resourceValue = resourceParts[1].trim();
      if (!resourceValue) {
        throw new Error(`Invalid resource format: "${resourceStr}". Database identifier cannot be empty.`);
      }

      if (resourceKey === "id") {
        items.push({
          type: "database",
          resource: { databaseId: resourceValue },
          privileges: privileges as AppResourcePermissionPrivilege[],
        });
        continue;
      }

      if (resourceKey === "alias") {
        items.push({
          type: "database",
          resource: { databaseAlias: resourceValue },
          privileges: privileges as AppResourcePermissionPrivilege[],
        });
        continue;
      }

      throw new Error(`Invalid database resource selector "${resourceKey}". Allowed values: id, alias`);
    }
  }

  return { items: [...items, ...buildGatePermissionItems(gatePrivileges)] };
}

export const BACKEND_ONLY_GATE_PERMISSIONS = [
  "isolated_store.rls.delegate",
  "isolated_store.rls.bypass",
] as const;

/**
 * Canonical Gate permission vocabulary. Single source of truth shared with the
 * Gate MCP token policy (lib/mcp-token-policy.ts) and used to validate declared
 * `apps[].backendOnlyGatePermissions` extras on sync so bogus strings are
 * rejected instead of silently persisted to the remote manifest (NIM-42263).
 */
export const GATE_PERMISSIONS_BASE = [
  "automation.delete",
  "automation.read",
  "automation.write",
  "billing.read",
  "billing.write",
  "email.write",
  "notes.read",
  "notes.write",
  "org.groups.read",
  "org.groups.write",
  "org.members.read",
  "org.members.write",
  "org.read",
  "org.write",
  "token.delete",
  "token.read",
  "token.write",
] as const;

export const FILE_GATE_PERMISSIONS = [
  "files.read",
  "files.write",
] as const;

/**
 * App magic-link management (owner/admin invite flow). In the Gate MCP token
 * policy so IDE agents and e2e harnesses can mint sign-in links for fixture
 * users (`createAppMagicLink` returns the activation URL — no mailbox needed).
 * Deliberately NOT in the legacy fingerprint baseline: adding it bumps the
 * current policy fingerprint so existing `.env`s show STALE and refresh.
 */
export const GATE_PERMISSIONS_MAGIC_LINKS = [
  "app_magic_link.write",
] as const;

export const GATE_PERMISSIONS_ISOLATED = [
  "isolated_store.control.write",
  "isolated_store.data.write",
  "isolated_store.delete",
  "isolated_store.execute",
  "isolated_store.read",
  "isolated_store.schema.write",
] as const;

export const GATE_PERMISSIONS_PORTALS = [
  "portals.read",
  "portals.write",
  "portals.delete",
  "portals.create",
  "portals.manage",
] as const;

/** Every Gate permission the platform recognizes (superset of MCP-token + backend-only). */
export const KNOWN_GATE_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  ...GATE_PERMISSIONS_BASE,
  ...FILE_GATE_PERMISSIONS,
  ...GATE_PERMISSIONS_ISOLATED,
  ...GATE_PERMISSIONS_PORTALS,
  ...BACKEND_ONLY_GATE_PERMISSIONS,
]);

/** Return the entries that are not part of the known Gate permission vocabulary. */
export function findUnknownGatePermissions(permissions: string[]): string[] {
  return permissions.filter((permission) => !KNOWN_GATE_PERMISSIONS.has(permission));
}

/** App API capabilities are app-defined, so only their shape can be validated. */
const APP_API_PRIVILEGE_PREFIX = "app_api.";

/**
 * Real Gate permissions (`GatePermission` in fusebase-gate) that the sets above omit
 * because those feed the MCP token policy — adding to them would bump the token
 * fingerprint. They are grantable, so they belong in the `--permissions` vocabulary.
 * `app_magic_link.client_invite` is deliberately absent: its action is not one Gate can
 * mint into an app token.
 */
const GATE_PERMISSIONS_EXTRA_GRANTABLE = [
  "auth.restore_key.write",
  "automation.execute",
  "mcp_manager.auth.write",
  "mcp_manager.servers.write",
  "mcp_manager.templates.read",
  "mcp_manager.tools.execute",
  "mcp_manager.tools.read",
] as const;

/**
 * Grantable via `--permissions`: the known vocabulary plus magic links (a real grant
 * that KNOWN_GATE_PERMISSIONS omits because it is not in the legacy MCP fingerprint).
 */
const GRANTABLE_GATE_PERMISSIONS: ReadonlySet<string> = new Set<string>([
  ...KNOWN_GATE_PERMISSIONS,
  ...GATE_PERMISSIONS_MAGIC_LINKS,
  ...GATE_PERMISSIONS_EXTRA_GRANTABLE,
]);

const BACKEND_ONLY_GATE_PERMISSION_SET = new Set<string>(BACKEND_ONLY_GATE_PERMISSIONS);

/**
 * Validate a hand-granted Gate privilege (NIM-42737). Without this a typo such as
 * `org.member.read` passes the shape check, is stored by nimbus-ai (which also checks
 * shape only) and grants nothing — the CLI reporting success for a dead grant.
 */
export function assertGrantableGatePrivilege(privilege: string): void {
  if (privilege.startsWith(APP_API_PRIVILEGE_PREFIX)) {
    return;
  }

  if (BACKEND_ONLY_GATE_PERMISSION_SET.has(privilege)) {
    throw new Error(
      `Gate privilege "${privilege}" is backend-only and cannot be granted with --permissions ` +
        `(the platform rejects it in app permissions because it would ride in the browser token). ` +
        `Declare it in apps[].backendOnlyGatePermissions in fusebase.json instead.`,
    );
  }

  if (!GRANTABLE_GATE_PERMISSIONS.has(privilege)) {
    throw new Error(
      `Unknown Gate privilege "${privilege}". Use a known privilege (e.g. "org.members.read") ` +
        `or an app API capability "app_api.<namespace>.<capability>.<action>".`,
    );
  }
}

export const TRUSTED_RUNTIME_CONTEXT_DELEGATE_PERMISSION =
  "isolated_store.rls.delegate";

export function withTrustedRuntimeContextDelegatePermission(
  permissionStrings: string[],
  usesTrustedRuntimeContext: boolean,
): string[] {
  if (!usesTrustedRuntimeContext) {
    return normalizeGatePermissionStrings(permissionStrings);
  }

  return normalizeGatePermissionStrings([
    ...permissionStrings,
    TRUSTED_RUNTIME_CONTEXT_DELEGATE_PERMISSION,
  ]);
}

/**
 * App-owned store (data-plane) Gate permissions. Unlike the platform-fixed
 * delegate/bypass in BACKEND_ONLY_GATE_PERMISSIONS, these are declared as
 * backend-only per-app via the opt-in --declare-backend-only-gate-permissions.
 */
export const STORE_GATE_PERMISSION_PREFIX = "isolated_store.";

export function isStoreGatePermission(permission: string): boolean {
  return permission.startsWith(STORE_GATE_PERMISSION_PREFIX);
}

/**
 * Opt-in split (--declare-backend-only-gate-permissions): move app-owned store
 * permissions out of the browser-embedded runtime set into the backend-only
 * manifest list. Platform delegate/bypass are handled by
 * splitGatePermissionStrings and must be removed before calling this.
 */
/** Normalize a string list from fusebase.json or remote manifest. */
export function readBackendOnlyGatePermissionsList(source: unknown): string[] {
  if (!Array.isArray(source)) {
    return [];
  }
  return normalizeGatePermissionStrings(
    source.filter((entry): entry is string => typeof entry === "string"),
  );
}

export function readBackendOnlyGatePermissionsFromManifest(
  manifest: unknown,
): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [];
  }
  return readBackendOnlyGatePermissionsList(
    (manifest as Record<string, unknown>).backendOnlyGatePermissions,
  );
}

export function readBackendOnlyGatePermissionsFromFeature(feature: {
  backendOnlyGatePermissions?: unknown;
}): string[] {
  return readBackendOnlyGatePermissionsList(feature.backendOnlyGatePermissions);
}

/**
 * Whether fusebase.json declares the field at all (present as an array, even if empty).
 * A declared empty list is an explicit "clear extras" intent, distinct from an absent field.
 */
export function isBackendOnlyGatePermissionsDeclared(feature: {
  backendOnlyGatePermissions?: unknown;
}): boolean {
  return Array.isArray(feature.backendOnlyGatePermissions);
}

/** Union backend-only lists (deduped, sorted) for manifest.backendOnlyGatePermissions. */
export function mergeBackendOnlyGatePermissionLists(
  ...lists: string[][]
): string[] {
  return normalizeGatePermissionStrings(lists.flat());
}

/**
 * Build manifest.backendOnlyGatePermissions for app update sync:
 * platform-fixed split + optional store declare + fusebase.json + remote manifest extras.
 */
export function buildSyncedBackendOnlyGatePermissions(params: {
  platformBackendOnly: string[];
  declaredStoreBackendOnly?: string[];
  fromFusebaseJson: string[];
  /**
   * True when fusebase.json declares the field (present, even if empty). A declared
   * list is authoritative: an explicit empty list clears extras instead of resurrecting
   * remote-manifest ones. When absent, fall back to remote-manifest extras (legacy).
   * Defaults to `fromFusebaseJson.length > 0` for backward compatibility.
   */
  fusebaseJsonDeclared?: boolean;
  fromRemoteManifest: string[];
}): string[] {
  const {
    platformBackendOnly,
    declaredStoreBackendOnly = [],
    fromFusebaseJson,
    fusebaseJsonDeclared = fromFusebaseJson.length > 0,
    fromRemoteManifest,
  } = params;
  const extras = fusebaseJsonDeclared ? fromFusebaseJson : fromRemoteManifest;
  const unknown = findUnknownGatePermissions(extras);
  if (unknown.length > 0) {
    throw new Error(
      `Invalid backendOnlyGatePermissions: ${unknown.join(", ")}. ` +
        "Declare only known Gate permissions (e.g. org.members.read, portals.read, " +
        "isolated_store.read) in fusebase.json — see docs/PERMISSIONS.md.",
    );
  }
  return mergeBackendOnlyGatePermissionLists(
    platformBackendOnly,
    declaredStoreBackendOnly,
    extras,
  );
}

/**
 * Remove permissions that are declared backend-only from the browser-embedded
 * runtime set. The analyzer can re-emit a manifest-listed non-store permission
 * (e.g. `getPortal` → `portals.read`) that also appears in the merged
 * `backendOnlyGatePermissions`; such perms must never ship in `app.permissions`
 * / browser gst. Store perms are already routed out via the declare flow.
 */
export function subtractBackendOnlyFromRuntime(
  runtimePermissions: string[],
  backendOnlyGatePermissions: string[],
): string[] {
  const backendOnly = new Set(backendOnlyGatePermissions);
  return normalizeGatePermissionStrings(
    runtimePermissions.filter((permission) => !backendOnly.has(permission)),
  );
}

export function declareStorePermissionsBackendOnly(runtimePermissions: string[]): {
  runtimePermissions: string[];
  backendOnlyPermissions: string[];
} {
  const runtime: string[] = [];
  const backendOnly: string[] = [];

  for (const permission of normalizeGatePermissionStrings(runtimePermissions)) {
    if (isStoreGatePermission(permission)) {
      backendOnly.push(permission);
    } else {
      runtime.push(permission);
    }
  }

  return { runtimePermissions: runtime, backendOnlyPermissions: backendOnly };
}

export function splitGatePermissionStrings(permissionStrings: string[]): {
  runtimePermissions: string[];
  backendOnlyPermissions: string[];
} {
  const backendOnly = new Set<string>(BACKEND_ONLY_GATE_PERMISSIONS);
  const runtimePermissions: string[] = [];
  const backendOnlyPermissions: string[] = [];

  for (const permission of normalizeGatePermissionStrings(permissionStrings)) {
    if (backendOnly.has(permission)) {
      backendOnlyPermissions.push(permission);
    } else {
      runtimePermissions.push(permission);
    }
  }

  return { runtimePermissions, backendOnlyPermissions };
}

function normalizeGatePermissionStrings(permissionStrings: string[]): string[] {
  return Array.from(
    new Set(
      permissionStrings
        .map((permission) => permission.trim())
        .filter((permission) => permission.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function buildGatePermissionItems(
  permissionStrings: string[],
): AppGatePermissionItem[] {
  const privileges = normalizeGatePermissionStrings(permissionStrings);
  if (privileges.length === 0) {
    return [];
  }

  return [{ type: "gate", privileges }];
}

export function mergeFeaturePermissions(args: {
  manualPermissions?: AppPermissions;
  existingPermissions?: AppPermissions;
  gatePermissions?: string[];
}): AppPermissions | undefined {
  const { manualPermissions, existingPermissions, gatePermissions } = args;

  if (!manualPermissions && gatePermissions === undefined) {
    return undefined;
  }

  const existingItems = existingPermissions?.items ?? [];
  const manualItems = manualPermissions?.items ?? [];
  const manualResourceItems = manualItems.filter((item) => item.type !== "gate");
  const manualGatePrivileges = manualItems
    .filter((item): item is AppGatePermissionItem => item.type === "gate")
    .flatMap((item) => item.privileges);

  // A Gate-only `--permissions` grant leaves the resource section untouched so it never
  // silently drops dashboardView/database grants. An empty `--permissions=""` still clears.
  const replacesResources =
    manualPermissions !== undefined &&
    !(manualResourceItems.length === 0 && manualGatePrivileges.length > 0);
  const resourceItems = replacesResources
    ? manualResourceItems
    : existingItems.filter((item) => item.type !== "gate");

  const gateItems =
    gatePermissions === undefined
      ? existingItems.filter(
          (item): item is AppGatePermissionItem => item.type === "gate",
        )
      : buildGatePermissionItems(gatePermissions);

  return {
    items: [...resourceItems, ...addGatePrivileges(gateItems, manualGatePrivileges)],
  };
}

/**
 * Union hand-granted Gate privileges (`--permissions "app_api.…"`) into the unscoped
 * gate item. They are additive: analyzed/remote gate privileges are never dropped.
 */
function addGatePrivileges(
  gateItems: AppGatePermissionItem[],
  privileges: string[],
): AppGatePermissionItem[] {
  if (privileges.length === 0) {
    return gateItems;
  }

  const unscoped = gateItems.find((item) => !item.resource);
  if (!unscoped) {
    return [...gateItems, ...buildGatePermissionItems(privileges)];
  }

  return gateItems.map((item) =>
    item === unscoped
      ? {
          ...item,
          privileges: normalizeGatePermissionStrings([...item.privileges, ...privileges]),
        }
      : item,
  );
}

export function formatPermissionItem(item: AppPermissionItem): string {
  if (item.type === "dashboardView") {
    return `${item.type} ${item.resource.dashboardId}:${item.resource.viewId} [${item.privileges.join(", ")}]`;
  }

  if (item.type === "database") {
    if (item.resource.databaseId) {
      return `${item.type} id:${item.resource.databaseId} [${item.privileges.join(", ")}]`;
    }

    return `${item.type} alias:${item.resource.databaseAlias ?? ""} [${item.privileges.join(", ")}]`;
  }

  const scope =
    item.resource?.kind && item.resource.ids && item.resource.ids.length > 0
      ? ` ${item.resource.kind}:${item.resource.ids.join(",")}`
      : "";

  return `${item.type}${scope} [${item.privileges.join(", ")}]`;
}
