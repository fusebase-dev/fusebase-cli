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
import { detectLinkedOrLocalCli } from "./lib/commands/cli";
import { evaluateLauncherGate } from "./lib/launcher-self-check";
import { REQUIRED_LAUNCHER } from "./lib/required-launcher";
import { formatVersionInfo } from "./lib/version-output";

registerErrorReporter();

const program = new Command();

program.hook("preAction", async () => {
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

instrumentAllCommands(program);

await program.parseAsync(process.argv);
