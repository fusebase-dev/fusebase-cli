import { Command, Option } from "commander";
import { getConfig, loadFuseConfig } from "../config";
import { fetchAppToken } from "../api";

export const tokenCreateCommand = new Command("create")
  .description("Create a short-lived product development token for an app")
  .option("-a, --app <appId>", "App ID to create token for")
  .addOption(
    new Option("--feature <featureId>", "Deprecated alias for --app").hideHelp(),
  )
  .action(async (options: { app?: string; feature?: string }) => {
    const appId = options.app ?? options.feature;
    if (!appId) {
      console.error("Error: --app is required.");
      process.exit(1);
    }
    if (options.feature && !options.app) {
      console.warn("[deprecated] --feature is deprecated; use --app instead.");
    }
    const fuseConfig = loadFuseConfig();
    if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.productId) {
      console.error(
        "Error: Invalid fusebase.json. Missing orgId or productId. Run 'fusebase init' first.",
      );
      process.exit(1);
    }

    const config = getConfig();
    if (!config.apiKey) {
      console.error("Error: No API key configured. Run 'fusebase auth' first.");
      process.exit(1);
    }

    try {
      const result = await fetchAppToken(
        config.apiKey,
        fuseConfig.orgId,
        fuseConfig.productId,
        appId,
        { short: true },
      );
      console.log('Your short-lived (a few minutes TTL) token is:\n')
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
