import { Command } from "commander";
import chalk from "chalk";
import {
  getBuildLogsByFeature,
  getRuntimeLogsByFeature,
  type RuntimeLogType,
} from "../api";
import { getConfig, loadFuseConfig } from "../config";

/**
 * Print build logs with status indicator.
 */
function printBuildLogs(log: string | undefined, status: string): void {
  const statusColor =
    status === "finished"
      ? chalk.green
      : status === "failed"
        ? chalk.red
        : chalk.yellow;

  console.log(
    `\n${chalk.bold("Build Status:")} ${statusColor(status.toUpperCase())}\n`,
  );

  if (log) {
    console.log(chalk.bold("Build Logs:"));
    console.log("─".repeat(60));
    console.log(log);
    console.log("─".repeat(60));
  } else {
    console.log(chalk.gray("No build logs available yet."));
  }
}

/**
 * Print runtime logs with formatting.
 */
function printRuntimeLogs(
  logs: string,
  tail: number,
  type: RuntimeLogType,
): void {
  console.log(
    `\n${chalk.bold("Runtime Logs")} (${chalk.cyan(type)}, last ${chalk.cyan(String(tail))} entries)\n`,
  );
  console.log("─".repeat(60));

  if (logs.trim()) {
    console.log(logs);
  } else {
    console.log(chalk.gray("No runtime logs available."));
  }

  console.log("─".repeat(60));
}

/**
 * Get org ID and API key from config.
 */
async function getOrgAndApiKey(): Promise<{
  orgId: string;
  apiKey: string;
}> {
  const fuseConfig = await loadFuseConfig();
  if (!fuseConfig) {
    console.error("Error: App not initialized. Run 'fusebase init' first.");
    process.exit(1);
  }

  if (!fuseConfig.orgId) {
    console.error("Error: Invalid fusebase.json. Missing orgId.");
    process.exit(1);
  }

  const config = await getConfig();
  if (!config.apiKey) {
    console.error("Error: No API key configured. Run 'fusebase auth' first.");
    process.exit(1);
  }

  return {
    orgId: fuseConfig.orgId,
    apiKey: config.apiKey,
  };
}

// Build logs subcommand
const buildCommand = new Command("build")
  .description("Get build logs for a deployed feature")
  .argument("<featureId>", "Feature ID")
  .action(async (featureId: string) => {
    try {
      const { orgId, apiKey } = await getOrgAndApiKey();

      console.log(
        `\n📋 Fetching build logs for feature: ${chalk.cyan(featureId)}`,
      );

      const response = await getBuildLogsByFeature(apiKey, orgId, featureId);

      printBuildLogs(response.log, response.status);

      console.log(`\n${chalk.gray(`Deploy ID: ${response.deployId}`)}\n`);
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
      process.exit(1);
    }
  });

// Runtime logs subcommand
const runtimeCommand = new Command("runtime")
  .description("Get runtime logs from a deployed feature backend")
  .argument("<featureId>", "Feature ID")
  .option(
    "-t, --tail <number>",
    "Number of log entries to retrieve (0-300)",
    "100",
  )
  .option(
    "--type <type>",
    "Type of logs: console (stdout/stderr) or system (Container Apps service logs)",
    "console",
  )
  .action(async (featureId: string, options) => {
    try {
      const { orgId, apiKey } = await getOrgAndApiKey();

      const tail = parseInt(options.tail, 10);
      if (isNaN(tail) || tail < 0 || tail > 300) {
        console.error("Error: --tail must be a number between 0 and 300.");
        process.exit(1);
      }

      const type = options.type as RuntimeLogType;
      if (type !== "console" && type !== "system") {
        console.error('Error: --type must be either "console" or "system".');
        process.exit(1);
      }

      console.log(
        `\n📋 Fetching runtime logs for feature: ${chalk.cyan(featureId)}`,
      );

      const response = await getRuntimeLogsByFeature(apiKey, orgId, featureId, {
        tail,
        type,
      });

      printRuntimeLogs(response.logs, response.tail, response.type);

      console.log(`\n${chalk.gray(`Deploy ID: ${response.deployId}`)}\n`);
    } catch (error) {
      console.error(
        chalk.red(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
      process.exit(1);
    }
  });

// Main remote-logs command
export const remoteLogsCommand = new Command("remote-logs")
  .description("Fetch logs from deployed Fusebase app features")
  .addCommand(buildCommand)
  .addCommand(runtimeCommand);
