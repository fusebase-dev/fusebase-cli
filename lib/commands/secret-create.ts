import { Command, Option } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadFuseConfig,
  invalidateFuseConfigCache,
  getConfig,
  hasFlag,
  type AppSecretDeclaration,
  type FeatureConfig,
} from "../config";
import { setAppSecrets, fetchOrg } from "../api";

const FUSE_JSON = "fusebase.json";

// The declarative model (behind the flag) turns `secret create` into a local
// fusebase.json edit — the real platform secret is registered at deploy/dev-start
// reconcile. Legacy (flag off) keeps the original behavior: register the key on
// the platform immediately. `--app` is matched by local `path` in declarative
// mode (no platform id yet) and used as the platform app id in legacy mode.
const DECLARATIVE = hasFlag("declarative-manifest");

function findFeatureIndex(features: FeatureConfig[], appPath: string): number {
  return features.findIndex((f) => f.path === appPath);
}

function availableAppsLabel(features: FeatureConfig[]): string {
  return (
    features
      .map((f) => f.path)
      .filter(Boolean)
      .join(", ") || "(none)"
  );
}

const APP_OPTION_DESCRIPTION = DECLARATIVE
  ? "App path to add the secret to"
  : "App ID to add the secret to";

function detectIndent(src: string): number {
  const match = src.match(/^[\t ]*"[^"]+"\s*:/m);
  if (!match) return 2;
  const leading = match[0].match(/^( +)/);
  return leading?.[1]?.length ?? 2;
}

function parseSecretArg(
  value: string,
  previous: AppSecretDeclaration[],
): AppSecretDeclaration[] {
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

/**
 * Declarative path (flag on): write the keys into the app's `secrets` array in
 * fusebase.json. Idempotent — updates the description if a key already exists,
 * appends otherwise. No network; the platform secret is registered at
 * deploy/dev-start reconcile with an empty value for the human to fill in the UI.
 */
function runDeclarative(appPath: string, secrets: AppSecretDeclaration[]): void {
  const fuseJsonPath = join(process.cwd(), FUSE_JSON);
  if (!existsSync(fuseJsonPath)) {
    console.error(`Error: ${FUSE_JSON} not found in current directory.`);
    process.exit(1);
  }

  const fuseConfig = loadFuseConfig();
  if (!fuseConfig) {
    console.error(`Error: Failed to parse ${FUSE_JSON}.`);
    process.exit(1);
  }

  const features = fuseConfig.apps ?? [];
  const featureIndex = findFeatureIndex(features, appPath);
  if (featureIndex === -1) {
    console.error(
      `Error: App "${appPath}" not found in ${FUSE_JSON}. Available apps: ${availableAppsLabel(features)}`,
    );
    process.exit(1);
  }

  const feature = features[featureIndex]!;
  const declared: AppSecretDeclaration[] = feature.secrets ?? [];

  const merged = [...declared];
  const added: string[] = [];
  const updated: string[] = [];
  for (const entry of secrets) {
    const existing = merged.find((s) => s.key === entry.key);
    if (existing) {
      if (existing.description !== entry.description) {
        existing.description = entry.description;
        updated.push(entry.key);
      }
    } else {
      merged.push(entry);
      added.push(entry.key);
    }
  }

  feature.secrets = merged;

  const raw = readFileSync(fuseJsonPath, "utf-8");
  const indent = detectIndent(raw);
  writeFileSync(
    fuseJsonPath,
    JSON.stringify(fuseConfig, null, indent) + "\n",
    "utf-8",
  );
  invalidateFuseConfigCache();

  const summary =
    (added.length ? `added ${added.join(", ")}` : "") +
      (added.length && updated.length ? "; " : "") +
      (updated.length ? `updated ${updated.join(", ")}` : "") ||
    "no changes (already declared)";
  console.log(`✓ Secret keys for app "${appPath}" in ${FUSE_JSON}: ${summary}`);
  console.log(
    "  Keys are registered on the platform on the next `fusebase deploy` / " +
      "`fusebase dev start`. Set their values in the FuseBase UI.",
  );
}

/**
 * Legacy path (flag off): register the keys on the platform immediately (with
 * empty values) and print the UI URL to set their values.
 */
async function runLegacy(
  appId: string,
  secrets: AppSecretDeclaration[],
): Promise<void> {
  const fuseConfig = loadFuseConfig();
  if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.productId) {
    console.error(
      "Error: Invalid fusebase.json. Missing orgId or productId. Run 'fusebase init' first.",
    );
    process.exit(1);
  }

  const config = getConfig();
  if (!config.apiKey) {
    console.error("Error: No API key configured. Run 'fusebase auth' first.");
    process.exit(1);
  }

  const payload = secrets.map((s) => ({
    key: s.key,
    value: "",
    description: s.description,
  }));

  try {
    const result = await setAppSecrets(
      config.apiKey,
      fuseConfig.orgId,
      fuseConfig.productId,
      appId,
      payload,
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

  try {
    const org = await fetchOrg(config.apiKey, fuseConfig.orgId);
    const url = `https://${org.effectiveDomain}/dashboard/${fuseConfig.orgId}/apps/features/${appId}/secrets`;
    console.log(`\nSet secret values at:\n  ${url}`);
  } catch (error) {
    console.error(
      "Warning: Could not fetch org domain to generate the secrets URL.",
    );
  }
}

export const secretCreateCommand = new Command("create")
  .description(
    DECLARATIVE
      ? "Declare secret keys for an app in fusebase.json (values are set in the UI). " +
          "Missing keys are registered on the platform on the next `fusebase deploy` / `fusebase dev start`."
      : "Create secrets (with empty values) for an app and print the URL to set their values",
  )
  .option("-a, --app <app>", APP_OPTION_DESCRIPTION)
  .addOption(
    new Option("--feature <featureId>", "Deprecated alias for --app").hideHelp(),
  )
  .requiredOption(
    "--secret <key:description>",
    "Secret to declare (format: KEY or KEY:description). Repeatable for multiple secrets.",
    parseSecretArg,
    [] as AppSecretDeclaration[],
  )
  .action(
    async (options: {
      app?: string;
      feature?: string;
      secret: AppSecretDeclaration[];
    }) => {
      const appId = options.app ?? options.feature;
      if (!appId) {
        console.error("Error: --app is required.");
        process.exit(1);
      }
      if (options.feature && !options.app) {
        console.warn("[deprecated] --feature is deprecated; use --app instead.");
      }
      if (options.secret.length === 0) {
        console.error("Error: At least one --secret is required.");
        process.exit(1);
      }

      // Reject duplicate keys within this invocation.
      const keys = options.secret.map((s) => s.key);
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (dupes.length > 0) {
        console.error(
          `Error: Duplicate secret keys: ${[...new Set(dupes)].join(", ")}`,
        );
        process.exit(1);
      }

      if (DECLARATIVE) {
        runDeclarative(appId, options.secret);
      } else {
        await runLegacy(appId, options.secret);
      }
    },
  );
