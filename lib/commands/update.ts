import { Command } from "commander";
import { runAppUpdate, type AppUpdateOptions } from "./app";
import { runCliSelfUpdate } from "./cli";
import { existsSync } from "fs";
import { join } from "path";

type SmartUpdateOptions = AppUpdateOptions & { skipApp?: boolean };

export const updateCommand = new Command("update")
  .description("Smart update: CLI everywhere, app stages in app directories")
  .option("--skip-app", "Skip app update flow even when fusebase.json exists")
  .option("--skip-cli-update", "Skip automatic CLI self-update step")
  .option("--skip-skills", "Skip AGENTS.md and .claude assets refresh")
  .option("--skip-mcp", "Skip MCP token and IDE config refresh")
  .option("--force-mcp", "Force MCP token and IDE refresh (ignore version marker)")
  .option("--skip-deps", "Skip managed dependency version sync in package.json files")
  .option("--skip-install", "Do not run npm install after dependency changes")
  .option("--skip-commit", "Skip pre-update Git checkpoint")
  .option("--commit", "Run pre-update Git checkpoint in non-interactive mode (no prompt)")
  .option("--dry-run", "Print planned work without writing files or running installs", false)
  .action(async (opts: SmartUpdateOptions) => {
    const isAppDirectory = existsSync(join(process.cwd(), "fusebase.json"));
    const shouldRunAppFlow = isAppDirectory && opts.skipApp !== true;

    if (shouldRunAppFlow) {
      await runAppUpdate(opts);
      return;
    }

    if (opts.skipCliUpdate) {
      console.log(
        "No app project detected (missing fusebase.json) and CLI update is skipped by flag.",
      );
      console.log("Nothing to update.");
      return;
    }

    if (opts.dryRun) {
      console.log("[dry-run] No app project detected (missing fusebase.json).");
      console.log("[dry-run] Would run CLI self-update only.");
      return;
    }

    try {
      await runCliSelfUpdate();
    } catch (err) {
      console.error("Error:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
