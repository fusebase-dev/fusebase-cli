import { resolve } from "node:path";
import { resolveGateOperationPermissions } from "./api.ts";
import {
  applyResolvedPermissionsToGateSnapshot,
  buildGateSdkOperationsSnapshot,
  requireAppId,
  updateGateSdkPermissionsInFusebaseJson,
  writeGateSdkOperationsToFusebaseJson,
  type FeatureConfig,
  type GateSdkOperationsSnapshot,
} from "./config.ts";
import { findGatePermissionDiagnostics } from "./gate-sdk-permission-diagnostics.ts";
import {
  analyzeGateSdkOperations,
  type GateOperationsResult,
} from "./gate-sdk-used-operations.ts";
import { withTrustedRuntimeContextDelegatePermission } from "./permissions.ts";

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
  /** When false, compute snapshot in memory without writing fusebase.json. Default true. */
  persistFusebaseJson?: boolean;
  /**
   * Drift/sync checks: always resolve permissions from current usedOps instead of
   * reusing fusebaseGateMeta.permissions when usedOps are unchanged.
   */
  alwaysResolvePermissions?: boolean;
}): Promise<FeatureGateAnalysisOutput> {
  const {
    projectRoot,
    feature,
    apiKey,
    onWarning,
    throwOnResolveFailure,
    persistFusebaseJson = true,
    alwaysResolvePermissions = false,
  } = args;

  if (!feature.path) {
    throw new Error(`Feature "${feature.id}" is missing "path" in fusebase.json`);
  }

  const featureId = requireAppId(feature);
  const featurePath = feature.path;
  const result = await analyzeGateSdkOperations({
    projectRoot,
    scopeRoot: resolve(projectRoot, featurePath),
  });
  const analyzedAt = new Date().toISOString();
  const writeInput = {
    analyzedAt,
    usedOps: result.usedOps,
    sdkVersion: result.sdkVersion,
  };
  const snapshotBuildOptions = alwaysResolvePermissions
    ? { preservePermissionsWhenUsedOpsUnchanged: false as const }
    : undefined;
  let fusebaseSnapshot = persistFusebaseJson
    ? writeGateSdkOperationsToFusebaseJson(
        projectRoot,
        featureId,
        writeInput,
        snapshotBuildOptions,
      )
    : buildGateSdkOperationsSnapshot(
        feature.fusebaseGateMeta,
        writeInput,
        snapshotBuildOptions,
      );

  const needsPermissionResolve = alwaysResolvePermissions
    ? fusebaseSnapshot.usedOps.length > 0
    : shouldResolveGatePermissions(fusebaseSnapshot);

  if (needsPermissionResolve) {
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
          fusebaseSnapshot = persistFusebaseJson
            ? updateGateSdkPermissionsInFusebaseJson(
                projectRoot,
                featureId,
                res.data.permissions,
                resolvedAt,
              )
            : applyResolvedPermissionsToGateSnapshot(
                fusebaseSnapshot,
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

  const gatePermissions = withTrustedRuntimeContextDelegatePermission(
    result.usedOps.length === 0 ? [] : (fusebaseSnapshot.permissions ?? []),
    result.usesTrustedRuntimeContext,
  );
  for (const diagnostic of findGatePermissionDiagnostics({
    usedOps: result.usedOps,
    permissions: gatePermissions,
    usesTrustedRuntimeContext: result.usesTrustedRuntimeContext,
  })) {
    onWarning?.(diagnostic);
  }

  return {
    featureId,
    featurePath,
    result,
    fusebaseSnapshot,
    gatePermissions,
  };
}
