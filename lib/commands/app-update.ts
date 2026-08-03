import { Command } from "commander";
import { resolve } from "node:path";
import { updateApp, fetchApps } from "../api.ts";
import type { AppAccessPrincipal, AppPermissions } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import {
  formatPermissionItem,
  mergeFeaturePermissions,
  mergeSyncedGatePermissions,
  parsePermissions,
  parsePrincipals,
  removeGatePrivilegesFromPermissions,
  seedPermissionsFromRemote,
  unionStoredPermissions,
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
  pruneGatePermissions?: boolean;
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

  if (options.pruneGatePermissions && !options.syncGatePermissions) {
    console.error("Error: --prune-gate-permissions requires --sync-gate-permissions.");
    process.exit(1);
  }

  if (options.pruneGatePermissions && options.permissions !== undefined) {
    console.error(
      "Error: --prune-gate-permissions cannot be combined with --permissions (one grants, the other revokes). Run them separately.",
    );
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
    let prunedGatePrivileges: string[] = [];
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
        pruneGatePermissions: options.pruneGatePermissions,
      });
      // Prune must see both copies or it leaves one behind while reporting success, and
      // deploy re-grants from the one it missed.
      const storedPermissions = unionStoredPermissions(
        app.permissions,
        featureConfig.permissions,
      );
      // Static analysis cannot see a hand-granted privilege, so the synced set is the
      // union of both unless the caller explicitly prunes (NIM-42739).
      const merged = mergeSyncedGatePermissions({
        analyzedGatePermissions: resolved.gatePermissions,
        storedPermissions,
        backendOnlyGatePermissions: resolved.backendOnlyGatePermissions,
        prune: options.pruneGatePermissions,
      });
      gatePermissions = merged.gatePermissions;
      prunedGatePrivileges = merged.removed;
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

    if (options.pruneGatePermissions) {
      if (prunedGatePrivileges.length === 0) {
        console.log("  Prune: no Gate privileges outside the analyzed set.");
      } else {
        console.log(
          `  Removed ${prunedGatePrivileges.length} Gate privilege(s): ${prunedGatePrivileges.join(", ")}`,
        );
        // The same privileges live in fusebase.json once granted, and deploy reconcile
        // republishes from there — leaving them would re-grant on the next deploy.
        const featureConfig = fuseConfig.apps?.find((item) => item.id === appIdArg);
        // manualPermissions is hand-authored, so the CLI does not edit it; it is re-unioned
        // into the snapshot on every analyze and would re-grant silently.
        const stillDeclared = (featureConfig?.fusebaseGateMeta?.manualPermissions ?? []).filter(
          (privilege) => prunedGatePrivileges.includes(privilege),
        );
        if (stillDeclared.length > 0) {
          console.warn(
            `  Warning: ${stillDeclared.join(", ")} still listed in apps[].fusebaseGateMeta.manualPermissions. ` +
              "Remove them there or the next `fusebase deploy` grants them again.",
          );
        }
        if (featureConfig?.permissions) {
          try {
            writeAppPermissionsToFusebaseJson(
              resolve(process.cwd()),
              appIdArg,
              removeGatePrivilegesFromPermissions(featureConfig.permissions, prunedGatePrivileges),
            );
            console.log("  fusebase.json: apps[].permissions pruned");
          } catch (error) {
            console.warn(
              `  Warning: could not prune permissions in fusebase.json (${error instanceof Error ? error.message : String(error)}). ` +
                "`fusebase deploy` will re-grant them.",
            );
          }
        }
      }
    }

    // apps[].permissions is the durable record — the copy that survives a checkout elsewhere,
    // where the remote record is the only other one (NIM-42737).
    if (permissions !== undefined) {
      const featureConfig = fuseConfig.apps?.find((item) => item.id === appIdArg);
      // Writing this entry makes reconcile PATCH the app to match it, so seed it from the remote
      // record when nothing is declared locally — otherwise the first grant would narrow the app
      // to a subset. Gate privileges are seeded minus the ones fusebaseGateMeta already
      // republishes, so --sync-gate-permissions can still prune the analyzed set.
      const localPermissions = featureConfig
        ? mergeFeaturePermissions({
            manualPermissions: permissions,
            existingPermissions:
              featureConfig.permissions ??
              seedPermissionsFromRemote(app.permissions, featureConfig.fusebaseGateMeta?.permissions),
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
  .option("--sync-gate-permissions", "Analyze this app path and sync generated Gate permissions. Merges with the privileges already granted on the app — nothing is removed without --prune-gate-permissions.")
  .option(
    "--prune-gate-permissions",
    "Revoke Gate privileges that the analyzed set does not contain (e.g. a hand-granted app_api.* capability), listing every removal. Requires --sync-gate-permissions.",
  )
  .option(
    "--declare-backend-only-gate-permissions",
    "Opt-in: declare app store permissions (isolated_store.*) as backend-only in manifest.backendOnlyGatePermissions instead of embedding them in the browser gst (gateway apps). Requires --sync-gate-permissions.",
  )
  .action(runAppUpdate);
