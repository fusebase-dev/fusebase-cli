import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "fs";
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
  /**
   * Whitelist of app feature secret keys to inject as env vars into the sidecar
   * container. String entries inject under the same name; `{from, as}` renames
   * the env var inside the sidecar. The sidecar's static `env` entries override
   * secret values on key conflict.
   */
  secrets?: Array<string | { from: string; as: string }>;
}

export interface BackendConfig {
  dev?: DevConfig;
  build?: BuildConfig;
  start?: BackendStartConfig;
  jobs?: BackendJobConfig[];
  sidecars?: SidecarConfig[];
}

export type IsolatedSqlRlsTableClassification =
  | "tenant"
  | "user"
  | "owner_collaborator"
  | "scoped"
  | "none"
  | "technical";

export interface IsolatedSqlRlsScopeManifest {
  name: string;
  column: string;
  setting?: string | null;
}

export interface IsolatedSqlRlsTableManifest {
  classification: IsolatedSqlRlsTableClassification;
  schemaName?: string | null;
  orgColumn?: string | null;
  userColumn?: string | null;
  ownerColumn?: string | null;
  collaboratorTable?: string | null;
  scopes?: IsolatedSqlRlsScopeManifest[] | null;
  reason?: string | null;
}

export interface IsolatedSqlRlsManifest {
  tables: Record<string, IsolatedSqlRlsTableManifest>;
}

export interface IsolatedSqlStoreConfig {
  alias: string;
  storeId?: string;
  migrationsDir?: string;
  schemaName?: string;
  rlsManifestFile?: string;
  rlsManifest?: IsolatedSqlRlsManifest;
}

export interface IsolatedStoresConfig {
  sql?: IsolatedSqlStoreConfig[];
}

export interface FeatureConfig {
  id: string;
  path?: string;
  dev?: DevConfig;
  build?: BuildConfig;
  backend?: BackendConfig;
  isolatedStores?: IsolatedStoresConfig;
  /** Gate SDK analyze snapshot scoped to this feature path. */
  fusebaseGateMeta?: GateSdkOperationsSnapshot;
  /** Cross-app API dependency analyze snapshot scoped to this feature path. */
  fusebaseAppApiDependenciesMeta?: AppApiDependenciesSnapshot;
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

export type AppApiDependencySource = "static" | "manual";

export interface AppApiDependencySnapshot {
  targetOrgId: string;
  targetAppId: string;
  operationId: string;
  source: AppApiDependencySource;
}

export interface AppApiUnresolvedDependencySnapshot {
  reason: string;
  file: string;
  line: number;
  column: number;
}

/** Written by `fusebase analyze app-apis` — cross-app API dependency snapshot. */
export interface AppApiDependenciesSnapshot {
  sdkVersion: string | null;
  analyzedAt: string;
  dependenciesChangedAt: string;
  unresolvedChangedAt: string;
  dependencies: AppApiDependencySnapshot[];
  unresolved: AppApiUnresolvedDependencySnapshot[];
}

// Read fusebase.json env config (takes precedence over process.env)
export interface FuseConfig {
  /** written but not used, only for debug purposes */
  env?: string;
  orgId: string;
  productId: string;
  apps?: FeatureConfig[];
  /** Legacy project-level Gate SDK analyze snapshot; canonical storage is now per-feature `apps[].fusebaseGateMeta`. */
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
export const MANAGED_INTEGRATIONS_FLAG = "managed-integrations";
export const PERSONAL_MANAGED_INTEGRATIONS_FLAG = "managed-integrations-personal-auth";

export const KNOWN_FLAGS = [
  "mcp-beta",
  "git-init",
  "git-debug-commits",
  "app-business-docs",
  "mcp-gate-debug",
  "isolated-stores",
  "postgres-rls",
  "legacy-dashboards-db",
  "portal-specific-apps",
  "api-exploration",
  "job-sidecars",
  "cross-app-api-calls-analysis",
  MANAGED_INTEGRATIONS_FLAG,
] as const;
export type KnownFlag = (typeof KNOWN_FLAGS)[number];

/** Short descriptions for known experimental flags (used in interactive UX/help text). */
export const KNOWN_FLAG_DESCRIPTIONS: Record<KnownFlag, string> = {
  "mcp-beta": "Enable beta MCP servers in integrations catalog.",
  "git-init": "Run Git initialization + GitLab sync automatically during `fusebase init`.",
  "git-debug-commits": "Enable mandatory commit-per-fix and strict debug/deploy traceability in git workflow skill.",
  "app-business-docs": "Include business-logic documentation skill in project template.",
  "mcp-gate-debug": "Include Gate MCP debug summary skill (focus on isolated stores).",
  "isolated-stores": "Enable isolated stores functionality (SQL/NoSQL).",
  "postgres-rls": "Enable experimental RLS manifest helpers for isolated SQL stores.",
  "legacy-dashboards-db":
    "Expose dashboard DB/dashboard creation guidance and enable dashboard-service database/dashboard management permissions in MCP tokens.",
  "portal-specific-apps":
    "Include portal-specific app prompts and guidance (`{{CurrentPortal}}`, portal auth context).",
  "api-exploration":
    "Include api-exploration skill for verifying API endpoints with temporary tokens and test scripts.",
  "job-sidecars":
    "Enable per-job sidecar containers for cron jobs (`fusebase sidecar add --job <name>`).",
  "cross-app-api-calls-analysis":
    "Enable hidden `fusebase analyze app-apis` command and related cross-app API dependency guidance in templates.",
  [MANAGED_INTEGRATIONS_FLAG]:
    "Enable managed third-party MCP integrations (`fusebase integrations list-templates/connect`).",
  // [PERSONAL_MANAGED_INTEGRATIONS_FLAG]:
    // "Enable personal authorization for managed integrations.",
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
let legacyShapeWarningPrinted = false;
let legacyFeaturePathsWarningPrinted = false;
let featuresFolderMigrationWarningPrinted = false;
let agentAssetsRefreshNeeded = false;

/**
 * Migrate fusebase.json legacy shape in-place to the new shape:
 *  - rename `appId` → `productId` and drop `appId`
 *  - rename `features[]` → `apps[]` and drop `features[]`
 *
 * Does NOT touch `apps[].path` prefixes — that rewrite is filesystem-anchored
 * (a path is a reference to a real on-disk directory) and is handled by
 * `rewriteLegacyFeaturePathsInRaw`, which only rewrites when the legacy
 * `features/` directory is already gone from disk.
 *
 * Prints a one-time warning the first time a legacy-shape file is observed
 * in this process. Idempotent — safe to call on already-normalized objects.
 */
export function normalizeRawFuseConfigShape(
  raw: Record<string, unknown>,
): { migrated: boolean } {
  let migrated = false;
  if (raw.productId === undefined && typeof raw.appId === "string") {
    raw.productId = raw.appId;
    migrated = true;
  }
  if (raw.appId !== undefined) {
    delete raw.appId;
    migrated = true;
  }
  if (raw.apps === undefined && Array.isArray(raw.features)) {
    raw.apps = raw.features;
    migrated = true;
  }
  if (raw.features !== undefined) {
    delete raw.features;
    migrated = true;
  }
  if (migrated) {
    agentAssetsRefreshNeeded = true;
    if (!legacyShapeWarningPrinted) {
      legacyShapeWarningPrinted = true;
      console.warn(
        "fusebase.json: legacy shape detected and auto-migrated to 'productId'/'apps[]'. " +
          "The new shape will be persisted on this run.",
      );
    }
  }
  return { migrated };
}

/**
 * Rewrite legacy `features/X` prefixes in `apps[].path` to `apps/X` in-place,
 * but only when it is safe to do so — i.e. when a `features/` directory does
 * NOT exist at `projectRoot`. Callers that don't have filesystem context
 * (omit `projectRoot`) get the pre-NIM-41161 behaviour and always rewrite.
 *
 * Skipping the rewrite is the fix for NIM-41161: if the on-disk
 * `features/` → `apps/` rename failed (EPERM on Windows, permission
 * collisions, etc.), an unconditional rewrite would persist paths pointing
 * at a non-existent `apps/X` while the files still live under `features/X`,
 * breaking deploy. Keeping the paths aligned with what is actually on disk
 * means the existing project keeps working even when the FS rename can't be
 * applied automatically.
 *
 * Prints a one-time warning the first time the rewrite fires. Idempotent.
 */
export function rewriteLegacyFeaturePathsInRaw(
  raw: Record<string, unknown>,
  projectRoot?: string,
): { rewritten: boolean } {
  if (!Array.isArray(raw.apps)) {
    return { rewritten: false };
  }
  if (projectRoot !== undefined && existsSync(join(projectRoot, "features"))) {
    return { rewritten: false };
  }
  let rewritten = false;
  for (const app of raw.apps) {
    if (!app || typeof app !== "object") continue;
    const a = app as Record<string, unknown>;
    if (typeof a.path === "string" && a.path.startsWith("features/")) {
      a.path = "apps/" + a.path.slice("features/".length);
      rewritten = true;
    }
  }
  if (rewritten) {
    agentAssetsRefreshNeeded = true;
    if (!legacyFeaturePathsWarningPrinted) {
      legacyFeaturePathsWarningPrinted = true;
      console.warn(
        "fusebase.json: rewrote legacy 'features/' → 'apps/' path prefixes " +
          "in apps[] to match the renamed on-disk directory.",
      );
    }
  }
  return { rewritten };
}

export const loadFuseConfig = (): FuseConfig | null => {
  if (fuseConfigLoaded) {
    return fuseConfigCache;
  }
  fuseConfigLoaded = true;

  const cwd = process.cwd();
  const fuseJsonPath = join(cwd, "fusebase.json");
  if (existsSync(fuseJsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<
        string,
        unknown
      >;
      const { migrated } = normalizeRawFuseConfigShape(raw);
      const { renamed } = migrateFeaturesFolderToAppsAtRoot(cwd);
      const { rewritten } = rewriteLegacyFeaturePathsInRaw(raw, cwd);
      if (migrated || renamed || rewritten) {
        // Persist the normalized shape so subsequent CLI invocations read a
        // clean new-shape file and the migration helpers stop firing.
        try {
          writeFileSync(
            fuseJsonPath,
            JSON.stringify(raw, null, 2) + "\n",
            "utf-8",
          );
        } catch {
          // Best-effort: in-memory normalization still stands; the next
          // write helper (gate analyze / sidecar / etc.) will persist.
        }
      }
      fuseConfigCache = raw as unknown as FuseConfig;
    } catch {
      // Ignore parse errors
    }
  }
  return fuseConfigCache;
};

/**
 * Rename a leftover legacy `features/` directory at the project root to
 * `apps/` so the on-disk layout matches the renamed `apps[]` entries in
 * fusebase.json. Idempotent and best-effort:
 *  - no-op if `features/` does not exist
 *  - no-op (with a one-time warning) if `apps/` already exists alongside it
 *  - otherwise `renameSync(features, apps)` and prints a one-time warning
 *
 * The in-memory `apps[].path` rewrite from `features/...` to `apps/...` is
 * handled by `rewriteLegacyFeaturePathsInRaw`, which keys off the post-rename
 * filesystem state so paths only update when the on-disk folder actually
 * moved (NIM-41161).
 */
export function migrateFeaturesFolderToAppsAtRoot(
  projectRoot: string,
): { renamed: boolean } {
  const featuresDir = join(projectRoot, "features");
  const appsDir = join(projectRoot, "apps");
  if (!existsSync(featuresDir)) {
    return { renamed: false };
  }
  if (existsSync(appsDir)) {
    if (!featuresFolderMigrationWarningPrinted) {
      featuresFolderMigrationWarningPrinted = true;
      console.warn(
        "fusebase: legacy 'features/' directory detected alongside 'apps/'; " +
          "skipping auto-rename to avoid collision. Move contents manually.",
      );
    }
    return { renamed: false };
  }

  try {
    renameSync(featuresDir, appsDir);
  } catch (error) {
    if (!featuresFolderMigrationWarningPrinted) {
      featuresFolderMigrationWarningPrinted = true;
      console.warn(
        `fusebase: failed to rename legacy 'features/' directory to 'apps/': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { renamed: false };
  }

  agentAssetsRefreshNeeded = true;
  if (!featuresFolderMigrationWarningPrinted) {
    featuresFolderMigrationWarningPrinted = true;
    console.warn(
      "fusebase: renamed legacy 'features/' directory to 'apps/' to match the new naming.",
    );
  }

  return { renamed: true };
}

/**
 * Run AGENTS.md + .claude assets refresh once per process when an earlier
 * `loadFuseConfig` / `normalizeRawFuseConfigShape` / `migrateFeaturesFolderToAppsAtRoot`
 * detected and applied a legacy → new-shape migration. Uses the same template
 * extraction flow as `fusebase update` (`copyAgentsAndSkills`) so any
 * project-template renames (`features/` → `apps/`, `fusebase feature *` →
 * `fusebase app *`, etc.) propagate into the project's `.claude` directory
 * without requiring the user to run `fusebase update` separately.
 *
 * Idempotent: the pending flag is cleared on the first call, so subsequent
 * calls in the same process are no-ops.
 */
export async function flushAgentAssetsRefreshAfterMigration(
  cwd: string,
): Promise<{ refreshed: boolean }> {
  if (!agentAssetsRefreshNeeded) {
    return { refreshed: false };
  }
  agentAssetsRefreshNeeded = false;
  try {
    const { copyAgentsAndSkills } = await import("./copy-template");
    await copyAgentsAndSkills(cwd);
    console.log(
      "fusebase: refreshed AGENTS.md, .claude/skills, .claude/agents, .claude/hooks and .claude/settings.json to match new naming.",
    );
    return { refreshed: true };
  } catch (error) {
    console.warn(
      `fusebase: failed to refresh .claude assets after auto-migration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { refreshed: false };
  }
}

/** Clear in-memory fusebase.json cache (call after writing fusebase.json). */
export function invalidateFuseConfigCache(): void {
  fuseConfigCache = null;
  fuseConfigLoaded = false;
}

/** Test-only: reset the once-per-process legacy-shape warning state. */
export function resetLegacyShapeWarningForTests(): void {
  legacyShapeWarningPrinted = false;
}

/** Test-only: reset the once-per-process legacy-feature-paths warning state. */
export function resetLegacyFeaturePathsWarningForTests(): void {
  legacyFeaturePathsWarningPrinted = false;
}

/** Test-only: reset the once-per-process features-folder migration warning state. */
export function resetFeaturesFolderMigrationWarningForTests(): void {
  featuresFolderMigrationWarningPrinted = false;
}

/** Test-only: reset the once-per-process pending agent-assets refresh flag. */
export function resetAgentAssetsRefreshFlagForTests(): void {
  agentAssetsRefreshNeeded = false;
}

/** Test-only: introspect the pending agent-assets refresh flag. */
export function isAgentAssetsRefreshPendingForTests(): boolean {
  return agentAssetsRefreshNeeded;
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

function sortAppApiDependencies(
  dependencies: AppApiDependencySnapshot[],
): AppApiDependencySnapshot[] {
  return [...dependencies].sort(
    (a, b) =>
      a.targetOrgId.localeCompare(b.targetOrgId) ||
      a.targetAppId.localeCompare(b.targetAppId) ||
      a.operationId.localeCompare(b.operationId) ||
      a.source.localeCompare(b.source),
  );
}

function sortAppApiUnresolved(
  unresolved: AppApiUnresolvedDependencySnapshot[],
): AppApiUnresolvedDependencySnapshot[] {
  return [...unresolved].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.column - b.column ||
      a.reason.localeCompare(b.reason),
  );
}

function dedupeAppApiDependencies(
  dependencies: AppApiDependencySnapshot[],
): AppApiDependencySnapshot[] {
  const seen = new Set<string>();
  const out: AppApiDependencySnapshot[] = [];

  for (const dependency of sortAppApiDependencies(dependencies)) {
    const key = [
      dependency.targetOrgId,
      dependency.targetAppId,
      dependency.operationId,
      dependency.source,
    ].join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dependency);
  }

  return out;
}

function dedupeAppApiUnresolved(
  unresolved: AppApiUnresolvedDependencySnapshot[],
): AppApiUnresolvedDependencySnapshot[] {
  const seen = new Set<string>();
  const out: AppApiUnresolvedDependencySnapshot[] = [];

  for (const item of sortAppApiUnresolved(unresolved)) {
    const key = [item.file, item.line, item.column, item.reason].join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function appApiDependenciesEqual(
  a: AppApiDependencySnapshot[] | undefined,
  b: AppApiDependencySnapshot[],
): boolean {
  return (
    JSON.stringify(dedupeAppApiDependencies(a ?? [])) ===
    JSON.stringify(dedupeAppApiDependencies(b))
  );
}

function appApiUnresolvedEqual(
  a: AppApiUnresolvedDependencySnapshot[] | undefined,
  b: AppApiUnresolvedDependencySnapshot[],
): boolean {
  return (
    JSON.stringify(dedupeAppApiUnresolved(a ?? [])) ===
    JSON.stringify(dedupeAppApiUnresolved(b))
  );
}

function readAppApiDependenciesSnapshotFromRaw(
  raw: unknown,
): AppApiDependenciesSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.dependencies) || !Array.isArray(o.unresolved)) {
    return undefined;
  }

  const sdkVersion =
    o.sdkVersion === null || typeof o.sdkVersion === "string"
      ? (o.sdkVersion as string | null)
      : null;
  const analyzedAt = typeof o.analyzedAt === "string" ? o.analyzedAt : "";
  const dependenciesChangedAt =
    typeof o.dependenciesChangedAt === "string"
      ? o.dependenciesChangedAt
      : analyzedAt;
  const unresolvedChangedAt =
    typeof o.unresolvedChangedAt === "string"
      ? o.unresolvedChangedAt
      : analyzedAt;

  const dependencies: AppApiDependencySnapshot[] = [];
  for (const dependency of o.dependencies) {
    if (!dependency || typeof dependency !== "object") continue;
    const item = dependency as Record<string, unknown>;
    if (
      typeof item.targetOrgId !== "string" ||
      typeof item.targetAppId !== "string" ||
      typeof item.operationId !== "string" ||
      (item.source !== "static" && item.source !== "manual")
    ) {
      continue;
    }
    dependencies.push({
      targetOrgId: item.targetOrgId,
      targetAppId: item.targetAppId,
      operationId: item.operationId,
      source: item.source,
    });
  }

  const unresolved: AppApiUnresolvedDependencySnapshot[] = [];
  for (const unresolvedItem of o.unresolved) {
    if (!unresolvedItem || typeof unresolvedItem !== "object") continue;
    const item = unresolvedItem as Record<string, unknown>;
    if (
      typeof item.reason !== "string" ||
      typeof item.file !== "string" ||
      typeof item.line !== "number" ||
      !Number.isFinite(item.line) ||
      typeof item.column !== "number" ||
      !Number.isFinite(item.column)
    ) {
      continue;
    }
    unresolved.push({
      reason: item.reason,
      file: item.file,
      line: item.line,
      column: item.column,
    });
  }

  return normalizeAppApiDependenciesSnapshot({
    sdkVersion,
    analyzedAt,
    dependenciesChangedAt,
    unresolvedChangedAt,
    dependencies,
    unresolved,
  });
}

function readFeatureAppApiDependenciesMetaFromFeatureRaw(
  raw: unknown,
): AppApiDependenciesSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return readAppApiDependenciesSnapshotFromRaw(o.fusebaseAppApiDependenciesMeta);
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
  const apps = Array.isArray(raw.apps) ? raw.apps : [];
  return apps.findIndex((app) => {
    if (!app || typeof app !== "object") return false;
    return (app as Record<string, unknown>).id === featureId;
  });
}

function readPreviousGateSnapshotForFeature(
  raw: Record<string, unknown>,
  featureId: string,
): GateSdkOperationsSnapshot | undefined {
  const apps = Array.isArray(raw.apps) ? raw.apps : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) return undefined;

  const featureRaw = apps[featureIndex];
  const featureSnapshot = readFeatureGateMetaFromFeatureRaw(featureRaw);
  if (featureSnapshot) return featureSnapshot;

  if (apps.length === 1) {
    return readLegacyProjectGateMetaFromFusebaseRaw(raw);
  }

  return undefined;
}

function readPreviousAppApiDependenciesSnapshotForFeature(
  raw: Record<string, unknown>,
  featureId: string,
): AppApiDependenciesSnapshot | undefined {
  const apps = Array.isArray(raw.apps) ? raw.apps : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) return undefined;

  const featureRaw = apps[featureIndex];
  return readFeatureAppApiDependenciesMetaFromFeatureRaw(featureRaw);
}

function writeGateSnapshotToFeatureRaw(
  raw: Record<string, unknown>,
  featureId: string,
  snapshot: GateSdkOperationsSnapshot,
): void {
  const apps = Array.isArray(raw.apps) ? [...raw.apps] : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) {
    throw new Error(`App "${featureId}" not found in fusebase.json`);
  }

  const featureRaw = apps[featureIndex];
  if (!featureRaw || typeof featureRaw !== "object") {
    throw new Error(`App "${featureId}" is invalid in fusebase.json`);
  }

  const nextFeature = {
    ...(featureRaw as Record<string, unknown>),
    fusebaseGateMeta: snapshot,
  };
  delete (nextFeature as Record<string, unknown>).gateSdkOperations;

  apps[featureIndex] = nextFeature;
  raw.apps = apps;
  delete raw.fusebaseGateMeta;
  delete raw.gateSdkOperations;
}

function writeAppApiDependenciesSnapshotToFeatureRaw(
  raw: Record<string, unknown>,
  featureId: string,
  snapshot: AppApiDependenciesSnapshot,
): void {
  const apps = Array.isArray(raw.apps) ? [...raw.apps] : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) {
    throw new Error(`App "${featureId}" not found in fusebase.json`);
  }

  const featureRaw = apps[featureIndex];
  if (!featureRaw || typeof featureRaw !== "object") {
    throw new Error(`App "${featureId}" is invalid in fusebase.json`);
  }

  const nextFeature = {
    ...(featureRaw as Record<string, unknown>),
    fusebaseAppApiDependenciesMeta: snapshot,
  };

  apps[featureIndex] = nextFeature;
  raw.apps = apps;
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

/**
 * Stable key order in fusebase.json:
 * sdkVersion, analyzedAt, dependenciesChangedAt, unresolvedChangedAt, dependencies, unresolved.
 */
function normalizeAppApiDependenciesSnapshot(
  s: AppApiDependenciesSnapshot,
): AppApiDependenciesSnapshot {
  return {
    sdkVersion: s.sdkVersion,
    analyzedAt: s.analyzedAt,
    dependenciesChangedAt: s.dependenciesChangedAt,
    unresolvedChangedAt: s.unresolvedChangedAt,
    dependencies: dedupeAppApiDependencies(s.dependencies),
    unresolved: dedupeAppApiUnresolved(s.unresolved),
  };
}

export interface GateSdkOperationsWriteInput {
  analyzedAt: string;
  usedOps: string[];
  sdkVersion: string | null;
}

export interface AppApiDependenciesWriteInput {
  analyzedAt: string;
  sdkVersion: string | null;
  dependencies: AppApiDependencySnapshot[];
  unresolved: AppApiUnresolvedDependencySnapshot[];
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
  normalizeRawFuseConfigShape(raw);
  rewriteLegacyFeaturePathsInRaw(raw, projectRoot);

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
 * Merge per-feature `fusebaseAppApiDependenciesMeta` into `fusebase.json` in `projectRoot`.
 * Preserves previous `source: "manual"` dependencies and replaces only `source: "static"`.
 * Bumps changed timestamps only when sorted/deduped sets differ from the previous snapshot.
 * @throws If fusebase.json is missing or invalid JSON.
 */
export function writeAppApiDependenciesToFusebaseJson(
  projectRoot: string,
  featureId: string,
  input: AppApiDependenciesWriteInput,
): AppApiDependenciesSnapshot {
  if (!hasFlag("cross-app-api-calls-analysis")) {
    throw new Error(
      "cross-app API dependencies analysis is disabled. Enable it with: fusebase config set-flag cross-app-api-calls-analysis",
    );
  }

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
  normalizeRawFuseConfigShape(raw);
  rewriteLegacyFeaturePathsInRaw(raw, projectRoot);

  const prev = readPreviousAppApiDependenciesSnapshotForFeature(raw, featureId);
  const previousManualDependencies = (prev?.dependencies ?? []).filter(
    (dependency) => dependency.source === "manual",
  );

  const nextStaticDependencies = input.dependencies
    .filter((dependency) => dependency.source === "static")
    .map((dependency) => ({
      targetOrgId: dependency.targetOrgId,
      targetAppId: dependency.targetAppId,
      operationId: dependency.operationId,
      source: "static" as const,
    }));

  const mergedDependencies = dedupeAppApiDependencies([
    ...previousManualDependencies,
    ...nextStaticDependencies,
  ]);
  const mergedUnresolved = dedupeAppApiUnresolved(input.unresolved);

  let dependenciesChangedAt: string;
  if (!prev) {
    dependenciesChangedAt = input.analyzedAt;
  } else if (appApiDependenciesEqual(prev.dependencies, mergedDependencies)) {
    dependenciesChangedAt =
      prev.dependenciesChangedAt ?? prev.analyzedAt ?? input.analyzedAt;
  } else {
    dependenciesChangedAt = input.analyzedAt;
  }

  let unresolvedChangedAt: string;
  if (!prev) {
    unresolvedChangedAt = input.analyzedAt;
  } else if (appApiUnresolvedEqual(prev.unresolved, mergedUnresolved)) {
    unresolvedChangedAt =
      prev.unresolvedChangedAt ?? prev.analyzedAt ?? input.analyzedAt;
  } else {
    unresolvedChangedAt = input.analyzedAt;
  }

  const snapshot = normalizeAppApiDependenciesSnapshot({
    sdkVersion: input.sdkVersion,
    analyzedAt: input.analyzedAt,
    dependenciesChangedAt,
    unresolvedChangedAt,
    dependencies: mergedDependencies,
    unresolved: mergedUnresolved,
  });

  writeAppApiDependenciesSnapshotToFeatureRaw(raw, featureId, snapshot);
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
  normalizeRawFuseConfigShape(raw);
  rewriteLegacyFeaturePathsInRaw(raw, projectRoot);
  const g = readPreviousGateSnapshotForFeature(raw, featureId);
  if (!g) {
    throw new Error(
      `App-scoped fusebaseGateMeta missing or invalid for app "${featureId}" in fusebase.json`,
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
