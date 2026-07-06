import { Command } from "commander";
import { resolve } from "node:path";
import { syncAppApiDependencies } from "../api.ts";
import {
  getConfig,
  hasFlag,
  loadFuseConfig,
  requireAppId,
  writeAppApiDependenciesToFusebaseJson,
  type AppApiDependenciesSnapshot,
  type FeatureConfig,
} from "../config.ts";
import { analyzeFeatureGatePermissions, type FeatureGateAnalysisOutput } from "../gate-sdk-analyze.ts";
import {
  printGateOperationsResult,
} from "../gate-sdk-used-operations.ts";
import {
  analyzeAppApiDependencies,
  type AppApiDependenciesResult,
} from "../app-api-dependencies-used-operations.ts";

export const analyzeCommand = new Command("analyze").description(
  "Internal tooling.",
);

interface AppApiDependenciesSyncResult {
  attempted: boolean;
  synced: boolean;
  forced: boolean;
  skippedReason?: "unchanged";
}

function getAnalyzableFeatures(
  featureConfigs: FeatureConfig[] | undefined,
  requestedFeatureId?: string,
): FeatureConfig[] {
  const features = featureConfigs ?? [];
  if (requestedFeatureId) {
    const feature = features.find((item) => item.id === requestedFeatureId);
    if (!feature) {
      throw new Error(`Feature "${requestedFeatureId}" not found in fusebase.json`);
    }
    if (!feature.path) {
      throw new Error(`Feature "${requestedFeatureId}" is missing "path" in fusebase.json`);
    }
    return [feature];
  }

  const analyzable = features.filter((feature) => feature.path);
  if (analyzable.length === 0) {
    throw new Error(
      "No features with path configured in fusebase.json. Run fusebase feature create first.",
    );
  }
  return analyzable;
}

function printFeatureScopedResult(
  analysis: FeatureGateAnalysisOutput,
  json: boolean,
): void {
  if (json) return;

  console.log(`Feature ${analysis.featureId}`);
  console.log(`Path: ${analysis.featurePath}`);
  console.log("");
  printGateOperationsResult(analysis.result, false, {
    fusebaseSaved: true,
    fusebaseSnapshot: analysis.fusebaseSnapshot,
  });
  console.log("");
  console.log(`✓ fusebaseGateMeta saved to feature ${analysis.featureId} in fusebase.json`);
}

function printFeatureScopedAppApiResult(
  featureId: string,
  featurePath: string,
  fusebaseSnapshot: AppApiDependenciesSnapshot,
  syncResult?: AppApiDependenciesSyncResult,
): void {
  console.log(`Feature ${featureId}`);
  console.log(`Path: ${featurePath}`);
  console.log("");
  console.log(`dependencies (${fusebaseSnapshot.dependencies.length}):`);
  if (fusebaseSnapshot.dependencies.length === 0) {
    console.log("  (none)");
  } else {
    for (const dependency of fusebaseSnapshot.dependencies) {
      console.log(
        `  ${dependency.targetOrgId}/${dependency.targetAppId}#${dependency.operationId}`,
      );
    }
  }

  console.log("");
  console.log(`unresolved (${fusebaseSnapshot.unresolved.length}):`);
  if (fusebaseSnapshot.unresolved.length === 0) {
    console.log("  (none)");
  } else {
    for (const unresolved of fusebaseSnapshot.unresolved) {
      console.log(
        `  ${unresolved.file}:${unresolved.line}:${unresolved.column} ${unresolved.reason}`,
      );
    }
    console.log("");
    console.log(
      "Warning: unresolved callAppApi calls were detected and were not converted to dependencies.",
    );
    console.log(
      `Review them with: fusebase app-api-contracts unresolved --app ${featureId}`,
    );
  }

  console.log("");
  console.log(`analyzedAt: ${fusebaseSnapshot.analyzedAt}`);
  console.log(`dependenciesChangedAt: ${fusebaseSnapshot.dependenciesChangedAt}`);
  console.log(`unresolvedChangedAt: ${fusebaseSnapshot.unresolvedChangedAt}`);
  console.log("");
  console.log(
    `✓ fusebaseAppApiDependenciesMeta saved to feature ${featureId} in fusebase.json`,
  );

  if (!syncResult) {
    return;
  }

  if (syncResult.synced) {
    console.log(
      `✓ Synced app API dependencies to remote (${fusebaseSnapshot.dependencies.length} item(s))`,
    );
    return;
  }

  if (syncResult.skippedReason === "unchanged") {
    console.log(
      "Skipped remote sync: dependency set is unchanged (use --force to sync anyway).",
    );
  }
}

function shouldSyncAppApiDependencies(
  snapshot: AppApiDependenciesSnapshot,
  force: boolean,
): boolean {
  if (force) {
    return true;
  }
  return snapshot.dependenciesChangedAt === snapshot.analyzedAt;
}

analyzeCommand
  .command("gate")
  .description("Internal: Gate SDK.")
  .option(
    "--operations",
    "Scan @fusebase/fusebase-gate-sdk opIds and TS usage of *Api classes",
    true,
  )
  .option(
    "--json",
    "JSON: sdkOperationIds, usedOps, sdkVersion, tsconfig, sdkRoot, fusebase fields",
  )
  .option(
    "--feature <featureId>",
    "Analyze only one feature from fusebase.json; otherwise analyze all configured features",
  )
  .action(
    async (opts: { operations?: boolean; json?: boolean; feature?: string }) => {
      if (opts.operations === false) {
        console.error(
          "Error: No analysis mode selected. Use --operations (default: on).",
        );
        process.exit(1);
      }

      const projectRoot = resolve(process.cwd());

      try {
        const fuseConfig = loadFuseConfig();
        if (!fuseConfig) {
          throw new Error("fusebase.json not found. Run fusebase init first.");
        }

        const features = getAnalyzableFeatures(fuseConfig.apps, opts.feature);
        const analyses: FeatureGateAnalysisOutput[] = [];
        const apiKey = getConfig().apiKey;

        for (const feature of features) {
          const analysis = await analyzeFeatureGatePermissions({
            projectRoot,
            feature,
            apiKey,
            onWarning: (message) => {
              if (!opts.json) {
                console.error(`Warning: ${message}`);
              }
            },
          });

          analyses.push(analysis);
        }

        if (opts.json) {
          if (analyses.length === 1) {
            const analysis = analyses[0]!;
            console.log(
              JSON.stringify(
                {
                  featureId: analysis.featureId,
                  featurePath: analysis.featurePath,
                  sdkOperationIds: analysis.result.sdkOperationIds,
                  usedOps: analysis.result.usedOps,
                  sdkVersion: analysis.result.sdkVersion,
                  tsconfig: analysis.result.tsconfig,
                  sdkRoot: analysis.result.sdkRoot,
                  analyzedAt: analysis.fusebaseSnapshot.analyzedAt,
                  usedOpsChangedAt: analysis.fusebaseSnapshot.usedOpsChangedAt,
                  ...(analysis.fusebaseSnapshot.permissionsChangedAt !== undefined && {
                    permissionsChangedAt: analysis.fusebaseSnapshot.permissionsChangedAt,
                  }),
                  ...(analysis.fusebaseSnapshot.permissions && {
                    permissions: analysis.fusebaseSnapshot.permissions,
                  }),
                  fusebaseSaved: true,
                },
                null,
                2,
              ),
            );
          } else {
            console.log(
              JSON.stringify(
                {
                  features: analyses.map((analysis) => ({
                    featureId: analysis.featureId,
                    featurePath: analysis.featurePath,
                    sdkOperationIds: analysis.result.sdkOperationIds,
                    usedOps: analysis.result.usedOps,
                    sdkVersion: analysis.result.sdkVersion,
                    tsconfig: analysis.result.tsconfig,
                    sdkRoot: analysis.result.sdkRoot,
                    analyzedAt: analysis.fusebaseSnapshot.analyzedAt,
                    usedOpsChangedAt: analysis.fusebaseSnapshot.usedOpsChangedAt,
                    ...(analysis.fusebaseSnapshot.permissionsChangedAt !== undefined && {
                      permissionsChangedAt: analysis.fusebaseSnapshot.permissionsChangedAt,
                    }),
                    ...(analysis.fusebaseSnapshot.permissions && {
                      permissions: analysis.fusebaseSnapshot.permissions,
                    }),
                    fusebaseSaved: true,
                  })),
                },
                null,
                2,
              ),
            );
          }
          return;
        }

        for (const [index, analysis] of analyses.entries()) {
          if (index > 0) {
            console.log("");
          }
          printFeatureScopedResult(analysis, false);
        }
      } catch (e) {
        console.error(
          `Error: ${e instanceof Error ? e.message : String(e)}`,
        );
        process.exit(1);
      }
    },
  );

analyzeCommand
  .command("app-apis")
  .description("Internal: App-to-app API dependency analysis.")
  .option(
    "--json",
    "JSON: dependencies, unresolved, sdkVersion, tsconfig, sdkRoot",
  )
  .option(
    "--feature <featureId>",
    "Analyze only one feature from fusebase.json; otherwise analyze all configured features",
  )
  .option(
    "--sync",
    "Sync analyzed app API dependencies to the remote app metadata endpoint",
  )
  .option(
    "--force",
    "With --sync, force remote sync even when dependencies are unchanged",
  )
  .action(async (opts: { json?: boolean; feature?: string; sync?: boolean; force?: boolean }) => {
    const projectRoot = resolve(process.cwd());

    try {
      if (!hasFlag("cross-app-api-calls-analysis")) {
        throw new Error(
          "analyze app-apis is disabled. Enable it with: fusebase config set-flag cross-app-api-calls-analysis",
        );
      }

      if (opts.force && !opts.sync) {
        throw new Error("--force requires --sync");
      }

      const fuseConfig = loadFuseConfig();
      if (!fuseConfig) {
        throw new Error("fusebase.json not found. Run fusebase init first.");
      }

      const config = getConfig();
      const features = getAnalyzableFeatures(fuseConfig.apps, opts.feature);
      const syncRequested = opts.sync === true;
      const forceSync = opts.force === true;
      const apiKey = config.apiKey;

      if (syncRequested && !apiKey) {
        throw new Error(
          "Not authenticated. Run 'fusebase auth' or 'fusebase auth --api-key=<apiKey>' first.",
        );
      }

      if (
        syncRequested &&
        (typeof fuseConfig.orgId !== "string" || typeof fuseConfig.productId !== "string")
      ) {
        throw new Error("fusebase.json is missing orgId or productId.");
      }

      const analyses: Array<{
        featureId: string;
        featurePath: string;
        result: AppApiDependenciesResult;
        fusebaseSnapshot: AppApiDependenciesSnapshot;
        syncResult?: AppApiDependenciesSyncResult;
      }> = [];

      for (const feature of features) {
        if (!feature.path) {
          throw new Error(
            `Feature "${feature.id}" is missing "path" in fusebase.json`,
          );
        }

        const featureId = requireAppId(feature);
        const featurePath = feature.path;
        const result = await analyzeAppApiDependencies({
          projectRoot,
          scopeRoot: resolve(projectRoot, featurePath),
        });
        const analyzedAt = new Date().toISOString();
        const fusebaseSnapshot = writeAppApiDependenciesToFusebaseJson(
          projectRoot,
          featureId,
          {
            analyzedAt,
            sdkVersion: result.sdkVersion,
            dependencies: result.dependencies,
            unresolved: result.unresolved,
          },
        );
        let syncResult: AppApiDependenciesSyncResult | undefined;
        if (syncRequested) {
          const shouldSync = shouldSyncAppApiDependencies(
            fusebaseSnapshot,
            forceSync,
          );
          if (!shouldSync) {
            syncResult = {
              attempted: false,
              synced: false,
              forced: forceSync,
              skippedReason: "unchanged",
            };
          } else {
            await syncAppApiDependencies(
              apiKey!,
              fuseConfig.orgId,
              fuseConfig.productId,
              featureId,
              fusebaseSnapshot.dependencies,
            );
            syncResult = {
              attempted: true,
              synced: true,
              forced: forceSync,
            };
          }
        }

        analyses.push({
          featureId,
          featurePath,
          result,
          fusebaseSnapshot,
          syncResult,
        });
      }

      if (opts.json) {
        if (analyses.length === 1) {
          const analysis = analyses[0]!;
          console.log(
            JSON.stringify(
              {
                featureId: analysis.featureId,
                featurePath: analysis.featurePath,
                dependencies: analysis.fusebaseSnapshot.dependencies,
                unresolved: analysis.fusebaseSnapshot.unresolved,
                sdkVersion: analysis.result.sdkVersion,
                tsconfig: analysis.result.tsconfig,
                sdkRoot: analysis.result.sdkRoot,
                analyzedAt: analysis.fusebaseSnapshot.analyzedAt,
                dependenciesChangedAt:
                  analysis.fusebaseSnapshot.dependenciesChangedAt,
                unresolvedChangedAt: analysis.fusebaseSnapshot.unresolvedChangedAt,
                fusebaseSaved: true,
                ...(syncRequested && {
                  syncRequested: true,
                  syncAttempted: analysis.syncResult?.attempted ?? false,
                  syncForced: analysis.syncResult?.forced ?? false,
                  syncStatus: analysis.syncResult?.synced
                    ? "synced"
                    : analysis.syncResult?.skippedReason === "unchanged"
                      ? "skipped-unchanged"
                      : "not-synced",
                }),
              },
              null,
              2,
            ),
          );
          return;
        }

        console.log(
          JSON.stringify(
            {
              features: analyses.map((analysis) => ({
                featureId: analysis.featureId,
                featurePath: analysis.featurePath,
                dependencies: analysis.fusebaseSnapshot.dependencies,
                unresolved: analysis.fusebaseSnapshot.unresolved,
                sdkVersion: analysis.result.sdkVersion,
                tsconfig: analysis.result.tsconfig,
                sdkRoot: analysis.result.sdkRoot,
                analyzedAt: analysis.fusebaseSnapshot.analyzedAt,
                dependenciesChangedAt:
                  analysis.fusebaseSnapshot.dependenciesChangedAt,
                unresolvedChangedAt: analysis.fusebaseSnapshot.unresolvedChangedAt,
                fusebaseSaved: true,
                ...(syncRequested && {
                  syncRequested: true,
                  syncAttempted: analysis.syncResult?.attempted ?? false,
                  syncForced: analysis.syncResult?.forced ?? false,
                  syncStatus: analysis.syncResult?.synced
                    ? "synced"
                    : analysis.syncResult?.skippedReason === "unchanged"
                      ? "skipped-unchanged"
                      : "not-synced",
                }),
              })),
            },
            null,
            2,
          ),
        );
        return;
      }

      for (const [index, analysis] of analyses.entries()) {
        if (index > 0) {
          console.log("");
        }
        printFeatureScopedAppApiResult(
          analysis.featureId,
          analysis.featurePath,
          analysis.fusebaseSnapshot,
          analysis.syncResult,
        );
      }
    } catch (e) {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  });
