import { Command } from "commander";
import { writeFile, access, stat } from "fs/promises";
import { join, relative, isAbsolute } from "path";
import {
  createApp,
  updateApp,
  sendCodingStats,
  type App,
  type AppPermissions,
} from "../api.ts";
import { getConfig, loadFuseConfig, type FeatureConfig } from "../config.ts";
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

function getAppGatePermissions(
  appConfig: FeatureConfig | undefined,
): string[] | undefined {
  const snapshot = appConfig?.fusebaseGateMeta;
  if (!snapshot || snapshot.permissions === undefined) {
    return undefined;
  }

  return snapshot.permissions;
}

export interface AppCreateOptions {
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
}

export async function runAppCreate(options: AppCreateOptions): Promise<void> {
  const fuseJsonPath = join(process.cwd(), FUSE_JSON);

  if (!(await fileExists(fuseJsonPath))) {
    console.error("Error: Product not initialized. Run 'fusebase init' first.");
    process.exit(1);
  }

  const fuseConfig = loadFuseConfig();
  if (!fuseConfig || !fuseConfig.orgId || !fuseConfig.productId) {
    console.error("Error: Invalid fusebase.json. Missing orgId or productId.");
    process.exit(1);
  }

  const config = getConfig();
  if (!config.apiKey) {
    console.error(
      "Error: No API key configured. Run 'fusebase auth' first.",
    );
    process.exit(1);
  }

  const cwd = process.cwd();
  const appPath = toRelativePath(options.path, cwd);

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
        `Error: backend/ folder detected in app ${appPath}, but --backend-dev-command, --backend-build-command, --backend-start-command were not provided.\n` +
          `Either provide them or remove the folder.`,
      );
      process.exit(1);
    }
  }

  const localAppConfig = fuseConfig.apps?.find(
    (app) => app.path === appPath,
  );
  const gatePermissions = getAppGatePermissions(localAppConfig);

  let permissions: AppPermissions | undefined;
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

  let createdApp: App;
  try {
    createdApp = await createApp(
      config.apiKey,
      fuseConfig.orgId,
      fuseConfig.productId,
      options.name.trim(),
      options.subdomain.trim(),
    );
    console.log(`✓ Created app: ${createdApp.title}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error: Failed to create app:", error.message);
    } else {
      console.error("Error: Failed to create app.");
    }
    process.exit(1);
  }

  if (options.codingAgent || options.model) {
    sendCodingStats(config.apiKey, fuseConfig.orgId, fuseConfig.productId, {
      codingAgent: options.codingAgent,
      model: options.model,
      appId: createdApp.id,
    }).catch(() => {});
  }

  let accessPrincipals:
    | import("../api.ts").AppAccessPrincipal[]
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
      accessPrincipals?: import("../api.ts").AppAccessPrincipal[];
      permissions?: AppPermissions;
    } = {};

    if (accessPrincipals !== undefined) {
      updateRequest.accessPrincipals = accessPrincipals;
    }

    if (mergedPermissions !== undefined) {
      updateRequest.permissions = mergedPermissions;
    }

    try {
      await updateApp(
        config.apiKey,
        fuseConfig.orgId,
        fuseConfig.productId,
        createdApp.id,
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
        `Warning: Failed to update app settings. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const conflictingApp = fuseConfig.apps?.find(
    (f) => f.path === appPath && f.id !== createdApp.id,
  );
  if (conflictingApp) {
    console.error(
      `Error: Path "${appPath}" is already used by another app (${conflictingApp.id}).`,
    );
    process.exit(1);
  }

  fuseConfig.apps = fuseConfig.apps || [];
  const isFirstApp = fuseConfig.apps.length === 0;
  const existingIndex = fuseConfig.apps.findIndex(
    (f) => f.id === createdApp.id,
  );
  const newAppConfig: FeatureConfig = {
    id: createdApp.id,
    path: appPath,
    dev: { command: options.devCommand },
    build: {
      command: options.buildCommand,
      outputDir: options.outputDir,
    },
  };

  const hasBackendConfig = hasBackendFlags;
  if (hasBackendConfig) {
    newAppConfig.backend = {
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
    fuseConfig.apps[existingIndex] = newAppConfig;
  } else {
    fuseConfig.apps.push(newAppConfig);
  }

  if (isFirstApp && createdApp.sub) {
    (fuseConfig as Record<string, unknown>)["firstAppSub"] = createdApp.sub;
  }

  await writeFile(
    fuseJsonPath,
    JSON.stringify(fuseConfig, null, 2),
    "utf-8",
  );

  console.log("");
  console.log("✓ Development mode configured");
  console.log(`  App: ${createdApp.title}`);
  console.log(`  App path: ${appPath}`);
  console.log(`  Dev command: ${options.devCommand}`);
  console.log(`  Build command: ${options.buildCommand}`);
  console.log(`  Build output: ${options.outputDir}`);
  if (newAppConfig.backend) {
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
}

export const appCreateCommand = new Command("create")
  .description("Create and configure a new app for development")
  .requiredOption("--name <name>", "Name for the new app")
  .requiredOption(
    "--subdomain <subdomain>",
    "Subdomain for the app (e.g., my-app)",
  )
  .requiredOption(
    "--path <path>",
    "Path to the app folder (e.g., apps/product-add)",
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
    "Set app permissions (format: dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read)",
  )
  .option(
    "--backend-dev-command <command>",
    "Backend dev command (e.g., npm run dev). Only if the app has a backend/ folder.",
  )
  .option(
    "--backend-build-command <command>",
    "Backend build command (e.g., npm run build). Only if the app has a backend/ folder.",
  )
  .option(
    "--backend-start-command <command>",
    "Backend start command for production (e.g., npm run start). Only if the app has a backend/ folder.",
  )
  .option("--coding-agent <name>", "Coding agent identifier (e.g. claude_code, cursor, copilot, codex)")
  .option("--model <name>", "Model identifier (e.g. claude-opus-4-6, gpt-5)")
  .action(runAppCreate);
