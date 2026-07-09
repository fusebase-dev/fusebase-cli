import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fetchApps, updateApp } from "./api.ts";
import type { App, AppAccessPrincipal, AppPermissions } from "./api.ts";
import { loadFuseConfig, writeBackendOnlyGatePermissionsToFusebaseJson } from "./config.ts";
import { analyzeFeatureGatePermissions } from "./gate-sdk-analyze.ts";
import {
  buildSyncedBackendOnlyGatePermissions,
  declareStorePermissionsBackendOnly,
  formatPermissionItem,
  isBackendOnlyGatePermissionsDeclared,
  isStoreGatePermission,
  mergeFeaturePermissions,
  readBackendOnlyGatePermissionsFromFeature,
  readBackendOnlyGatePermissionsFromManifest,
  splitGatePermissionStrings,
} from "./permissions.ts";

export interface SyncAppGatePermissionsOptions {
  cwd?: string;
  apiKey: string;
  orgId: string;
  productId: string;
  appId: string;
  declareBackendOnlyGatePermissions?: boolean;
  quiet?: boolean;
}

export interface SyncAppGatePermissionsResult {
  app: App;
  gatePermissions: string[];
  backendOnlyGatePermissions?: string[];
}

export async function syncAppGatePermissions(
  options: SyncAppGatePermissionsOptions,
): Promise<SyncAppGatePermissionsResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const fuseConfig = loadFuseConfig();
  if (!fuseConfig) {
    throw new Error("No fusebase.json found. Run fusebase init first.");
  }

  const featureConfig = fuseConfig.apps?.find((item) => item.id === options.appId);
  if (!featureConfig) {
    throw new Error(
      `App with ID '${options.appId}' is missing from local fusebase.json.`,
    );
  }
  if (!featureConfig.path) {
    throw new Error(
      `App with ID '${options.appId}' is missing "path" in fusebase.json.`,
    );
  }

  const appsResponse = await fetchApps(
    options.apiKey,
    options.orgId,
    options.productId,
  );
  const app = appsResponse.apps.find((item) => item.id === options.appId);
  if (!app) {
    throw new Error(`App with ID '${options.appId}' not found on the platform.`);
  }

  const gateAnalysis = await analyzeFeatureGatePermissions({
    projectRoot: cwd,
    feature: featureConfig,
    apiKey: options.apiKey,
    alwaysResolvePermissions: true,
    throwOnResolveFailure: true,
  });
  const split = splitGatePermissionStrings(gateAnalysis.gatePermissions);
  let gatePermissions = split.runtimePermissions;

  let declaredStoreBackendOnly: string[] = [];
  if (options.declareBackendOnlyGatePermissions) {
    const declared = declareStorePermissionsBackendOnly(gatePermissions);
    gatePermissions = declared.runtimePermissions;
    declaredStoreBackendOnly = declared.backendOnlyPermissions;
  }

  const backendOnlyDeclaredInFusebaseJson =
    isBackendOnlyGatePermissionsDeclared(featureConfig);
  const backendOnlyGatePermissions = buildSyncedBackendOnlyGatePermissions({
    platformBackendOnly: split.backendOnlyPermissions,
    declaredStoreBackendOnly,
    fromFusebaseJson: readBackendOnlyGatePermissionsFromFeature(featureConfig),
    fusebaseJsonDeclared: backendOnlyDeclaredInFusebaseJson,
    fromRemoteManifest: readBackendOnlyGatePermissionsFromManifest(app.manifest),
  });

  if (
    !options.declareBackendOnlyGatePermissions &&
    !options.quiet &&
    existsSync(join(cwd, featureConfig.path, "backend")) &&
    gatePermissions.some(isStoreGatePermission)
  ) {
    console.warn(
      "Warning: store permissions will be embedded in browser gst. For gateway apps use --declare-backend-only-gate-permissions.",
    );
  }

  const updateRequest: {
    accessPrincipals?: AppAccessPrincipal[];
    permissions?: AppPermissions;
    manifest?: Record<string, unknown>;
  } = {
    permissions: mergeFeaturePermissions({
      existingPermissions: app.permissions,
      gatePermissions,
    }),
  };

  if (backendOnlyGatePermissions !== undefined) {
    updateRequest.manifest = {
      ...(app.manifest ?? {}),
      backendOnlyGatePermissions,
    };
  }

  const updatedApp = await updateApp(
    options.apiKey,
    options.orgId,
    options.productId,
    options.appId,
    updateRequest,
  );

  if (!options.quiet) {
    console.log(`✓ App '${updatedApp.title}' updated successfully.`);
    if (updateRequest.permissions !== undefined) {
      console.log(
        `  Permissions: ${updateRequest.permissions.items.length} item(s) configured`,
      );
      for (const item of updateRequest.permissions.items) {
        console.log(`    - ${formatPermissionItem(item)}`);
      }
    }
    if (backendOnlyGatePermissions !== undefined && backendOnlyGatePermissions.length > 0) {
      console.log(
        `  Backend-only Gate permissions (manifest.backendOnlyGatePermissions): ${backendOnlyGatePermissions.join(", ")}`,
      );
    }
  }

  if (
    backendOnlyGatePermissions !== undefined &&
    (backendOnlyGatePermissions.length > 0 || backendOnlyDeclaredInFusebaseJson)
  ) {
    try {
      writeBackendOnlyGatePermissionsToFusebaseJson(
        cwd,
        options.appId,
        backendOnlyGatePermissions,
      );
      if (!options.quiet) {
        console.log(
          backendOnlyGatePermissions.length > 0
            ? "  fusebase.json: backendOnlyGatePermissions updated"
            : "  fusebase.json: backendOnlyGatePermissions cleared",
        );
      }
    } catch {
      // Non-fatal: remote manifest is still updated.
    }
  }

  return {
    app: updatedApp,
    gatePermissions,
    backendOnlyGatePermissions,
  };
}
