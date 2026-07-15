import { Command, Option } from "commander";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import {
  loadFuseConfig,
  invalidateFuseConfigCache,
  type AppSecretDeclaration,
  type FeatureConfig,
} from "../config";

const FUSE_JSON = "fusebase.json";

// `secret create` is a local fusebase.json edit — the real platform secret is
// registered at deploy/dev-start reconcile. `--app` is matched by local `path`
// (no platform id yet).
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

const APP_OPTION_DESCRIPTION = "App path to add the secret to";

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
 * Write the keys into the app's `secrets` array in fusebase.json. Idempotent —
 * updates the description if a key already exists, appends otherwise. No
 * network; the platform secret is registered at deploy/dev-start reconcile with
 * an empty value for the human to fill in the UI.
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

export const secretCreateCommand = new Command("create")
  .description(
    "Declare secret keys for an app in fusebase.json (values are set in the UI). " +
      "Missing keys are registered on the platform on the next `fusebase deploy` / `fusebase dev start`.",
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

      runDeclarative(appId, options.secret);
    },
  );
