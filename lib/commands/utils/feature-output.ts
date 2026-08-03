import type { App, AppAccessPrincipal, AppPermissionItem } from "../../api.ts";
import { parsePrincipals } from "../../permissions.ts";
import type { AppPermissionItemEnriched } from "./get-feature-resources-info.ts";

interface PrintFeatureOptions {
  includeResourceAccess?: boolean;
}

interface PrintFeatureHelpData {
  featurePermissionsData?: AppPermissionItemEnriched[];
}

function getPermissionItems(feature: App): AppPermissionItem[] {
  return feature.permissions?.items ?? [];
}

interface PermissionRow {
  id: string;
  title: string;
  type: "Table" | "Database";
}

function getPermissionRows(
  feature: App,
  featurePermissionsData: AppPermissionItemEnriched[] = [],
): PermissionRow[] {
  if (featurePermissionsData.length > 0) {
    return featurePermissionsData.flatMap(({ permissionItem, additionalInfo }) => {
      if (permissionItem.type === "dashboardView") {
        return [{
          id: permissionItem.resource.dashboardId,
          title: additionalInfo.title,
          type: "Table",
        }];
      }

      if (permissionItem.type === "database") {
        return [{
          id: permissionItem.resource.databaseAlias ?? permissionItem.resource.databaseId ?? "",
          title: additionalInfo.title,
          type: "Database",
        }];
      }

      return [];
    });
  }

  const rows: PermissionRow[] = [];

  for (const permission of getPermissionItems(feature)) {
    if (permission.type === "dashboardView") {
      const dashboardId = permission.resource.dashboardId;
      rows.push({
        id: dashboardId,
        title: dashboardId,
        type: "Table",
      });
      continue;
    }

    if (permission.type === "database") {
      const databaseId = permission.resource.databaseAlias ?? permission.resource.databaseId;
      if (databaseId) {
        rows.push({
          id: databaseId,
          title: databaseId,
          type: "Database",
        });
      }
    }
  }

  return rows;
}

function printPermissionTable(rows: PermissionRow[]): void {
  if (rows.length === 0) {
    console.log("    Permissions: none");
    return;
  }

  const idHeader = "ID";
  const titleHeader = "Title";
  const typeHeader = "Type";
  const idWidth = Math.max(idHeader.length, ...rows.map((row) => row.id.length));
  const titleWidth = Math.max(titleHeader.length, ...rows.map((row) => row.title.length));
  const typeWidth = Math.max(typeHeader.length, ...rows.map((row) => row.type.length));

  console.log("    Permissions:");
  console.log(`      ${idHeader.padEnd(idWidth)}  ${titleHeader.padEnd(titleWidth)}  ${typeHeader.padEnd(typeWidth)}`);
  console.log(`      ${"-".repeat(idWidth)}  ${"-".repeat(titleWidth)}  ${"-".repeat(typeWidth)}`);

  for (const row of rows) {
    console.log(`      ${row.id.padEnd(idWidth)}  ${row.title.padEnd(titleWidth)}  ${row.type.padEnd(typeWidth)}`);
  }
}

/**
 * Render a principal in the same syntax `--access` accepts, so the output of
 * `app get` can be pasted straight back into `app update --access` without
 * having to guess the current grants.
 *
 * Some principals the platform stores (`user:<id>`, `orgGroup:<id>`, granted
 * from the UI) cannot be authored by the CLI at all — they are still shown,
 * but `printFeature` warns that re-applying the line would drop them.
 */
export function formatAccessPrincipal(principal: AppAccessPrincipal): string {
  // `visitor` is stored with the sentinel id "0"; portal principals are
  // context-relative and carry no id. Both are written bare.
  if (!principal.id || (principal.type === "visitor" && principal.id === "0")) {
    return principal.type;
  }

  return `${principal.type}:${principal.id}`;
}

export function formatAccessPrincipals(principals?: AppAccessPrincipal[]): string {
  if (!principals || principals.length === 0) {
    return "none";
  }

  return principals.map(formatAccessPrincipal).join(", ");
}

/**
 * Principals `--access` cannot express. Asking the parser instead of keeping a
 * second list of types means this can never drift from what `app update`
 * actually accepts.
 */
export function findUnauthorableAccessPrincipals(principals?: AppAccessPrincipal[]): string[] {
  return (principals ?? []).map(formatAccessPrincipal).filter((rendered) => {
    try {
      parsePrincipals(rendered);
      return false;
    } catch {
      return true;
    }
  });
}

export function printFeature(
  feature: App,
  options: PrintFeatureOptions = {},
  helpData: PrintFeatureHelpData = {},
): void {
  console.log(`  ${feature.title}`);
  console.log(`    ID:   ${feature.id}`);
  console.log(`    URL:  ${feature.url}`);
  console.log(`    Access: ${formatAccessPrincipals(feature.accessPrincipals)}`);

  const unauthorable = findUnauthorableAccessPrincipals(feature.accessPrincipals);
  if (unauthorable.length > 0) {
    console.log(`            ! 'app update --access' cannot express: ${unauthorable.join(", ")} — running it would revoke that access.`);
  }

  if (options.includeResourceAccess) {
    printPermissionTable(getPermissionRows(feature, helpData.featurePermissionsData));
  }

  console.log();
}
