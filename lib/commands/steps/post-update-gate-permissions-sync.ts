import { confirm } from "@inquirer/prompts";
import { resolve } from "node:path";
import { fetchApps } from "../../api.ts";
import type { FuseConfig } from "../../config.ts";
import { analyzeFeatureGatePermissions } from "../../gate-sdk-analyze.ts";
import {
  collectGatePermissionsDriftForProduct,
  formatGatePermissionsDriftLines,
} from "../../gate-permissions-drift.ts";
import { syncAppGatePermissions } from "../../sync-app-gate-permissions.ts";

export interface PostUpdateGatePermissionsSyncOptions {
  cwd: string;
  fuseConfig: FuseConfig;
  apiKey?: string;
  gateSdkDependencyUpdated: boolean;
  npmInstallCompleted: boolean;
  dryRun: boolean;
  skip: boolean;
  isTty: boolean;
}

export interface PostUpdateGatePermissionsSyncResult {
  checked: boolean;
  driftCount: number;
  syncedCount: number;
  checkedAppIds: number;
  missingRemoteAppIds: number;
  localMetaOnlyDriftCount: number;
}

export async function maybePromptGatePermissionsSyncAfterSdkUpdate(
  options: PostUpdateGatePermissionsSyncOptions,
): Promise<PostUpdateGatePermissionsSyncResult> {
  const result: PostUpdateGatePermissionsSyncResult = {
    checked: false,
    driftCount: 0,
    syncedCount: 0,
    checkedAppIds: 0,
    missingRemoteAppIds: 0,
    localMetaOnlyDriftCount: 0,
  };

  if (
    options.skip ||
    options.dryRun ||
    !options.gateSdkDependencyUpdated ||
    !options.npmInstallCompleted
  ) {
    return result;
  }

  const features = options.fuseConfig.apps ?? [];
  if (features.length === 0) {
    return result;
  }

  if (!options.apiKey) {
    console.log("");
    console.log(
      "⚠ @fusebase/fusebase-gate-sdk was updated. Authenticate (`fusebase auth`) and run `fusebase app update <appId> --sync-gate-permissions` if Gate calls return 403.",
    );
    return result;
  }

  const { orgId, productId } = options.fuseConfig;
  if (!orgId || !productId) {
    return result;
  }

  console.log("");
  console.log("Checking Gate permission drift after SDK update...");

  let remoteApps;
  try {
    const response = await fetchApps(options.apiKey, orgId, productId);
    remoteApps = response.apps;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠ Could not fetch apps for Gate drift check: ${message}`);
    return result;
  }

  const collection = await collectGatePermissionsDriftForProduct({
    projectRoot: resolve(options.cwd),
    features,
    remoteApps,
    apiKey: options.apiKey,
  });
  const { drifts, checkedAppIds, missingRemoteAppIds } = collection;
  result.checked = true;
  result.driftCount = drifts.length;
  result.checkedAppIds = checkedAppIds.length;
  result.missingRemoteAppIds = missingRemoteAppIds.length;
  result.localMetaOnlyDriftCount = drifts.filter(
    (drift) => drift.sources.includes("local-meta") && !drift.sources.includes("platform"),
  ).length;

  if (drifts.length === 0) {
    if (checkedAppIds.length === 0) {
      console.log(
        "⚠ Gate permission drift was not checked (no apps with Gate SDK in this product).",
      );
    } else if (missingRemoteAppIds.length > 0) {
      console.log(
        "✓ fusebaseGateMeta matches SDK analysis, but platform apps were not found " +
          `for id(s): ${missingRemoteAppIds.join(", ")} (see \`fusebase app list\`).`,
      );
    } else {
      console.log("✓ No Gate permission drift detected for deployed apps.");
    }
    return result;
  }

  console.log("");
  console.log(
    `Gate SDK update detected permission drift in ${drifts.length} app(s):`,
  );
  for (const drift of drifts) {
    for (const line of formatGatePermissionsDriftLines(drift)) {
      console.log(line);
    }
  }

  const syncableDrifts = drifts.filter((drift) => drift.sources.includes("platform"));
  const localOnlyDrifts = drifts.filter(
    (drift) => drift.sources.includes("local-meta") && !drift.sources.includes("platform"),
  );

  if (syncableDrifts.length === 0 && localOnlyDrifts.length > 0) {
    if (!options.isTty) {
      console.log("");
      console.log(
        "Run `fusebase analyze gate --operations --feature <id>` to refresh fusebaseGateMeta.",
      );
      return result;
    }

    const shouldRefreshMeta = await confirm({
      message: `Refresh fusebaseGateMeta in fusebase.json for ${localOnlyDrifts.length} app(s)?`,
      default: true,
    });
    if (!shouldRefreshMeta) {
      console.log(
        "Skipped. Run `fusebase analyze gate --operations --feature <id>` when ready.",
      );
      return result;
    }

    console.log("");
    for (const drift of localOnlyDrifts) {
      const feature = features.find((item) => item.id === drift.appId);
      if (!feature) continue;
      try {
        await analyzeFeatureGatePermissions({
          projectRoot: resolve(options.cwd),
          feature,
          apiKey: options.apiKey,
          persistFusebaseJson: true,
          alwaysResolvePermissions: true,
          throwOnResolveFailure: true,
        });
        console.log(`✓ Refreshed fusebaseGateMeta for ${drift.appId} in fusebase.json`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠ Could not refresh fusebaseGateMeta for ${drift.appId}: ${message}`);
      }
    }
    return result;
  }

  if (!options.isTty) {
    console.log("");
    console.log(
      "Run `fusebase app update <appId> --sync-gate-permissions` for each app above.",
    );
    return result;
  }

  const shouldSync = await confirm({
    message: `Sync Gate permissions for ${syncableDrifts.length} app(s) now?`,
    default: true,
  });
  if (!shouldSync) {
    console.log(
      "Skipped. Run `fusebase app update <appId> --sync-gate-permissions` when ready.",
    );
    return result;
  }

  console.log("");
  for (const drift of syncableDrifts) {
    try {
      await syncAppGatePermissions({
        cwd: options.cwd,
        apiKey: options.apiKey,
        orgId,
        productId,
        appId: drift.appId,
        quiet: false,
      });
      result.syncedCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✗ Failed to sync Gate permissions for ${drift.appId}: ${message}`);
    }
  }

  for (const drift of localOnlyDrifts) {
    const feature = features.find((item) => item.id === drift.appId);
    if (!feature) continue;
    try {
      await analyzeFeatureGatePermissions({
        projectRoot: resolve(options.cwd),
        feature,
        apiKey: options.apiKey,
        persistFusebaseJson: true,
        alwaysResolvePermissions: true,
        throwOnResolveFailure: true,
      });
      console.log(`✓ Refreshed fusebaseGateMeta for ${drift.appId} in fusebase.json`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠ Could not refresh fusebaseGateMeta for ${drift.appId}: ${message}`);
    }
  }

  if (result.syncedCount > 0) {
    console.log("");
    console.log(
      `✓ Synced Gate permissions for ${result.syncedCount}/${syncableDrifts.length} app(s).`,
    );
  }

  return result;
}
