import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { App, AppPermissions } from "./api.ts";
import type { FeatureConfig } from "./config.ts";
import { analyzeFeatureGatePermissions } from "./gate-sdk-analyze.ts";
import {
  mergeSyncedGatePermissions,
  readGatePrivilegesFromPermissions,
  splitGatePermissionStrings,
  unionStoredPermissions,
} from "./permissions.ts";

export const GATE_SDK_PACKAGE = "@fusebase/fusebase-gate-sdk";

export type GatePermissionsDriftSource = "platform" | "local-meta";

export interface StringSetDiff {
  added: string[];
  removed: string[];
}

export interface GatePermissionsDrift {
  appId: string;
  featureTitle?: string;
  path: string;
  sources: GatePermissionsDriftSource[];
  remoteAppMissing: boolean;
  publishedPermissions: string[];
  /** Baseline for the local-meta comparison only: `fusebaseGateMeta` ∪ resolver. */
  expectedPermissions: string[];
  /** Platform permission delta (published → what a sync would publish). */
  platformAddedPermissions: string[];
  platformRemovedPermissions: string[];
  localMetaPermissions: string[];
  /** Local fusebaseGateMeta.permissions delta (meta → expected). */
  localMetaAddedPermissions: string[];
  localMetaRemovedPermissions: string[];
  metaUsedOps: string[];
  expectedUsedOps: string[];
  previousSdkVersion: string | null;
  currentSdkVersion: string | null;
}

export function diffSortedStringSets(
  before: string[],
  after: string[],
): StringSetDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((value) => !beforeSet.has(value)),
    removed: before.filter((value) => !afterSet.has(value)),
  };
}

export function sortedUniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).sort((a, b) => a.localeCompare(b));
}

/**
 * The published set is read through the same reader the merge uses. Picking the first gate item
 * instead read a *scoped* one once `mergeFeaturePermissions` started emitting those first, so the
 * two operands counted different items and the drift never cleared (NIM-42739).
 */
export function extractPublishedGateRuntimePermissions(app: App): string[] {
  return readGatePrivilegesFromPermissions(app.permissions);
}

/**
 * Compare the app record against what `--sync-gate-permissions` would actually publish — not
 * against the analyzed set. A hand-granted privilege lives on the app record and never in
 * `fusebaseGateMeta`, so under merge semantics the sync keeps it; comparing against the analyzed
 * set reports a removal that never happens and the default-yes sync prompt returns forever
 * (NIM-42739).
 */
export function comparePlatformGatePermissions(args: {
  analyzedGatePermissions: string[];
  remoteApp?: App;
  localPermissions?: AppPermissions;
}): { drift: boolean; published: string[]; syncWouldPublish: string[]; diff: StringSetDiff } {
  const { analyzedGatePermissions, remoteApp, localPermissions } = args;
  const published = remoteApp ? extractPublishedGateRuntimePermissions(remoteApp) : [];
  const syncWouldPublish = sortedUniqueStrings(
    splitGatePermissionStrings(
      mergeSyncedGatePermissions({
        analyzedGatePermissions,
        storedPermissions: unionStoredPermissions(remoteApp?.permissions, localPermissions),
      }).gatePermissions,
    ).runtimePermissions,
  );

  return {
    drift: remoteApp !== undefined && !gatePermissionSetsEqual(published, syncWouldPublish),
    published,
    syncWouldPublish,
    diff: diffSortedStringSets(published, syncWouldPublish),
  };
}

export function gatePermissionSetsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function formatGatePermissionsDriftLines(drift: GatePermissionsDrift): string[] {
  const title = drift.featureTitle?.trim() || drift.appId;
  const lines: string[] = [`  ${title} (${drift.path}) — ${drift.appId}`];

  if (drift.remoteAppMissing) {
    lines.push("    platform: app not found (fusebase app list is empty for this id)");
  }

  if (drift.sources.includes("platform")) {
    if (drift.platformAddedPermissions.length > 0) {
      lines.push(`    platform + ${drift.platformAddedPermissions.join(", ")}`);
    }
    if (drift.platformRemovedPermissions.length > 0) {
      lines.push(`    platform - ${drift.platformRemovedPermissions.join(", ")}`);
    }
  }

  if (drift.sources.includes("local-meta")) {
    if (drift.localMetaAddedPermissions.length > 0) {
      lines.push(`    fusebaseGateMeta + ${drift.localMetaAddedPermissions.join(", ")}`);
    }
    if (drift.localMetaRemovedPermissions.length > 0) {
      lines.push(`    fusebaseGateMeta - ${drift.localMetaRemovedPermissions.join(", ")}`);
    }
  }

  if (drift.previousSdkVersion !== drift.currentSdkVersion) {
    lines.push(
      `    sdk: ${drift.previousSdkVersion ?? "?"} → ${drift.currentSdkVersion ?? "?"}`,
    );
  }

  const usedOpsDiff = diffSortedStringSets(drift.metaUsedOps, drift.expectedUsedOps);
  if (
    usedOpsDiff.added.length > 0 ||
    usedOpsDiff.removed.length > 0 ||
    drift.metaUsedOps.length !== drift.expectedUsedOps.length
  ) {
    lines.push(
      `    usedOps (meta → analyze): ${drift.metaUsedOps.length} → ${drift.expectedUsedOps.length}`,
    );
    if (usedOpsDiff.added.length > 0) {
      lines.push(`      + ${usedOpsDiff.added.join(", ")}`);
    }
    if (usedOpsDiff.removed.length > 0) {
      lines.push(`      - ${usedOpsDiff.removed.join(", ")}`);
    }
  }

  return lines;
}

export async function featureUsesGateSdk(args: {
  projectRoot: string;
  feature: FeatureConfig;
}): Promise<boolean> {
  const { projectRoot, feature } = args;
  if ((feature.fusebaseGateMeta?.usedOps?.length ?? 0) > 0) {
    return true;
  }
  if (!feature.path) return false;

  const pkgPath = join(projectRoot, feature.path, "package.json");
  try {
    const raw = await readFile(pkgPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      parsed.dependencies?.[GATE_SDK_PACKAGE] !== undefined ||
      parsed.devDependencies?.[GATE_SDK_PACKAGE] !== undefined
    );
  } catch {
    return false;
  }
}

export async function detectFeatureGatePermissionsDrift(args: {
  projectRoot: string;
  feature: FeatureConfig;
  remoteApp?: App;
  apiKey: string;
}): Promise<GatePermissionsDrift | null> {
  const { projectRoot, feature, remoteApp, apiKey } = args;
  if (!feature.id || !feature.path) {
    return null;
  }

  const usesGate = await featureUsesGateSdk({ projectRoot, feature });
  if (!usesGate) {
    return null;
  }

  const analysis = await analyzeFeatureGatePermissions({
    projectRoot,
    feature,
    apiKey,
    persistFusebaseJson: false,
    alwaysResolvePermissions: true,
    throwOnResolveFailure: true,
  });

  const expectedPermissions = sortedUniqueStrings(
    splitGatePermissionStrings(analysis.gatePermissions).runtimePermissions,
  );
  const expectedUsedOps = sortedUniqueStrings(analysis.result.usedOps);
  const localMetaPermissions = sortedUniqueStrings(
    feature.fusebaseGateMeta?.permissions ?? [],
  );
  const metaUsedOps = sortedUniqueStrings(feature.fusebaseGateMeta?.usedOps ?? []);

  // Platform and local-meta need different baselines: the sync merges, the fusebaseGateMeta
  // refresh still replaces. Using the merged baseline for local-meta too would copy
  // remote-only grants into the snapshot on the `Refresh fusebaseGateMeta` prompt.
  const platform = comparePlatformGatePermissions({
    analyzedGatePermissions: analysis.gatePermissions,
    remoteApp,
    localPermissions: feature.permissions,
  });
  const publishedPermissions = platform.published;

  const platformDrift = platform.drift;
  const localMetaPermissionsDrift = !gatePermissionSetsEqual(
    localMetaPermissions,
    expectedPermissions,
  );
  const localMetaUsedOpsDrift = !gatePermissionSetsEqual(metaUsedOps, expectedUsedOps);
  const localMetaDrift = localMetaPermissionsDrift || localMetaUsedOpsDrift;

  if (!platformDrift && !localMetaDrift) {
    return null;
  }

  const platformPermissionDiff = platform.diff;
  const localMetaPermissionDiff = diffSortedStringSets(
    localMetaPermissions,
    expectedPermissions,
  );

  const sources: GatePermissionsDriftSource[] = [];
  if (platformDrift) sources.push("platform");
  if (localMetaDrift) sources.push("local-meta");

  return {
    appId: feature.id,
    featureTitle: feature.name,
    path: feature.path,
    sources,
    remoteAppMissing: remoteApp === undefined,
    publishedPermissions,
    expectedPermissions,
    platformAddedPermissions: platformPermissionDiff.added,
    platformRemovedPermissions: platformPermissionDiff.removed,
    localMetaPermissions,
    localMetaAddedPermissions: localMetaPermissionDiff.added,
    localMetaRemovedPermissions: localMetaPermissionDiff.removed,
    metaUsedOps,
    expectedUsedOps,
    previousSdkVersion: feature.fusebaseGateMeta?.sdkVersion ?? null,
    currentSdkVersion: analysis.result.sdkVersion,
  };
}

export async function collectGatePermissionsDriftForProduct(args: {
  projectRoot: string;
  features: FeatureConfig[];
  remoteApps: App[];
  apiKey: string;
}): Promise<{
  drifts: GatePermissionsDrift[];
  checkedAppIds: string[];
  missingRemoteAppIds: string[];
  skippedNoGateSdkAppIds: string[];
}> {
  const { projectRoot, features, remoteApps, apiKey } = args;
  const remoteById = new Map(remoteApps.map((app) => [app.id, app]));
  const drifts: GatePermissionsDrift[] = [];
  const checkedAppIds: string[] = [];
  const missingRemoteAppIds: string[] = [];
  const skippedNoGateSdkAppIds: string[] = [];

  for (const feature of features) {
    if (!feature.id) continue;

    const remoteApp = remoteById.get(feature.id);
    if (!remoteApp) {
      missingRemoteAppIds.push(feature.id);
    }

    const usesGate = await featureUsesGateSdk({ projectRoot: resolve(projectRoot), feature });
    if (!usesGate) {
      skippedNoGateSdkAppIds.push(feature.id);
      continue;
    }

    try {
      const drift = await detectFeatureGatePermissionsDrift({
        projectRoot: resolve(projectRoot),
        feature,
        remoteApp,
        apiKey,
      });
      checkedAppIds.push(feature.id);
      if (drift) {
        drifts.push(drift);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `⚠ Skipped Gate drift check for app ${feature.id}: ${message}`,
      );
    }
  }

  return {
    drifts,
    checkedAppIds,
    missingRemoteAppIds,
    skippedNoGateSdkAppIds,
  };
}
