import { Command } from "commander";
import { resolve } from "node:path";
import { updateApp, fetchApps } from "../api.ts";
import type { AppAccessPrincipal, AppPermissions } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import {
  formatPermissionItem,
  mergeFeaturePermissions,
  parsePermissions,
  parsePrincipals,
} from "../permissions.ts";
import { resolveGateSyncPermissions } from "../sync-app-gate-permissions.ts";
import {
  writeAppPermissionsToFusebaseJson,
  writeBackendOnlyGatePermissionsToFusebaseJson,
} from "../config.ts";

export interface AppUpdateOptions {
  access?: string;
  permissions?: string;
  syncGatePermissions?: boolean;
  declareBackendOnlyGatePermissions?: boolean;
}

export async function runAppUpdate(appIdArg: string, options: AppUpdateOptions): Promise<void> {
  const config = getConfig();
  const fuseConfig = loadFuseConfig();

  if (!config.apiKey) {
    console.error("Error: Not authenticated. Run 'fusebase auth' or 'fusebase auth --api-key=<apiKey>' first.");
    process.exit(1);
  }

  if (!fuseConfig) {
    console.error("Error: No fusebase.json found. Run 'fusebase init' first.");
    process.exit(1);
  }

  const { orgId, productId } = fuseConfig;

  if (!orgId || !productId) {
    console.error("Error: fusebase.json is missing orgId or productId.");
    process.exit(1);
  }

  if (
    options.access === undefined &&
    options.permissions === undefined &&
    !options.syncGatePermissions
  ) {
    console.error("Error: No update options provided. Use --access=<principals>, --permissions=..., or --sync-gate-permissions.");
    process.exit(1);
  }

  if (options.declareBackendOnlyGatePermissions && !options.syncGatePermissions) {
    console.error("Error: --declare-backend-only-gate-permissions requires --sync-gate-permissions.");
    process.exit(1);
  }

  let accessPrincipals: AppAccessPrincipal[] | undefined;
  if (options.access !== undefined) {
    try {
      accessPrincipals = parsePrincipals(options.access);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  let permissions: AppPermissions | undefined;
  if (options.permissions !== undefined) {
    try {
      permissions = parsePermissions(options.permissions);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  try {
    const appsResponse = await fetchApps(config.apiKey, orgId, productId);
    const app = appsResponse.apps.find(f => f.id === appIdArg);

    if (!app) {
      console.error(`Error: App with ID '${appIdArg}' not found.`);
      process.exit(1);
    }

    let gatePermissions: string[] | undefined;
    let backendOnlyGatePermissions: string[] | undefined;
    let backendOnlyDeclaredInFusebaseJson = false;
    if (options.syncGatePermissions) {
      const featureConfig = fuseConfig.apps?.find((item) => item.id === appIdArg);
      if (!featureConfig) {
        console.error(`Error: App with ID '${appIdArg}' is missing from local fusebase.json.`);
        process.exit(1);
      }
      if (!featureConfig.path) {
        console.error(`Error: App with ID '${appIdArg}' is missing "path" in fusebase.json.`);
        process.exit(1);
      }

      const resolved = await resolveGateSyncPermissions({
        cwd: resolve(process.cwd()),
        apiKey: config.apiKey,
        featureConfig,
        appManifest: app.manifest,
        declareBackendOnlyGatePermissions: options.declareBackendOnlyGatePermissions,
      });
      gatePermissions = resolved.gatePermissions;
      backendOnlyGatePermissions = resolved.backendOnlyGatePermissions;
      backendOnlyDeclaredInFusebaseJson = resolved.backendOnlyDeclaredInFusebaseJson;
    }

    const updateRequest: {
      accessPrincipals?: AppAccessPrincipal[];
      permissions?: AppPermissions;
      manifest?: Record<string, unknown>;
    } = {};

    if (accessPrincipals !== undefined) {
      updateRequest.accessPrincipals = accessPrincipals;
    }

    if (permissions !== undefined || options.syncGatePermissions) {
      updateRequest.permissions = mergeFeaturePermissions({
        manualPermissions: permissions,
        existingPermissions: app.permissions,
        gatePermissions,
      });
    }

    if (backendOnlyGatePermissions !== undefined) {
      updateRequest.manifest = {
        ...(app.manifest ?? {}),
        backendOnlyGatePermissions,
      };
    }

    const updatedApp = await updateApp(
      config.apiKey,
      orgId,
      productId,
      appIdArg,
      updateRequest
    );

    console.log(`✓ App '${updatedApp.title}' updated successfully.`);

    if (accessPrincipals !== undefined) {
      const summary = accessPrincipals.map(p => p.id ? `${p.type}:${p.id}` : p.type).join(', ') || 'none';
      console.log(`  Access principals: ${summary}`);
      if (updatedApp.url) {
        console.log(`  URL: ${updatedApp.url}`);
      }
    }

    if (updateRequest.permissions !== undefined) {
      console.log(`  Permissions: ${updateRequest.permissions.items.length} item(s) configured`);
      for (const item of updateRequest.permissions.items) {
        console.log(`    - ${formatPermissionItem(item)}`);
      }
    }

    // Deploy reconcile rebuilds the permission set from fusebase.json alone, so a grant that
    // only reached the remote record is reverted by the next `fusebase deploy` (NIM-42737).
    if (permissions !== undefined) {
      const featureConfig = fuseConfig.apps?.find((item) => item.id === appIdArg);
      // Writing this entry makes reconcile PATCH the app to match it, so seed the resource
      // section from the remote record when nothing is declared locally — otherwise the first
      // grant would narrow the app to a subset. Remote gate privileges are left out on purpose:
      // fusebaseGateMeta already carries the analyzed ones, and copying them here would leave a
      // later --sync-gate-permissions unable to prune them.
      const localPermissions = featureConfig
        ? mergeFeaturePermissions({
            manualPermissions: permissions,
            existingPermissions: featureConfig.permissions ?? {
              items: app.permissions?.items.filter((item) => item.type !== "gate") ?? [],
            },
          })
        : undefined;

      if (localPermissions) {
        try {
          writeAppPermissionsToFusebaseJson(resolve(process.cwd()), appIdArg, localPermissions);
          console.log("  fusebase.json: apps[].permissions updated");
        } catch (error) {
          console.warn(
            `  Warning: could not persist permissions to fusebase.json (${error instanceof Error ? error.message : String(error)}). ` +
              "The grant is on the app record but `fusebase deploy` will revert it.",
          );
        }
      } else {
        console.warn(
          `  Warning: app '${appIdArg}' is not in fusebase.json, so the grant was not persisted locally. ` +
            "`fusebase deploy` from a project that declares this app will revert it.",
        );
      }
    }

    if (backendOnlyGatePermissions !== undefined) {
      if (backendOnlyGatePermissions.length > 0) {
        console.log(
          `  Backend-only Gate permissions (manifest.backendOnlyGatePermissions): ${backendOnlyGatePermissions.join(", ")}`,
        );
      }
      if (
        options.syncGatePermissions &&
        (backendOnlyGatePermissions.length > 0 || backendOnlyDeclaredInFusebaseJson)
      ) {
        try {
          writeBackendOnlyGatePermissionsToFusebaseJson(
            resolve(process.cwd()),
            appIdArg,
            backendOnlyGatePermissions,
          );
          console.log(
            backendOnlyGatePermissions.length > 0
              ? "  fusebase.json: backendOnlyGatePermissions updated"
              : "  fusebase.json: backendOnlyGatePermissions cleared",
          );
        } catch {
          // Non-fatal: remote manifest is still updated; local fusebase.json may be read-only or missing entry.
        }
      }
    }
  } catch (error) {
    console.error(`Error: Failed to update app. ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const appUpdateCommand = new Command("update")
  .description("Update an app's settings")
  .argument("<appId>", "App ID to update")
  .option("--access <principals>", "Set access principals, comma-separated (e.g., visitor, org roles like orgRole:member, or portal principals portalClient/portalManager/portalMember)")
  .option("--permissions <permissions>", "Set app permissions (format: dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read;app_api.namespace.capability.read). Resource permissions replace the remote set; Gate privileges are added to it.")
  .option("--sync-gate-permissions", "Analyze this app path and sync generated Gate permissions")
  .option(
    "--declare-backend-only-gate-permissions",
    "Opt-in: declare app store permissions (isolated_store.*) as backend-only in manifest.backendOnlyGatePermissions instead of embedding them in the browser gst (gateway apps). Requires --sync-gate-permissions.",
  )
  .action(runAppUpdate);
