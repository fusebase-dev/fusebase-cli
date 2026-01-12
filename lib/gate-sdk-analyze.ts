import { resolve } from "node:path";
import { resolveGateOperationPermissions } from "./api.ts";
import {
  updateGateSdkPermissionsInFusebaseJson,
  writeGateSdkOperationsToFusebaseJson,
  type FeatureConfig,
  type GateSdkOperationsSnapshot,
} from "./config.ts";
import {
  analyzeGateSdkOperations,
  type GateOperationsResult,
} from "./gate-sdk-used-operations.ts";

export interface FeatureGateAnalysisOutput {
  featureId: string;
  featurePath: string;
  result: GateOperationsResult;
  fusebaseSnapshot: GateSdkOperationsSnapshot;
  gatePermissions: string[];
}

function shouldResolveGatePermissions(
  snapshot: GateSdkOperationsSnapshot,
): boolean {
  return (
    snapshot.usedOpsChangedAt === snapshot.analyzedAt &&
    snapshot.usedOps.length > 0
  );
}

export async function analyzeFeatureGatePermissions(args: {
  projectRoot: string;
  feature: FeatureConfig;
  apiKey?: string;
  onWarning?: (message: string) => void;
  throwOnResolveFailure?: boolean;
}): Promise<FeatureGateAnalysisOutput> {
  const { projectRoot, feature, apiKey, onWarning, throwOnResolveFailure } = args;

  if (!feature.path) {
    throw new Error(`Feature "${feature.id}" is missing "path" in fusebase.json`);
  }

  const featurePath = feature.path;
  const result = await analyzeGateSdkOperations({
    projectRoot,
    scopeRoot: resolve(projectRoot, featurePath),
  });
  const analyzedAt = new Date().toISOString();
  let fusebaseSnapshot = writeGateSdkOperationsToFusebaseJson(
    projectRoot,
    feature.id,
    {
      analyzedAt,
      usedOps: result.usedOps,
      sdkVersion: result.sdkVersion,
    },
  );

  if (shouldResolveGatePermissions(fusebaseSnapshot)) {
    if (!apiKey) {
      const message =
        "No API key; skipped POST /v1/gate/resolve-operation-permissions. Run fusebase auth.";
      if (throwOnResolveFailure) {
        throw new Error(message);
      }
      onWarning?.(message);
    } else {
      try {
        const resolvedAt = new Date().toISOString();
        const res = await resolveGateOperationPermissions(
          apiKey,
          fusebaseSnapshot.usedOps,
        );

        if (res.success && res.data && Array.isArray(res.data.permissions)) {
          fusebaseSnapshot = updateGateSdkPermissionsInFusebaseJson(
            projectRoot,
            feature.id,
            res.data.permissions,
            resolvedAt,
          );
        } else {
          const message = `resolve-operation-permissions for feature ${feature.id}: success=false${res.message ? ` — ${res.message}` : ""}`;
          if (throwOnResolveFailure) {
            throw new Error(message);
          }
          onWarning?.(message);
        }
      } catch (error) {
        const message = `resolve-operation-permissions failed for feature ${feature.id}: ${error instanceof Error ? error.message : String(error)}`;
        if (throwOnResolveFailure) {
          throw new Error(message);
        }
        onWarning?.(message);
      }
    }
  }

  const gatePermissions =
    result.usedOps.length === 0
      ? []
      : (fusebaseSnapshot.permissions ?? []);

  return {
    featureId: feature.id,
    featurePath,
    result,
    fusebaseSnapshot,
    gatePermissions,
  };
}
