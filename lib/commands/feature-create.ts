import { Command } from "commander";
import { writeFile, access, stat } from "fs/promises";
import { join, relative, isAbsolute } from "path";
import {
  createAppFeature,
  updateAppFeature,
  sendCodingStats,
  type AppFeature,
  type AppFeaturePermissions,
} from "../api.ts";
import { getConfig, hasFlag, loadFuseConfig, type FeatureConfig } from "../config.ts";
import {
  formatPermissionItem,
  mergeFeaturePermissions,
  parsePermissions,
  parsePrincipals,
} from "../permissions.ts";

const FUSE_JSON = "fusebase.json";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function toRelativePath(inputPath: string, cwd: string): string {
  if (!inputPath) return inputPath;

  if (isAbsolute(inputPath)) {
    return relative(cwd, inputPath).replace("\\", "/");
  }

  return inputPath.replace("\\", "/");
}

function getFeatureGatePermissions(
  featureConfig: FeatureConfig | undefined,
): string[] | undefined {
  const snapshot = featureConfig?.fusebaseGateMeta;
  if (!snapshot || snapshot.permissions === undefined) {
    return undefined;
  }

  return snapshot.permissions;
}

export const featureCreateCommand = new Command("create")
  .description("Create and configure a new feature for development")
  .requiredOption("--name <name>", "Name for the new feature")
  .requiredOption(
    "--subdomain <subdomain>",
    "Subdomain for the feature (e.g., my-feature)",
  )
  .requiredOption(
    "--path <path>",
    "Path to the feature folder (e.g., features/product-add)",
  )
  .requiredOption(
    "--dev-command <command>",
    "Dev server command (e.g., npm run dev)",
  )
  .requiredOption(
    "--build-command <command>",
    "Build command (e.g., npm run build)",
  )
  .requiredOption("--output-dir <dir>", "Build output directory (e.g., dist)")
  .option(
    "--access <principals>",
    "Set access principals, comma-separated (e.g., visitor or the org roles like orgRole:member, etc.)",
  )
  .option(
    "--permissions <permissions>",
    "Set feature permissions (format: dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read)",
  )
  .option(
    "--backend-dev-command <command>",
    "Backend dev command (e.g., npm run dev). Only if the feature has a backend/ folder.",
  )
  .option(
    "--backend-build-command <command>",
    "Backend build command (e.g., npm run build). Only if the feature has a backend/ folder.",
  )
  .option(
    "--backend-start-command <command>",
    "Backend start command for production (e.g., npm run start). Only if the feature has a backend/ folder.",
  )
  .option("--coding-agent <name>", "Coding agent identifier (e.g. claude_code, cursor, copilot, codex)")
  .option("--model <name>", "Model identifier (e.g. claude-opus-4-6, gpt-5)")
  .action(
    async (options: {
      name: string;
      subdomain: string;
      path: string;
      devCommand: string;
      buildCommand: string;
      outputDir: string;
      access?: string;
      permissions?: string;
      backendDevCommand?: string;
      backendBuildCommand?: string;
      backendStartCommand?: string;
      codingAgent?: string;
      model?: string;
    }) => {
      const fuseJsonPath = join(process.cwd(), FUSE_JSON);

      // Check if app is initialized
      if (!(await fileExists(fuseJsonPath))) {
        console.error("Error: App not initialized. Run 'fusebase init' first.");
        process.exit(1);
      }

      // Load fusebase.json
      const fuseConfig = loadFuseConfig();
      if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.appId) {
        console.error("Error: Invalid fusebase.json. Missing orgId or appId.");
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

      const cwd = process.cwd();
      const featurePath = toRelativePath(options.path, cwd);

      // Check if backend/ folder exists without backend flags being provided
      const hasBackendFlags =
        options.backendDevCommand ||
        options.backendBuildCommand ||
        options.backendStartCommand;
      if (!hasBackendFlags) {
        const backendDir = join(
          isAbsolute(options.path) ? options.path : join(cwd, options.path),
          "backend",
        );
        const backendExists = await stat(backendDir)
          .then((s) => s.isDirectory())
          .catch(() => false);
        if (backendExists) {
          console.error(
            `Error: backend/ folder detected in feature ${featurePath}, but --backend-dev-command, --backend-build-command, --backend-start-command were not provided.\n` +
              `Either provide them or remove the folder.`,
          );
          process.exit(1);
        }
      }

      const localFeatureConfig = fuseConfig.features?.find(
        (feature) => feature.path === featurePath,
      );
      const gatePermissions = getFeatureGatePermissions(localFeatureConfig);

      // Validate and parse permissions early if provided
      let permissions: AppFeaturePermissions | undefined;
      if (options.permissions !== undefined) {
        try {
          permissions = parsePermissions(options.permissions);
        } catch (error) {
          console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        }
      }

      // Create the feature
      let selectedFeature: AppFeature;
      try {
        selectedFeature = await createAppFeature(
          config.apiKey,
          fuseConfig.orgId,
          fuseConfig.appId,
          options.name.trim(),
          options.subdomain.trim(),
        );
        console.log(`✓ Created feature: ${selectedFeature.title}`);
      } catch (error) {
        if (error instanceof Error) {
          console.error("Error: Failed to create feature:", error.message);
        } else {
          console.error("Error: Failed to create feature.");
        }
        process.exit(1);
      }

      // Fire-and-forget: send coding stats if analytics enabled and agent or model provided
      if (hasFlag("analytics") && (options.codingAgent || options.model)) {
        sendCodingStats(config.apiKey, fuseConfig.orgId, fuseConfig.appId, {
          codingAgent: options.codingAgent,
          model: options.model,
          appFeatureId: selectedFeature.id,
        }).catch(() => {});
      }

      // Handle access principals and permissions if specified
      let accessPrincipals:
        | import("../api.ts").AppFeatureAccessPrincipal[]
        | undefined;
      if (options.access !== undefined) {
        try {
          accessPrincipals = parsePrincipals(options.access);
        } catch (error) {
          console.error(
            `Error: ${error instanceof Error ? error.message : String(error)}`,
          );
          process.exit(1);
        }
      }

      const mergedPermissions = mergeFeaturePermissions({
        manualPermissions: permissions,
        gatePermissions,
      });
      const needsUpdate =
        accessPrincipals !== undefined || mergedPermissions !== undefined;
      if (needsUpdate) {
        const updateRequest: {
          accessPrincipals?: import("../api.ts").AppFeatureAccessPrincipal[];
          permissions?: AppFeaturePermissions;
        } = {};

        if (accessPrincipals !== undefined) {
          updateRequest.accessPrincipals = accessPrincipals;
        }

        if (mergedPermissions !== undefined) {
          updateRequest.permissions = mergedPermissions;
        }

        try {
          await updateAppFeature(
            config.apiKey,
            fuseConfig.orgId,
            fuseConfig.appId,
            selectedFeature.id,
            updateRequest,
          );
          if (accessPrincipals !== undefined) {
            console.log(
              `✓ Access principals set: ${accessPrincipals.map((p) => (p.id ? `${p.type}:${p.id}` : p.type)).join(", ") || "none"}`,
            );
          }
          if (mergedPermissions !== undefined) {
            console.log(
              `✓ Permissions configured: ${mergedPermissions.items.length} item(s)`,
            );
            for (const item of mergedPermissions.items) {
              console.log(`    - ${formatPermissionItem(item)}`);
            }
          }
        } catch (error) {
          console.error(
            `Warning: Failed to update feature settings. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Check if path is already used by another feature
      const conflictingFeature = fuseConfig.features?.find(
        (f) => f.path === featurePath && f.id !== selectedFeature.id,
      );
      if (conflictingFeature) {
        console.error(
          `Error: Path "${featurePath}" is already used by another feature (${conflictingFeature.id}).`,
        );
        process.exit(1);
      }

      // Update fusebase.json
      fuseConfig.features = fuseConfig.features || [];
      const isFirstFeature = fuseConfig.features.length === 0;
      const existingIndex = fuseConfig.features.findIndex(
        (f) => f.id === selectedFeature.id,
      );
      const newFeatureConfig: FeatureConfig = {
        id: selectedFeature.id,
        path: featurePath,
        dev: { command: options.devCommand },
        build: {
          command: options.buildCommand,
          outputDir: options.outputDir,
        },
      };

      const hasBackendConfig = hasBackendFlags;
      if (hasBackendConfig) {
        newFeatureConfig.backend = {
          ...(options.backendDevCommand && {
            dev: { command: options.backendDevCommand },
          }),
          ...(options.backendBuildCommand && {
            build: { command: options.backendBuildCommand },
          }),
          ...(options.backendStartCommand && {
            start: { command: options.backendStartCommand },
          }),
        };
      }
      if (existingIndex >= 0) {
        fuseConfig.features[existingIndex] = newFeatureConfig;
      } else {
        fuseConfig.features.push(newFeatureConfig);
      }

      // Save firstFeatureSub for the first feature created
      if (isFirstFeature && selectedFeature.sub) {
        (fuseConfig as Record<string, unknown>)["firstFeatureSub"] =
          selectedFeature.sub;
      }

      await writeFile(
        fuseJsonPath,
        JSON.stringify(fuseConfig, null, 2),
        "utf-8",
      );

      console.log("");
      console.log("✓ Development mode configured");
      console.log(`  Feature: ${selectedFeature.title}`);
      console.log(`  Feature path: ${featurePath}`);
      console.log(`  Dev command: ${options.devCommand}`);
      console.log(`  Build command: ${options.buildCommand}`);
      console.log(`  Build output: ${options.outputDir}`);
      if (newFeatureConfig.backend) {
        if (options.backendDevCommand)
          console.log(`  Backend dev command: ${options.backendDevCommand}`);
        if (options.backendBuildCommand)
          console.log(
            `  Backend build command: ${options.backendBuildCommand}`,
          );
        if (options.backendStartCommand)
          console.log(
            `  Backend start command: ${options.backendStartCommand}`,
          );
      }
    },
  );
