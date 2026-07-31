import { Command } from "commander";
import { fetchApp } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import { printFeature } from "./utils/feature-output.ts";

interface AppGetOptions {
  json?: boolean;
}

export async function runAppGet(appIdArg: string, options: AppGetOptions = {}): Promise<void> {
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
    const app = await fetchApp(config.apiKey, orgId, productId, appIdArg);

    if (options.json) {
      console.log(JSON.stringify(app, null, 2));
      return;
    }

    console.log("\nApp:\n");
    printFeature(app);
  } catch (error) {
    console.error(`Error: Failed to fetch app. ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const appGetCommand = new Command("get")
  .description("Get an app by ID, including its current access principals (read-only)")
  .argument("<appId>", "App ID to get")
  .option("--json", "Print the raw app payload as JSON (includes accessPrincipals)")
  .action(runAppGet);
