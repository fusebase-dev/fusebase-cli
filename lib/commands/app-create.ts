import { Command } from "commander";
import { writeFile, access, stat } from "fs/promises";
import { join, relative, isAbsolute } from "path";
import {
  type AppPermissions,
} from "../api.ts";
import {
  loadFuseConfig,
  type FeatureConfig,
} from "../config.ts";
import {
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

  // Declarative model (NIM-41989): `app create` only writes the fusebase.json
  // entry; the real platform app is created later by `fusebase deploy` reconcile.
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

  const appSub = options.subdomain.trim();
  const appTitle = options.name.trim();

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
  // No platform app id yet, so access/permissions can't be applied now. Persist
  // them on the fusebase.json entry (below) so deploy-time reconcile applies
  // them when it binds/creates the platform app.
  if (needsUpdate) {
    console.log(
      "Note: --access/--permissions are recorded in fusebase.json and applied " +
        "on the next `fusebase deploy`.",
    );
  }

  // Entry identity is the `subdomain`.
  const isSameApp = (f: FeatureConfig) => f.subdomain === appSub;
  const conflictingApp = fuseConfig.apps?.find(
    (f) => f.path === appPath && !isSameApp(f),
  );
  if (conflictingApp) {
    console.error(
      `Error: Path "${appPath}" is already used by another app (${conflictingApp.id ?? conflictingApp.subdomain}).`,
    );
    process.exit(1);
  }

  fuseConfig.apps = fuseConfig.apps || [];
  const isFirstApp = fuseConfig.apps.length === 0;
  const existingIndex = fuseConfig.apps.findIndex(isSameApp);
  // Preserve an id already resolved on the matched entry (e.g. deploy write-back),
  // so re-running `app create` never drops a valid platform id.
  const resolvedId =
    existingIndex >= 0 ? fuseConfig.apps[existingIndex]?.id : undefined;
  const newAppConfig: FeatureConfig = {
    ...(resolvedId ? { id: resolvedId } : {}),
    subdomain: appSub,
    name: appTitle,
    // Stored so deploy/dev-start reconcile can send them when it creates the
    // app — `app create` no longer creates it (NIM-41997).
    ...(options.codingAgent ? { codingAgent: options.codingAgent } : {}),
    ...(options.model ? { model: options.model } : {}),
    // Declared access/permissions live in the manifest and are applied at
    // deploy-time reconcile; `permissions` holds the manual items only (gate
    // permissions are merged in from `fusebaseGateMeta` at apply time).
    ...(accessPrincipals !== undefined ? { access: accessPrincipals } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
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

  if (isFirstApp && appSub) {
    (fuseConfig as Record<string, unknown>)["firstAppSub"] = appSub;
  }

  await writeFile(
    fuseJsonPath,
    JSON.stringify(fuseConfig, null, 2),
    "utf-8",
  );

  console.log("");
  console.log(
    `✓ Added app "${appTitle}" to fusebase.json (created on next \`fusebase deploy\`)`,
  );
  console.log("✓ Development mode configured");
  console.log(`  App: ${appTitle}`);
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
    "Set access principals, comma-separated (e.g., visitor, org roles like orgRole:member, or portal principals portalClient/portalManager/portalMember)",
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
