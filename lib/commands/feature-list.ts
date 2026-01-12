import { Command } from "commander";
import { fetchAppFeatures } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import { printFeature } from "./utils/feature-output.ts";
import { fetchFeaturePermissionItemsInfo } from "./utils/get-feature-resources-info.ts";

export const featureListCommand = new Command("list")
  .description("List all features for the current app")
  .action(async () => {
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

    const { orgId, appId } = fuseConfig;

    if (!orgId || !appId) {
      console.error("Error: fusebase.json is missing orgId or appId.");
      process.exit(1);
    }

    try {
      const response = await fetchAppFeatures(config.apiKey, orgId, appId);

      if (response.features.length === 0) {
        console.log("No features found for this app.");
        return;
      }

      const featurePermissionsDataByFeatureId = new Map(
        await Promise.all(
          response.features.map(async (feature) => {
            const featurePermissionsData = await fetchFeaturePermissionItemsInfo({
              apiKey: config.apiKey!,
              permissionItems: feature.permissions?.items ?? [],
            });

            return [feature.id, featurePermissionsData] as const;
          }),
        ),
      );

      console.log("\nFeatures:\n");

      for (const feature of response.features) {
        printFeature(
          feature,
          { includeResourceAccess: true },
          { featurePermissionsData: featurePermissionsDataByFeatureId.get(feature.id) ?? [] },
        );
      }

      console.log(`Total: ${response.features.length} feature(s)`);
    } catch (error) {
      console.error(`Error: Failed to fetch features. ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
