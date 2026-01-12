import { Command } from "commander";
import { mkdir, writeFile } from "fs/promises";
import { fetchOrgs } from "../api";
import { CONFIG_DIR, CONFIG_FILE, getConfig, type Config } from "../config";
import { runAuthFlow } from "./steps/auth-flow";
import { flushReport } from "../error-reporter";

async function ensureConfigDir(): Promise<void> {
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
  } catch {
    // Directory already exists
  }
}

async function saveConfig(config: Config): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export const authCommand = new Command("auth")
  .description("Set the API key for authentication")
  .allowExcessArguments(true)
  .option("--api-key <apiKey>", "The API key to store")
  .option("--dev", "Use dev environment", false)
  .option("--no-open", "Don't open the login URL in the browser automatically")
  .action(async (options: { apiKey?: string; dev: boolean; open: boolean }) => {
    const apiKey = options.apiKey;
    const isDev = options.dev;

    if (isDev) {
      // globally set ENV var because global config is not yet created, so environment will be decided by this variable in getEnv()
      process.env.ENV = "dev";
    }

    // If no API key provided, start OAuth flow
    if (!apiKey) {
      try {
        await runAuthFlow(isDev, { openBrowser: options.open });
        return;
      } catch (error) {
        await flushReport();
        process.exit(1);
      }
    }

    // Manual API key provided - validate and save it
    try {
      await fetchOrgs(apiKey);
    } catch (error) {
      console.error(
        `Error: Invalid API key. See ${CONFIG_DIR}/error.log for details.`,
      );
      await flushReport();
      process.exit(1);
    }
    const config = getConfig();
    config.apiKey = apiKey;
    if (isDev) {
      config.env = "dev";
    }
    await saveConfig(config);

    console.log("✓ API key saved successfully");
  });
