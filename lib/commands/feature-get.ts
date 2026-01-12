import { Command } from "commander";
import { fetchAppFeature } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import { printFeature } from "./utils/feature-output.ts";

export const featureGetCommand = new Command("get")
  .description("Get a feature by ID")
  .argument("<featureId>", "Feature ID to get")
  .action(async (featureId: string) => {
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
      const feature = await fetchAppFeature(config.apiKey, orgId, appId, featureId);

      console.log("\nFeature:\n");
      printFeature(feature);
    } catch (error) {
      console.error(`Error: Failed to fetch feature. ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
