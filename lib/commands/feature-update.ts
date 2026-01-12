import { Command } from "commander";
import { resolve } from "node:path";
import { updateAppFeature, fetchAppFeatures } from "../api.ts";
import type { AppFeatureAccessPrincipal, AppFeaturePermissions } from "../api.ts";
import { getConfig, loadFuseConfig } from "../config.ts";
import { analyzeFeatureGatePermissions } from "../gate-sdk-analyze.ts";
import {
  formatPermissionItem,
  mergeFeaturePermissions,
  parsePermissions,
  parsePrincipals,
} from "../permissions.ts";

export const featureUpdateCommand = new Command("update")
  .description("Update a feature's settings")
  .argument("<featureId>", "Feature ID to update")
  .option("--access <principals>", "Set access principals, comma-separated (e.g., visitor or the org roles like orgRole:member, etc.)")
  .option("--permissions <permissions>", "Set feature permissions (format: dashboardView.dashboardId:viewId.read,write;database.id:databaseId.read)")
  .option("--sync-gate-permissions", "Analyze this feature path and sync generated Gate permissions")
  .action(async (featureId: string, options: { access?: string; permissions?: string; syncGatePermissions?: boolean }) => {
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

    const { orgId, appId } = fuseConfig;

    if (!orgId || !appId) {
      console.error("Error: fusebase.json is missing orgId or appId.");
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

    // Parse access principals if provided
    let accessPrincipals: AppFeatureAccessPrincipal[] | undefined;
    if (options.access !== undefined) {
      try {
        accessPrincipals = parsePrincipals(options.access);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    }

    // Parse permissions if provided
    let permissions: AppFeaturePermissions | undefined;
    if (options.permissions !== undefined) {
      try {
        permissions = parsePermissions(options.permissions);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    }

    try {
      // Fetch current feature to verify it exists and get its title
      const featuresResponse = await fetchAppFeatures(config.apiKey, orgId, appId);
      const feature = featuresResponse.features.find(f => f.id === featureId);

      if (!feature) {
        console.error(`Error: Feature with ID '${featureId}' not found.`);
        process.exit(1);
      }

      let gatePermissions: string[] | undefined;
      if (options.syncGatePermissions) {
        const featureConfig = fuseConfig.features?.find((item) => item.id === featureId);
        if (!featureConfig) {
          console.error(`Error: Feature with ID '${featureId}' is missing from local fusebase.json.`);
          process.exit(1);
        }
        if (!featureConfig.path) {
          console.error(`Error: Feature with ID '${featureId}' is missing "path" in fusebase.json.`);
          process.exit(1);
        }

        const gateAnalysis = await analyzeFeatureGatePermissions({
          projectRoot: resolve(process.cwd()),
          feature: featureConfig,
          apiKey: config.apiKey,
          throwOnResolveFailure: true,
        });
        gatePermissions = gateAnalysis.gatePermissions;
      }

      // Build update request
      const updateRequest: { accessPrincipals?: AppFeatureAccessPrincipal[]; permissions?: AppFeaturePermissions } = {};

      if (accessPrincipals !== undefined) {
        updateRequest.accessPrincipals = accessPrincipals;
      }

      if (permissions !== undefined || options.syncGatePermissions) {
        updateRequest.permissions = mergeFeaturePermissions({
          manualPermissions: permissions,
          existingPermissions: feature.permissions,
          gatePermissions,
        });
      }

      const updatedFeature = await updateAppFeature(
        config.apiKey,
        orgId,
        appId,
        featureId,
        updateRequest
      );

      console.log(`✓ Feature '${updatedFeature.title}' updated successfully.`);

      if (accessPrincipals !== undefined) {
        const summary = accessPrincipals.map(p => p.id ? `${p.type}:${p.id}` : p.type).join(', ') || 'none';
        console.log(`  Access principals: ${summary}`);
        if (updatedFeature.url) {
          console.log(`  URL: ${updatedFeature.url}`);
        }
      }

      if (updateRequest.permissions !== undefined) {
        console.log(`  Permissions: ${updateRequest.permissions.items.length} item(s) configured`);
        for (const item of updateRequest.permissions.items) {
          console.log(`    - ${formatPermissionItem(item)}`);
        }
      }
    } catch (error) {
      console.error(`Error: Failed to update feature. ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });
