import { Command } from "commander";
import { fetchOrgs } from "../api";
import {
  CONFIG_DIR,
  getEnv,
  setBackendApiKey,
  setConfig,
  setProcessEnvOverride,
} from "../config";
import { environmentsFeatureEnabled } from "../environments";
import { runAuthFlow } from "./steps/auth-flow";
import { flushReport } from "../error-reporter";

export const authCommand = new Command("auth")
  .description("Set the API key for authentication")
  .allowExcessArguments(true)
  .option("--api-key <apiKey>", "The API key to store")
  .option("--dev", "Use dev environment", false)
  .option("--no-open", "Don't open the login URL in the browser automatically")
  .action(async (options: { apiKey?: string; dev: boolean; open: boolean }) => {
    const apiKey = options.apiKey;
    const isDev = options.dev;
    // `--dev` targets dev explicitly; otherwise keep the legacy semantics —
    // authenticate against the machine's current env (config `env` /
    // process.env.ENV chain). Hardcoding "prod" here broke `auth --api-key`
    // with a dev key on env=dev machines (CI e2e regression).
    const backend = isDev ? "dev" : (getEnv() ?? "prod");

    // Validate the key against that backend, regardless of an active
    // environment in the cwd.
    setProcessEnvOverride(backend);

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
    setBackendApiKey(backend, apiKey);
    if (isDev && !environmentsFeatureEnabled()) {
      // Legacy behavior: `auth --dev` also switches the machine-global env.
      // With environments enabled the backend comes from the active
      // environment, so auth no longer flips it.
      setConfig({ env: "dev" });
    }

    console.log("✓ API key saved successfully");
  });
