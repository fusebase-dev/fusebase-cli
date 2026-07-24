import { Command } from "commander";
import { runAppCreate, type AppCreateOptions } from "./app-create";
import { runAppGet } from "./app-get";
import { runAppList } from "./app-list";
import { runAppUpdate, type AppUpdateOptions } from "./app-update";

function warnDeprecated(subcommand: string): void {
  console.error(
    `[deprecated] 'fusebase feature ${subcommand}' will be removed in a future release. Use 'fusebase app ${subcommand}' instead.`,
  );
}

const featureListCommand = new Command("list")
  .description("[deprecated] Alias for 'fusebase app list'")
  .action(async () => {
    warnDeprecated("list");
    await runAppList();
  });

const featureGetCommand = new Command("get")
  .description("[deprecated] Alias for 'fusebase app get'")
  .argument("<featureId>", "Feature ID to get")
  .action(async (featureId: string) => {
    warnDeprecated("get");
    await runAppGet(featureId);
  });

const featureUpdateCommand = new Command("update")
  .description("[deprecated] Alias for 'fusebase app update'")
  .argument("<featureId>", "Feature ID to update")
  .option("--access <principals>", "Set access principals, comma-separated (e.g., visitor, org roles like orgRole:member, or portal principals portalClient/portalManager/portalMember)")
  .option("--permissions <permissions>", "Set feature permissions (format: dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read)")
  .option("--sync-gate-permissions", "Analyze this feature path and sync generated Gate permissions")
  .action(async (featureId: string, options: AppUpdateOptions) => {
    warnDeprecated("update");
    await runAppUpdate(featureId, options);
  });

const featureCreateCommand = new Command("create")
  .description("[deprecated] Alias for 'fusebase app create'")
  .requiredOption("--name <name>", "Name for the new feature")
  .requiredOption("--subdomain <subdomain>", "Subdomain for the feature (e.g., my-feature)")
  .requiredOption("--path <path>", "Path to the feature folder (e.g., features/product-add)")
  .requiredOption("--dev-command <command>", "Dev server command (e.g., npm run dev)")
  .requiredOption("--build-command <command>", "Build command (e.g., npm run build)")
  .requiredOption("--output-dir <dir>", "Build output directory (e.g., dist)")
  .option("--access <principals>", "Set access principals, comma-separated (e.g., visitor, org roles like orgRole:member, or portal principals portalClient/portalManager/portalMember)")
  .option("--permissions <permissions>", "Set feature permissions (format: dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read)")
  .option("--backend-dev-command <command>", "Backend dev command (e.g., npm run dev). Only if the feature has a backend/ folder.")
  .option("--backend-build-command <command>", "Backend build command (e.g., npm run build). Only if the feature has a backend/ folder.")
  .option("--backend-start-command <command>", "Backend start command for production (e.g., npm run start). Only if the feature has a backend/ folder.")
  .option("--coding-agent <name>", "Coding agent identifier (e.g. claude_code, cursor, copilot, codex)")
  .option("--model <name>", "Model identifier (e.g. claude-opus-4-6, gpt-5)")
  .action(async (options: AppCreateOptions) => {
    warnDeprecated("create");
    await runAppCreate(options);
  });

export const featureCommand = new Command("feature")
  .description(
    "[deprecated] Alias for 'fusebase app *'. Use 'fusebase app *' instead; will be removed in a future release.",
  );

featureCommand.addCommand(featureCreateCommand);
featureCommand.addCommand(featureGetCommand);
featureCommand.addCommand(featureListCommand);
featureCommand.addCommand(featureUpdateCommand);
