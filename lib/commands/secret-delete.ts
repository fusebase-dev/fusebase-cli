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

function findFeatureIndex(features: FeatureConfig[], appId: string): number {
  return features.findIndex((f) => f.path === appId);
}

function detectIndent(src: string): number {
  const match = src.match(/^[\t ]*"[^"]+"\s*:/m);
  if (!match) return 2;
  const leading = match[0].match(/^( +)/);
  return leading?.[1]?.length ?? 2;
}

export const secretDeleteCommand = new Command("delete")
  .description(
    "Remove a declared secret key from an app in fusebase.json. The platform " +
      "secret is left untouched (delete it in the FuseBase UI).",
  )
  .option(
    "-a, --app <app>",
    "App path to remove the secret from",
  )
  .addOption(
    new Option("--feature <featureId>", "Deprecated alias for --app").hideHelp(),
  )
  .requiredOption("--secret <key>", "Secret key to remove")
  .action((options: { app?: string; feature?: string; secret: string }) => {
    const appId = options.app ?? options.feature;
    if (!appId) {
      console.error("Error: --app is required.");
      process.exit(1);
    }
    if (options.feature && !options.app) {
      console.warn("[deprecated] --feature is deprecated; use --app instead.");
    }

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
    const featureIndex = findFeatureIndex(features, appId);
    if (featureIndex === -1) {
      console.error(`Error: App "${appId}" not found in ${FUSE_JSON}.`);
      process.exit(1);
    }

    const feature = features[featureIndex]!;
    const declared: AppSecretDeclaration[] = feature.secrets ?? [];
    if (!declared.some((s) => s.key === options.secret)) {
      console.error(
        `Error: Secret "${options.secret}" is not declared for app "${appId}".`,
      );
      process.exit(1);
    }

    feature.secrets = declared.filter((s) => s.key !== options.secret);
    if (feature.secrets.length === 0) delete feature.secrets;

    const raw = readFileSync(fuseJsonPath, "utf-8");
    const indent = detectIndent(raw);
    writeFileSync(
      fuseJsonPath,
      JSON.stringify(fuseConfig, null, indent) + "\n",
      "utf-8",
    );
    invalidateFuseConfigCache();

    console.log(
      `✓ Removed secret "${options.secret}" from app "${appId}" in ${FUSE_JSON}.`,
    );
    console.log(
      "  The platform secret is NOT deleted (deploy never deletes secrets). " +
        "Delete it in the FuseBase UI if you no longer need it.",
    );
  });
