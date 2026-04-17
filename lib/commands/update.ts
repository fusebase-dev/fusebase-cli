import { Command } from "commander";
import { runAppUpdate, type AppUpdateOptions } from "./app";

export const updateCommand = new Command("update")
  .description("Update current app project (alias of `fusebase app update`)")
  .option("--no-skills", "Skip AGENTS.md and .claude assets refresh")
  .option("--no-mcp", "Skip MCP token and IDE config refresh")
  .option("--force-mcp", "Force MCP token and IDE refresh (ignore version marker)")
  .option("--no-deps", "Skip managed dependency version sync in package.json files")
  .option("--no-install", "Do not run npm install after dependency changes")
  .option("--no-commit", "Skip pre-update Git checkpoint")
  .option("--commit", "Run pre-update Git checkpoint in non-interactive mode (no prompt)")
  .option("--dry-run", "Print planned work without writing files or running installs", false)
  .action(async (opts: AppUpdateOptions) => {
    await runAppUpdate(opts);
  });
