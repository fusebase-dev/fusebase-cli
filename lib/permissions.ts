import type {
  AppAccessPrincipal,
  AppGatePermissionItem,
  AppPermissionItem,
  AppPermissions,
  AppResourcePermissionPrivilege,
} from "./api.ts";

const VALID_ORG_ROLES = ['guest', 'client', 'member', 'manager', 'owner'];
const VALID_RESOURCE_PRIVILEGES: AppResourcePermissionPrivilege[] = ["read", "write"];

/**
 * Parse access principals string into AppAccessPrincipal array.
 * Format: comma-separated list of "type" or "type:id"
 * Examples:
 *   "visitor" → [{ type: "visitor", id: "0" }]
 *   "orgRole:member" → [{ type: "orgRole", id: "member" }]
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
      } else {
        throw new Error(`Invalid principal "${part}". Use "visitor" or "orgRole:<id>". Valid orgRole ids: ${VALID_ORG_ROLES.join(', ')}`);
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
      } else {
        throw new Error(`Invalid principal type "${type}". Valid types: visitor, orgRole`);
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
 * Multiple permission items are separated by semicolons.
 * Each permission item is separated by semicolon.
 * Each item format: type.resource.privileges (privileges comma-separated)
 */
export function parsePermissions(permissionsStr: string): AppPermissions {
  const items: AppPermissionItem[] = [];

  const parts = permissionsStr.split(';').map(p => p.trim()).filter(p => p);

  for (const part of parts) {
    const segments = part.split('.');
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

    throw new Error(`Invalid permission type "${permissionType}". Allowed values: dashboardView, database`);
  }

  return { items };
}

export const BACKEND_ONLY_GATE_PERMISSIONS = [
  "isolated_store.rls.delegate",
  "isolated_store.rls.bypass",
] as const;

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
  const resourceItems =
    manualPermissions !== undefined
      ? manualPermissions.items
      : existingItems.filter((item) => item.type !== "gate");
  const gateItems =
    gatePermissions === undefined
      ? existingItems.filter(
          (item): item is AppGatePermissionItem => item.type === "gate",
        )
      : buildGatePermissionItems(gatePermissions);

  return {
    items: [...resourceItems, ...gateItems],
  };
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
