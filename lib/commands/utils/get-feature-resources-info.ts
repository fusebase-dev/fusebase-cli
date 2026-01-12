import {
  fetchDashboardInfo,
  fetchDatabaseInfo,
  type AppFeaturePermissionItem,
} from "../../api";

export type AppFeaturePermissionItemEnriched = {
  permissionItem: AppFeaturePermissionItem,
  additionalInfo: {
    title: string;
  }
}

export async function fetchFeaturePermissionItemsInfo(args: {
  apiKey: string,
  permissionItems: AppFeaturePermissionItem[] 
}): Promise<AppFeaturePermissionItemEnriched[]> {
  const { apiKey } = args;
  const permissionItems = args.permissionItems.filter(
    (item) => item.type === "dashboardView" || item.type === "database",
  );
  const dashboardIds = Array.from(new Set(
    permissionItems
      .filter((item) => item.type === "dashboardView")
      .map((item) => item.resource.dashboardId),
  ));
  const databaseIds = Array.from(new Set(
    permissionItems
      .filter((item) => item.type === "database")
      .map((item) => item.resource.databaseId)
      .filter((databaseId): databaseId is string => Boolean(databaseId)),
  ));

  const [dashboardInfoEntries, databaseInfoEntries] = await Promise.all([
    Promise.all(
      dashboardIds.map(async (dashboardId) => {
        const dashboardInfo = await fetchDashboardInfo(apiKey, dashboardId);
        return [dashboardId, dashboardInfo] as const;
      }),
    ),
    Promise.all(
      databaseIds.map(async (databaseId) => {
        const databaseInfo = await fetchDatabaseInfo(apiKey, databaseId);
        return [databaseId, databaseInfo] as const;
      }),
    ),
  ]);

  const dashboardsById = new Map(dashboardInfoEntries);
  const databasesById = new Map(databaseInfoEntries);

  return permissionItems.map((permissionItem) => {
    if (permissionItem.type === "dashboardView") {
      const dashboardInfo = dashboardsById.get(permissionItem.resource.dashboardId);

      return {
        permissionItem,
        additionalInfo: {
          title: dashboardInfo?.name ?? permissionItem.resource.dashboardId,
        },
      };
    }

    const databaseId = permissionItem.resource.databaseId;
    const databaseInfo = databaseId ? databasesById.get(databaseId) : undefined;

    return {
      permissionItem,
      additionalInfo: {
        title: databaseInfo?.title ?? permissionItem.resource.databaseAlias ?? databaseId ?? "",
      },
    };
  });
}
