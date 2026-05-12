import { Command } from "commander";
import { fetchApps } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import { printFeature } from "./utils/feature-output.ts";
import { fetchFeaturePermissionItemsInfo } from "./utils/get-feature-resources-info.ts";

export async function runAppList(): Promise<void> {
  const config = getConfig();
  const fuseConfig = loadFuseConfig();

  if (!config.apiKey) {
    console.error("Error: Not authenticated. Run 'fusebase auth' or 'fusebase auth --api-key=<apiKey>' first.");
    process.exit(1);
  }

  if (!fuseConfig) {
    console.error("Error: No fusebase.json found. Run 'fusebase init' first.");
    process.exit(1);
  }

  const { orgId, productId } = fuseConfig;

  if (!orgId || !productId) {
    console.error("Error: fusebase.json is missing orgId or productId.");
    process.exit(1);
  }

  try {
    const response = await fetchApps(config.apiKey, orgId, productId);

    if (response.apps.length === 0) {
      console.log("No apps found for this product.");
      return;
    }

    const appPermissionsDataByAppId = new Map(
      await Promise.all(
        response.apps.map(async (app) => {
          const appPermissionsData = await fetchFeaturePermissionItemsInfo({
            apiKey: config.apiKey!,
            permissionItems: app.permissions?.items ?? [],
          });

          return [app.id, appPermissionsData] as const;
        }),
      ),
    );

    console.log("\nApps:\n");

    for (const app of response.apps) {
      printFeature(
        app,
        { includeResourceAccess: true },
        { featurePermissionsData: appPermissionsDataByAppId.get(app.id) ?? [] },
      );
    }

    console.log(`Total: ${response.apps.length} app(s)`);
  } catch (error) {
    console.error(`Error: Failed to fetch apps. ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const appListCommand = new Command("list")
  .description("List all apps for the current product")
  .action(runAppList);
