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
import { checkForUpdates } from "./lib/commands/steps/update-check";
import { VERSION } from "./lib/version";
import { registerErrorReporter } from "./lib/error-reporter";
import { instrumentAllCommands } from "./lib/command-logger";
import { flushAgentAssetsRefreshAfterMigration, loadFuseConfig } from "./lib/config";

registerErrorReporter();

const program = new Command();

program.hook("preAction", async () => {
  loadFuseConfig();
  await flushAgentAssetsRefreshAfterMigration(process.cwd());
});

program.name("fusebase").description("Fusebase Apps CLI").version(VERSION);

program.addCommand(authCommand);

program
  .command("version")
  .description("Print CLI version from package.json")
  .action(() => {
    console.log(VERSION);
  });

const argv = process.argv.slice(2);
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
program.addCommand(analyzeCommand, { hidden: true });

instrumentAllCommands(program);

program.parse();
