import { Command } from "commander";
import { resolve } from "node:path";
import {
  getConfig,
  loadFuseConfig,
  type FeatureConfig,
} from "../config.ts";
import { analyzeFeatureGatePermissions, type FeatureGateAnalysisOutput } from "../gate-sdk-analyze.ts";
import {
  printGateOperationsResult,
} from "../gate-sdk-used-operations.ts";

export const analyzeCommand = new Command("analyze").description(
  "Internal tooling.",
);

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

        const features = getAnalyzableFeatures(fuseConfig.features, opts.feature);
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
