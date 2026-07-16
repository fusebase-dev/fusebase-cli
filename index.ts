#!/usr/bin/env bun
import { Command } from "commander";
import { authCommand } from "./lib/commands/auth";
import { initCommand } from "./lib/commands/init";
import { deployCommand } from "./lib/commands/deploy";
import { devCommand } from "./lib/commands/dev";
import { appCommand } from "./lib/commands/app";
import { featureCommand } from "./lib/commands/feature";
import { productCommand } from "./lib/commands/product";
import { envCommand } from "./lib/commands/env";
import { updateCommand } from "./lib/commands/update";
import { configCommand } from "./lib/commands/config";
import { secretCommand } from "./lib/commands/secret";
import { tokenCommand } from "./lib/commands/token";
import { remoteLogsCommand } from "./lib/commands/remote-logs";
import { integrationsCommand } from "./lib/commands/integrations";
import { analyzeCommand } from "./lib/commands/analyze";
import { scaffoldCommand } from "./lib/commands/scaffold";
import { gitCommand } from "./lib/commands/git";
import { jobCommand } from "./lib/commands/job";
import { sidecarCommand } from "./lib/commands/sidecar";
import { apiCommand } from "./lib/commands/api";
import { appApiContractsCommand } from "./lib/commands/app-api-contracts";
import { isolatedStoreCommand } from "./lib/commands/isolated-store";
import { checkForUpdates } from "./lib/commands/steps/update-check";
import { VERSION } from "./lib/version";
import { registerErrorReporter } from "./lib/error-reporter";
import { instrumentAllCommands } from "./lib/command-logger";
import { flushAgentAssetsRefreshAfterMigration, loadFuseConfig, getUpdateChannel } from "./lib/config";
import { setEnvironmentOverride } from "./lib/environments";
import { detectLinkedOrLocalCli } from "./lib/commands/cli";
import { evaluateLauncherGate } from "./lib/launcher-self-check";
import { REQUIRED_LAUNCHER } from "./lib/required-launcher";
import { formatVersionInfo } from "./lib/version-output";

registerErrorReporter();

const program = new Command();

program.hook("preAction", async (_thisCommand, actionCommand) => {
  // `--env <name>` (attached to every leaf command below) selects the app
  // environment for this invocation; wins over FUSEBASE_ENV and the
  // per-checkout state. Applied before any config/host resolution.
  const envName = (actionCommand.optsWithGlobals() as { env?: string }).env;
  if (typeof envName === "string" && envName.length > 0) {
    setEnvironmentOverride(envName);
  }
  loadFuseConfig();
  await flushAgentAssetsRefreshAfterMigration(process.cwd());
});

const launcherVersionEnv = process.env.FUSEBASE_LAUNCHER_VERSION;
const versionOutput = formatVersionInfo({
  cliVersion: VERSION,
  launcherVersion: launcherVersionEnv,
  channel: launcherVersionEnv ? getUpdateChannel() : "prod",
});

program.name("fusebase").description("Fusebase Products CLI").version(versionOutput);

program.addCommand(authCommand);

program
  .command("version")
  .description("Print CLI version from package.json")
  .action(() => {
    console.log(versionOutput);
  });

const argv = process.argv.slice(2);

// Windows launcher hard gate: a CLI flipped to by `fusebase update` self-rejects
// when the on-PATH launcher is too old for its baked REQUIRED_LAUNCHER, except
// remediation/info commands. Windows-only; no effect on macOS/Linux.
if (process.platform === "win32") {
  const localMode = await detectLinkedOrLocalCli();
  const gate = evaluateLauncherGate({
    platform: process.platform,
    localLinked: localMode.linked,
    launcherVersionEnv,
    required: REQUIRED_LAUNCHER,
    argv,
  });
  if (gate.block) {
    console.error(gate.message);
    process.exit(1);
  }
}

const isUpdateCommand =
  argv[0] === "update" ||
  (argv[0] === "cli" && argv[1] === "update") ||
  (argv[0] === "product" && argv[1] === "update");
if (!isUpdateCommand) {
  checkForUpdates();
}
program.addCommand(initCommand);
program.addCommand(gitCommand);
program.addCommand(deployCommand);
program.addCommand(devCommand);
program.addCommand(appCommand);
program.addCommand(featureCommand);
program.addCommand(productCommand);
program.addCommand(envCommand);
program.addCommand(updateCommand);
program.addCommand(configCommand);
program.addCommand(integrationsCommand);
program.addCommand(secretCommand);
program.addCommand(tokenCommand);
program.addCommand(remoteLogsCommand);
program.addCommand(scaffoldCommand);
program.addCommand(jobCommand);
program.addCommand(sidecarCommand);
program.addCommand(apiCommand);
program.addCommand(isolatedStoreCommand);
program.addCommand(appApiContractsCommand, { hidden: true });
program.addCommand(analyzeCommand, { hidden: true });

// Attach `--env <name>` to every leaf command so any invocation can target a
// named app environment (applied centrally in the preAction hook above).
// Commands that already define their own --env (e.g. `env tokens`) keep it.
function attachEnvOption(command: Command): void {
  const isLeaf = command.commands.length === 0;
  if (isLeaf) {
    const hasEnvOption = command.options.some((o) => o.long === "--env");
    if (!hasEnvOption) {
      command.option(
        "--env <name>",
        "Run against the named app environment (environments/<name>.json)",
      );
    }
    return;
  }
  for (const sub of command.commands) {
    attachEnvOption(sub);
  }
}
attachEnvOption(program);

instrumentAllCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
