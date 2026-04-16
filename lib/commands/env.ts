/**
 * Env commands: create/update .env with MCP token.
 */

import { Command } from "commander";
import { readFile, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createEnvFile, printCreateEnvResult } from "./steps/create-env";
import { confirm } from "@inquirer/prompts";
import {
  printIdeSetupResults,
  setupIdeConfig,
  type IdePreset,
} from "./steps/ide-setup";

const CONFIG_DIR = join(homedir(), ".fusebase");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const FUSE_JSON = "fusebase.json";

interface Config {
  apiKey?: string;
}

interface FuseConfig {
  orgId?: string;
  appId?: string;
}

const ALL_IDE_PRESETS: IdePreset[] = ["claude-code", "cursor", "vscode", "opencode", "codex", "other"];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(): Promise<Config> {
  try {
    const data = await readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as Config;
  } catch {
    return {};
  }
}

async function loadFuseConfig(cwd: string): Promise<FuseConfig> {
  const fuseJsonPath = join(cwd, FUSE_JSON);
  try {
    const data = await readFile(fuseJsonPath, "utf-8");
    return JSON.parse(data) as FuseConfig;
  } catch {
    return {};
  }
}

export async function runEnvCreate(force: boolean = true): Promise<void> {
  const cwd = process.cwd();
  const fuseJsonPath = join(cwd, FUSE_JSON);

  if (!(await fileExists(fuseJsonPath))) {
    console.error("Error: fusebase.json not found. Run 'fusebase init' first.");
    process.exit(1);
  }

  const fuseConfig = await loadFuseConfig(cwd);
  if (!fuseConfig.orgId) {
    console.error("Error: orgId not found in fusebase.json.");
    process.exit(1);
  }
  if (!fuseConfig.appId) {
    console.error("Error: appId not found in fusebase.json.");
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config.apiKey) {
    console.error("Error: No API key configured. Run 'fusebase auth' first.");
    process.exit(1);
  }

  const result = await createEnvFile({
    targetDir: cwd,
    apiKey: config.apiKey,
    orgId: fuseConfig.orgId,
    appId: fuseConfig.appId,
    force,
  });

  printCreateEnvResult(result);

  if (result.error) {
    process.exit(1);
  }

  const shouldOfferMcpRefresh =
    (result.created || result.updated) &&
    process.stdin.isTTY &&
    process.stdout.isTTY;

  if (!shouldOfferMcpRefresh) {
    return;
  }

  let shouldRunIdeRefresh = false;
  try {
    shouldRunIdeRefresh = await confirm({
      message: "Tokens updated. Update MCP configs for all IDEs now? (runs `fusebase config ide --force`)",
      default: true,
    });
  } catch {
    // Prompt can be interrupted; treat as refusal and show manual step.
    shouldRunIdeRefresh = false;
  }

  if (!shouldRunIdeRefresh) {
    console.log("Next step: run `fusebase config ide --force` to refresh MCP tokens in all IDE MCP configs.");
    return;
  }

  const presets = new Set<IdePreset>(ALL_IDE_PRESETS);
  const ideResult = await setupIdeConfig({
    targetDir: cwd,
    presets,
    force: true,
  });
  printIdeSetupResults(ideResult, presets);
}

export const envCommand = new Command("env")
  .description("Manage .env file (MCP token and URL)");

envCommand
  .command("create")
  .description("Create or overwrite .env with MCP token")
  .option("--no-force", "Do not overwrite existing .env (only add if missing)")
  .action(async (options: { force?: boolean }) => {
    try {
      await runEnvCreate(options.force !== false);
    } catch (error) {
      console.error("Error: Failed to create .env file:", error);
      process.exit(1);
    }
  });
