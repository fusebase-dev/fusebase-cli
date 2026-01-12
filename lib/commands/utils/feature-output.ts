import type { AppFeature, AppFeaturePermissionItem } from "../../api.ts";
import type { AppFeaturePermissionItemEnriched } from "./get-feature-resources-info.ts";

interface PrintFeatureOptions {
  includeResourceAccess?: boolean;
}

interface PrintFeatureHelpData {
  featurePermissionsData?: AppFeaturePermissionItemEnriched[];
}

function getPermissionItems(feature: AppFeature): AppFeaturePermissionItem[] {
  return feature.permissions?.items ?? [];
}

interface PermissionRow {
  id: string;
  title: string;
  type: "Table" | "Database";
}

function getPermissionRows(
  feature: AppFeature,
  featurePermissionsData: AppFeaturePermissionItemEnriched[] = [],
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

export function printFeature(
  feature: AppFeature,
  options: PrintFeatureOptions = {},
  helpData: PrintFeatureHelpData = {},
): void {
  console.log(`  ${feature.title}`);
  console.log(`    ID:   ${feature.id}`);
  console.log(`    URL:  ${feature.url}`);

  if (options.includeResourceAccess) {
    printPermissionTable(getPermissionRows(feature, helpData.featurePermissionsData));
  }

  console.log();
}
