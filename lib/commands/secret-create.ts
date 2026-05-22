import { Command, Option } from "commander";
import { setAppSecrets, fetchOrg } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";

function parseSecretArg(
  value: string,
  previous: { key: string; description?: string }[],
): { key: string; description?: string }[] {
  const colonIndex = value.indexOf(":");
  let key: string;
  let description: string | undefined;

  if (colonIndex !== -1) {
    key = value.substring(0, colonIndex).trim();
    description = value.substring(colonIndex + 1).trim() || undefined;
  } else {
    key = value.trim();
  }

  if (!key) {
    throw new Error("Secret key cannot be empty");
  }

  return [...previous, { key, description }];
}

export const secretCreateCommand = new Command("create")
  .description(
    "Create secrets (with empty values) for an app and print the URL to set their values",
  )
  .option("--app <appId>", "App ID to create secrets for")
  .addOption(
    new Option("--feature <featureId>", "Deprecated alias for --app")
      .hideHelp(),
  )
  .requiredOption(
    "--secret <key:description>",
    "Secret to create (format: KEY or KEY:description). Repeatable for multiple secrets.",
    parseSecretArg,
    [] as { key: string; description?: string }[],
  )
  .action(
    async (options: {
      app?: string;
      feature?: string;
      secret: { key: string; description?: string }[];
    }) => {
      const appId = options.app ?? options.feature;
      if (!appId) {
        console.error("Error: --app is required.");
        process.exit(1);
      }
      if (options.feature && !options.app) {
        console.warn(
          "[deprecated] --feature is deprecated; use --app instead.",
        );
      }
      if (options.secret.length === 0) {
        console.error("Error: At least one --secret is required.");
        process.exit(1);
      }

      // Load fusebase.json
      const fuseConfig = loadFuseConfig();
      if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.productId) {
        console.error(
          "Error: Invalid fusebase.json. Missing orgId or productId. Run 'fusebase init' first.",
        );
        process.exit(1);
      }

      // Load API key from config
      const config = getConfig();
      if (!config.apiKey) {
        console.error(
          "Error: No API key configured. Run 'fusebase auth' first.",
        );
        process.exit(1);
      }

      const secrets = options.secret.map((s) => ({
        key: s.key,
        value: "",
        description: s.description,
      }));

      // Check for duplicate keys
      const keys = secrets.map((s) => s.key);
      const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (duplicates.length > 0) {
        console.error(
          `Error: Duplicate secret keys: ${[...new Set(duplicates)].join(", ")}`,
        );
        process.exit(1);
      }

      try {
        const result = await setAppSecrets(
          config.apiKey,
          fuseConfig.orgId,
          fuseConfig.productId,
          appId,
          secrets,
        );
        console.log(`✓ Created ${result.secrets.length} secret(s):`);
        for (const secret of result.secrets) {
          const desc = secret.description ? ` — ${secret.description}` : "";
          console.log(`  • ${secret.key}${desc}`);
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error("Error: Failed to create secrets:", error.message);
        } else {
          console.error("Error: Failed to create secrets.");
        }
        process.exit(1);
      }

      // Print URL to set secret values
      try {
        const org = await fetchOrg(config.apiKey, fuseConfig.orgId);
        const url = `https://${org.effectiveDomain}/dashboard/${fuseConfig.orgId}/apps/features/${appId}/secrets`;
        console.log(`\nSet secret values at:\n  ${url}`);
      } catch (error) {
        console.error(
          "Warning: Could not fetch org domain to generate the secrets URL.",
        );
      }
    },
  );
