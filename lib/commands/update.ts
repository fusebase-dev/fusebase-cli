import { Command } from "commander";
import { runAppUpdate, type AppUpdateOptions } from "./app";

export const updateCommand = new Command("update")
  .description("Update current app project (alias of `fusebase app update`)")
  .option("--skip-cli-update", "Skip automatic `fusebase cli update` step")
  .option("--skip-skills", "Skip AGENTS.md and .claude assets refresh")
  .option("--skip-mcp", "Skip MCP token and IDE config refresh")
  .option("--force-mcp", "Force MCP token and IDE refresh (ignore version marker)")
  .option("--skip-deps", "Skip managed dependency version sync in package.json files")
  .option("--skip-install", "Do not run npm install after dependency changes")
  .option("--skip-commit", "Skip pre-update Git checkpoint")
  .option("--commit", "Run pre-update Git checkpoint in non-interactive mode (no prompt)")
  .option("--dry-run", "Print planned work without writing files or running installs", false)
  .action(async (opts: AppUpdateOptions) => {
    await runAppUpdate(opts);
  });
