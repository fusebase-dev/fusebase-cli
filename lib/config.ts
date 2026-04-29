import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";

export const CONFIG_DIR = join(homedir(), ".fusebase");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  apiKey?: string;
  env?: string;
  updateChannel?: "prod" | "dev";
  flags?: string[];
  gitlabHost?: string;
  gitlabToken?: string;
  gitlabGroup?: string;
}

export interface DevConfig {
  command: string;
}

export interface BuildConfig {
  command?: string;
  outputDir?: string;
}

export interface BackendStartConfig {
  command: string;
}

export interface BackendJobConfig {
  name: string;
  type: "cron";
  cron: string;
  command: string;
  sidecars?: SidecarConfig[];
}

export interface SidecarConfig {
  name: string;
  image: string;
  port?: number;
  env?: Record<string, string>;
  tier?: "small" | "medium" | "large";
}

export interface BackendConfig {
  dev?: DevConfig;
  build?: BuildConfig;
  start?: BackendStartConfig;
  jobs?: BackendJobConfig[];
  sidecars?: SidecarConfig[];
}

export interface FeatureConfig {
  id: string;
  path?: string;
  dev?: DevConfig;
  build?: BuildConfig;
  backend?: BackendConfig;
  /** Gate SDK analyze snapshot scoped to this feature path. */
  fusebaseGateMeta?: GateSdkOperationsSnapshot;
}

/** Written by `fusebase analyze gate` — last Gate SDK operation scan. */
export interface GateSdkOperationsSnapshot {
  sdkVersion: string | null;
  /** Last run of `fusebase analyze gate`. */
  analyzedAt: string;
  /** Last time the sorted `usedOps` list differed from the previous snapshot. */
  usedOpsChangedAt: string;
  /**
   * Last time the sorted `permissions` list differed from the previous resolve (e.g. new op added same permission set → unchanged).
   * Present when `permissions` has been written at least once.
   */
  permissionsChangedAt?: string;
  /** Operation ids in use (sorted). */
  usedOps: string[];
  /**
   * Gate permission strings required for the current `usedOps` (from `POST /v1/gate/resolve-operation-permissions`), sorted.
   */
  permissions?: string[];
}

// Read fusebase.json env config (takes precedence over process.env)
export interface FuseConfig {
  env?: string;
  orgId: string;
  appId: string;
  features?: FeatureConfig[];
  /** Legacy project-level Gate SDK analyze snapshot; canonical storage is now per-feature `features[].fusebaseGateMeta`. */
  fusebaseGateMeta?: GateSdkOperationsSnapshot;
  [key: string]: unknown;
}

let configCache: Config | null = null;

export function getConfig(): Config {
  if (configCache) {
    return configCache;
  }
  try {
    const data = readFileSync(CONFIG_FILE, "utf-8");
    configCache = JSON.parse(data) as Config;
    return configCache;
  } catch {
    return {};
  }
}

export function setConfig(updates: Partial<Config>): void {
  const current = getConfig();
  const next = { ...current, ...updates };
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), "utf-8");
  configCache = next;
}

export function getUpdateChannel(): "prod" | "dev" {
  return getConfig().updateChannel ?? "prod";
}

/** Known experimental flags. */
export const KNOWN_FLAGS = [
  "analytics",
  "mcp-beta",
  "git-init",
  "git-debug-commits",
  "app-business-docs",
  "mcp-gate-debug",
  "isolated-stores",
  "portal-specific-features",
  "api-exploration",
  "job-sidecars",
] as const;
export type KnownFlag = (typeof KNOWN_FLAGS)[number];

/** Short descriptions for known experimental flags (used in interactive UX/help text). */
export const KNOWN_FLAG_DESCRIPTIONS: Record<KnownFlag, string> = {
  analytics: "Enable anonymous usage analytics (coding agent, model, OS stats).",
  "mcp-beta": "Enable beta MCP servers in integrations catalog.",
  "git-init": "Run Git initialization + GitLab sync automatically during `fusebase init`.",
  "git-debug-commits": "Enable mandatory commit-per-fix and strict debug/deploy traceability in git workflow skill.",
  "app-business-docs": "Include business-logic documentation skill in project template.",
  "mcp-gate-debug": "Include Gate MCP debug summary skill (focus on isolated stores).",
  "isolated-stores": "Enable isolated stores functionality (SQL/NoSQL).",
  "portal-specific-features":
    "Include portal-specific feature prompts and guidance (`{{CurrentPortal}}`, portal auth context).",
  "api-exploration":
    "Include api-exploration skill for verifying API endpoints with temporary tokens and test scripts.",
  "job-sidecars":
    "Enable per-job sidecar containers for cron jobs (`fusebase sidecar add --job <name>`).",
};

export function getFlags(): string[] {
  const flags = getConfig().flags ?? [];
  for (const flag of ALWAYS_ON_FLAGS) {
    if (!flags.includes(flag)) {
      flags.push(flag);
    }
  }
  return flags
}

/** Flags that are always considered enabled regardless of user config. */
export const ALWAYS_ON_FLAGS: readonly string[] = [];

export function hasFlag(flag: string): boolean {
  return getFlags().includes(flag);
}

export function addFlag(flag: string): void {
  const flags = getFlags();
  if (!flags.includes(flag)) {
    setConfig({ flags: [...flags, flag] });
  }
}

export function removeFlag(flag: string): void {
  const flags = getFlags();
  const next = flags.filter((f) => f !== flag);
  setConfig({ flags: next.length > 0 ? next : undefined });
}

let fuseConfigCache: FuseConfig | null = null;
let fuseConfigLoaded = false;

export const loadFuseConfig = (): FuseConfig | null => {
  if (fuseConfigLoaded) {
    return fuseConfigCache;
  }
  fuseConfigLoaded = true;

  const fuseJsonPath = join(process.cwd(), "fusebase.json");
  if (existsSync(fuseJsonPath)) {
    try {
      fuseConfigCache = JSON.parse(readFileSync(fuseJsonPath, "utf-8"));
    } catch {
      // Ignore parse errors
    }
  }
  return fuseConfigCache;
};

/** Clear in-memory fusebase.json cache (call after writing fusebase.json). */
export function invalidateFuseConfigCache(): void {
  fuseConfigCache = null;
  fuseConfigLoaded = false;
}

function sortGateUsedOps(used: string[]): string[] {
  return [...used].sort((a, b) => a.localeCompare(b));
}

function gateUsedOpsEqual(a: string[] | undefined, b: string[]): boolean {
  return (
    JSON.stringify(sortGateUsedOps(a ?? [])) ===
    JSON.stringify(sortGateUsedOps(b))
  );
}

function gatePermissionSetsEqual(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  return (
    JSON.stringify(sortGateUsedOps(a ?? [])) ===
    JSON.stringify(sortGateUsedOps(b ?? []))
  );
}

/** Read one Gate snapshot object from parsed JSON; supports legacy `changedAt`, `used`, `requiredPermissions`. */
function readGateSdkSnapshotFromRaw(
  raw: unknown,
): GateSdkOperationsSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const usedOps =
    (o.usedOps as string[] | undefined) ?? (o.used as string[] | undefined);
  if (usedOps === undefined) return undefined;
  const analyzedAt = typeof o.analyzedAt === "string" ? o.analyzedAt : "";
  const legacyChanged =
    typeof o.changedAt === "string" ? o.changedAt : undefined;
  const usedOpsChangedAt =
    typeof o.usedOpsChangedAt === "string"
      ? o.usedOpsChangedAt
      : (legacyChanged ?? analyzedAt);
  const sdkVersion =
    o.sdkVersion === null || typeof o.sdkVersion === "string"
      ? (o.sdkVersion as string | null)
      : null;
  const permissionsRaw =
    (o.permissions as string[] | undefined) ??
    (o.requiredPermissions as string[] | undefined);
  const permissions =
    permissionsRaw !== undefined ? sortGateUsedOps(permissionsRaw) : undefined;
  let permissionsChangedAt: string | undefined;
  if (typeof o.permissionsChangedAt === "string") {
    permissionsChangedAt = o.permissionsChangedAt;
  } else if (typeof o.requiredPermissionsChangedAt === "string") {
    permissionsChangedAt = o.requiredPermissionsChangedAt;
  } else if (permissions !== undefined) {
    permissionsChangedAt = legacyChanged ?? analyzedAt;
  }
  return normalizeGateSdkOperationsSnapshot({
    sdkVersion,
    analyzedAt,
    usedOpsChangedAt,
    ...(permissionsChangedAt !== undefined ? { permissionsChangedAt } : {}),
    usedOps: sortGateUsedOps(usedOps),
    ...(permissions !== undefined ? { permissions } : {}),
  });
}

/** Read one Gate snapshot from a feature entry; supports legacy nested `gateSdkOperations`. */
function readFeatureGateMetaFromFeatureRaw(
  raw: unknown,
): GateSdkOperationsSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return (
    readGateSdkSnapshotFromRaw(o.fusebaseGateMeta) ??
    readGateSdkSnapshotFromRaw(o.gateSdkOperations)
  );
}

/** Read legacy top-level Gate snapshot from fusebase.json root, or old `gateSdkOperations`. */
function readLegacyProjectGateMetaFromFusebaseRaw(
  raw: Record<string, unknown>,
): GateSdkOperationsSnapshot | undefined {
  return (
    readGateSdkSnapshotFromRaw(raw.fusebaseGateMeta) ??
    readGateSdkSnapshotFromRaw(raw.gateSdkOperations)
  );
}

function getFeatureIndexById(
  raw: Record<string, unknown>,
  featureId: string,
): number {
  const features = Array.isArray(raw.features) ? raw.features : [];
  return features.findIndex((feature) => {
    if (!feature || typeof feature !== "object") return false;
    return (feature as Record<string, unknown>).id === featureId;
  });
}

function readPreviousGateSnapshotForFeature(
  raw: Record<string, unknown>,
  featureId: string,
): GateSdkOperationsSnapshot | undefined {
  const features = Array.isArray(raw.features) ? raw.features : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) return undefined;

  const featureRaw = features[featureIndex];
  const featureSnapshot = readFeatureGateMetaFromFeatureRaw(featureRaw);
  if (featureSnapshot) return featureSnapshot;

  if (features.length === 1) {
    return readLegacyProjectGateMetaFromFusebaseRaw(raw);
  }

  return undefined;
}

function writeGateSnapshotToFeatureRaw(
  raw: Record<string, unknown>,
  featureId: string,
  snapshot: GateSdkOperationsSnapshot,
): void {
  const features = Array.isArray(raw.features) ? [...raw.features] : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) {
    throw new Error(`Feature "${featureId}" not found in fusebase.json`);
  }

  const featureRaw = features[featureIndex];
  if (!featureRaw || typeof featureRaw !== "object") {
    throw new Error(`Feature "${featureId}" is invalid in fusebase.json`);
  }

  const nextFeature = {
    ...(featureRaw as Record<string, unknown>),
    fusebaseGateMeta: snapshot,
  };
  delete (nextFeature as Record<string, unknown>).gateSdkOperations;

  features[featureIndex] = nextFeature;
  raw.features = features;
  delete raw.fusebaseGateMeta;
  delete raw.gateSdkOperations;
}

/**
 * Stable key order in fusebase.json:
 * sdkVersion, analyzedAt, usedOpsChangedAt, permissionsChangedAt (if any), usedOps, permissions (if any).
 */
function normalizeGateSdkOperationsSnapshot(
  s: GateSdkOperationsSnapshot,
): GateSdkOperationsSnapshot {
  const {
    sdkVersion,
    analyzedAt,
    usedOpsChangedAt,
    permissionsChangedAt,
    usedOps,
    permissions,
  } = s;
  if (permissions !== undefined) {
    return {
      sdkVersion,
      analyzedAt,
      usedOpsChangedAt,
      permissionsChangedAt: permissionsChangedAt ?? analyzedAt,
      usedOps,
      permissions,
    };
  }
  return {
    sdkVersion,
    analyzedAt,
    usedOpsChangedAt,
    usedOps,
  };
}

export interface GateSdkOperationsWriteInput {
  analyzedAt: string;
  usedOps: string[];
  sdkVersion: string | null;
}

/**
 * Merge per-feature `fusebaseGateMeta` into `fusebase.json` in `projectRoot`.
 * Sets `usedOpsChangedAt` to `analyzedAt` when the sorted `usedOps` list differs from the previous snapshot; otherwise keeps the previous value.
 * When `usedOps` are unchanged, copies `permissions` and `permissionsChangedAt` from the previous snapshot.
 * @throws If fusebase.json is missing or invalid JSON.
 */
export function writeGateSdkOperationsToFusebaseJson(
  projectRoot: string,
  featureId: string,
  input: GateSdkOperationsWriteInput,
): GateSdkOperationsSnapshot {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) {
    throw new Error("fusebase.json not found. Run fusebase init first.");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("Could not parse fusebase.json");
  }

  const usedSorted = sortGateUsedOps(input.usedOps);
  const prev = readPreviousGateSnapshotForFeature(raw, featureId);

  let usedOpsChangedAt: string;
  if (!prev) {
    usedOpsChangedAt = input.analyzedAt;
  } else if (gateUsedOpsEqual(prev.usedOps, usedSorted)) {
    usedOpsChangedAt =
      prev.usedOpsChangedAt ?? prev.analyzedAt ?? input.analyzedAt;
  } else {
    usedOpsChangedAt = input.analyzedAt;
  }

  let snapshot: GateSdkOperationsSnapshot = {
    sdkVersion: input.sdkVersion,
    analyzedAt: input.analyzedAt,
    usedOpsChangedAt,
    usedOps: usedSorted,
  };

  if (
    prev &&
    gateUsedOpsEqual(prev.usedOps, usedSorted) &&
    prev.permissions !== undefined
  ) {
    snapshot = {
      ...snapshot,
      permissions: sortGateUsedOps(prev.permissions),
      permissionsChangedAt: prev.permissionsChangedAt ?? prev.analyzedAt,
    };
  }

  snapshot = normalizeGateSdkOperationsSnapshot(snapshot);

  writeGateSnapshotToFeatureRaw(raw, featureId, snapshot);
  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
  return snapshot;
}

/**
 * Set `features[].fusebaseGateMeta.permissions` in fusebase.json (keeps other snapshot fields).
 * Bumps `permissionsChangedAt` only when the sorted permission set differs from the previous snapshot.
 */
export function updateGateSdkPermissionsInFusebaseJson(
  projectRoot: string,
  featureId: string,
  permissions: string[],
  resolvedAt: string,
): GateSdkOperationsSnapshot {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) {
    throw new Error("fusebase.json not found.");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error("Could not parse fusebase.json");
  }
  const g = readPreviousGateSnapshotForFeature(raw, featureId);
  if (!g) {
    throw new Error(
      `Feature-scoped fusebaseGateMeta missing or invalid for feature "${featureId}" in fusebase.json`,
    );
  }
  const sorted = sortGateUsedOps(permissions);
  const permsChanged = !gatePermissionSetsEqual(g.permissions, sorted);
  const nextPermissionsChangedAt = permsChanged
    ? resolvedAt
    : (g.permissionsChangedAt ?? resolvedAt);
  const next = normalizeGateSdkOperationsSnapshot({
    ...g,
    permissions: sorted,
    permissionsChangedAt: nextPermissionsChangedAt,
  });
  writeGateSnapshotToFeatureRaw(raw, featureId, next);
  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
  return next;
}

export const getEnv = (): string | undefined => {
  const config = getConfig();
  if (config.env) {
    return config.env;
  }

  if (!config.env && !process.env.ENV) {
    return "prod";
  }

  return config.env ? config.env : process.env.ENV;
};

/** Fusebase main host (no protocol; use for subdomains e.g. dashboards-mcp.{host}). In .env as FUSEBASE_HOST. */
export function getFusebaseHost(): string {
  return getEnv() === "prod" ? "thefusebase.com" : "dev-thefusebase.com";
}

/** Fusebase app host (apps subdomain, no protocol). In .env as FUSEBASE_APP_HOST. */
export function getFusebaseAppHost(): string {
  return getEnv() === "prod" ? "thefusebase.app" : "dev-thefusebase-app.com";
}
