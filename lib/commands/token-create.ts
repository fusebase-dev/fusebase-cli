import { Command } from "commander";
import { getConfig, loadFuseConfig } from "../config";
import { fetchFeatureToken } from "../api";

export const tokenCreateCommand = new Command("create")
  .description("Create a short-lived app development token for a feature")
  .requiredOption("--feature <featureId>", "Feature ID to create token for")
  .action(async (options: { feature: string }) => {
    const fuseConfig = loadFuseConfig();
    if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.appId) {
      console.error(
        "Error: Invalid fusebase.json. Missing orgId or appId. Run 'fusebase init' first.",
      );
      process.exit(1);
    }

    const config = getConfig();
    if (!config.apiKey) {
      console.error("Error: No API key configured. Run 'fusebase auth' first.");
      process.exit(1);
    }

    try {
      const result = await fetchFeatureToken(
        config.apiKey,
        fuseConfig.orgId,
        fuseConfig.appId,
        options.feature,
        { short: true },
      );
      console.log(result.token);
    } catch (error) {
      if (error instanceof Error) {
        console.error("Error: Failed to create token:", error.message);
      } else {
        console.error("Error: Failed to create token.");
      }
      process.exit(1);
    }
  });
