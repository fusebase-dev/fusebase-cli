import { Command } from "commander";
import chalk from "chalk";
import {
  getBuildLogsByApp,
  getRuntimeLogsByApp,
  type RuntimeLogEntry,
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
 * Match a `--container <name>` filter against an entry's `source`.
 *
 * Source field shape (NIM-40512): `backend`, `sidecar:<name>`, `job:<name>`.
 * `--container api` is mapped to `backend` for backward compat with the
 * pre-aggregation log format that prefixed backend lines with `[api]:`.
 */
function entryMatchesContainer(
  entry: RuntimeLogEntry,
  container: string,
): boolean {
  if (entry.source === container) return true;
  if (container === "api" && entry.source === "backend") return true;
  const colonIdx = entry.source.indexOf(":");
  if (colonIdx !== -1 && entry.source.slice(colonIdx + 1) === container) {
    return true;
  }
  return false;
}

/**
 * Print runtime log entries with `[source] timestamp message` formatting.
 */
function printRuntimeLogs(
  entries: RuntimeLogEntry[],
  tail: number,
  type: RuntimeLogType,
  from: string,
  to: string,
  container?: string,
): void {
  const header = container
    ? `\n${chalk.bold("Runtime Logs")} (${chalk.cyan(type)}, container ${chalk.cyan(container)}, last ${chalk.cyan(String(tail))} entries, ${chalk.gray(from)} → ${chalk.gray(to)})\n`
    : `\n${chalk.bold("Runtime Logs")} (${chalk.cyan(type)}, last ${chalk.cyan(String(tail))} entries, ${chalk.gray(from)} → ${chalk.gray(to)})\n`;
  console.log(header);
  console.log("─".repeat(60));

  const displayEntries = container
    ? entries.filter((e) => entryMatchesContainer(e, container))
    : entries;

  if (displayEntries.length === 0) {
    console.log(chalk.gray("No runtime logs available."));
  } else {
    for (const entry of displayEntries) {
      console.log(
        `${chalk.cyan(`[${entry.source}]`)} ${entry.timestamp} ${entry.message}`,
      );
    }
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

/**
 * Validate an ISO 8601 timestamp string. Accepts the formats `Date.parse`
 * recognises that round-trip through `toISOString()` losslessly (minute
 * precision or finer). Returns the input on success or throws with a helpful
 * message on failure.
 */
function validateIsoTimestamp(value: string, flag: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(
      `${flag} must be a valid ISO 8601 timestamp (e.g. 2026-04-30T09:00:00Z), got: ${value}`,
    );
  }
  return value;
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

      const response = await getBuildLogsByApp(apiKey, orgId, featureId);

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
    "Number of log entries to retrieve (1-1000)",
    "100",
  )
  .option(
    "--type <type>",
    "Type of logs: console (stdout/stderr) or system (Container Apps service logs)",
    "console",
  )
  .option(
    "--from <iso>",
    "Inclusive lower bound of the log time window (ISO 8601, e.g. 2026-04-30T09:00:00Z). Defaults server-side to to - 1h.",
  )
  .option(
    "--to <iso>",
    "Inclusive upper bound of the log time window (ISO 8601). Defaults server-side to now. Range from..to is capped at 7 days.",
  )
  .option(
    "--container <name>",
    "Filter logs to a specific container (e.g. api, or a sidecar/job name)",
  );

runtimeCommand.action(async (featureId: string, options) => {
  try {
    const { orgId, apiKey } = await getOrgAndApiKey();

    const tail = parseInt(options.tail, 10);
    if (isNaN(tail) || tail < 1 || tail > 1000) {
      console.error("Error: --tail must be a number between 1 and 1000.");
      process.exit(1);
    }

    const type = options.type as RuntimeLogType;
    if (type !== "console" && type !== "system") {
      console.error('Error: --type must be either "console" or "system".');
      process.exit(1);
    }

    let from: string | undefined;
    let to: string | undefined;
    try {
      if (options.from) from = validateIsoTimestamp(options.from, "--from");
      if (options.to) to = validateIsoTimestamp(options.to, "--to");
    } catch (e) {
      console.error(
        chalk.red(`Error: ${e instanceof Error ? e.message : String(e)}`),
      );
      process.exit(1);
    }

    if (from && to && Date.parse(from) > Date.parse(to)) {
      console.error("Error: --from must be earlier than or equal to --to.");
      process.exit(1);
    }

    console.log(
      `\n📋 Fetching runtime logs for feature: ${chalk.cyan(featureId)}`,
    );

    const response = await getRuntimeLogsByApp(apiKey, orgId, featureId, {
      tail,
      type,
      from,
      to,
    });

    printRuntimeLogs(
      response.logs,
      response.tail,
      response.type,
      response.from,
      response.to,
      options.container,
    );

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
