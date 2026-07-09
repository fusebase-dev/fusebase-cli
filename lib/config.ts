import { join } from "path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "fs";
import { homedir } from "os";
import type { AppAccessPrincipal, AppPermissions } from "./api";

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
  /**
   * Minimum number of warm backend replicas (capped at `MAX_MIN_REPLICAS`).
   * Omit or `0` keeps the default scale-to-zero (cheapest, but cold starts can
   * time out inbound webhook deliveries). Set `1` for apps that receive
   * webhooks or any always-on inbound integration; `>1` only for sustained
   * high traffic — each warm replica runs 24/7 and costs money.
   */
  minReplicas?: number;
}

/**
 * Maximum value a user may set for `backend.minReplicas`. Mirrors
 * `MAX_USER_MIN_REPLICAS` in nimbus-ai (`src/util/backendScale.ts`): the server
 * is the authoritative cost guard, this client-side copy only gives a fast,
 * friendly error before deploy. Keep both in sync.
 */
export const MAX_MIN_REPLICAS = 3;

/**
 * Validate a `backend.minReplicas` value from `fusebase.json`. Treats
 * `undefined`/`null` as "field absent" (no change). Otherwise requires an
 * integer in `[0, MAX_MIN_REPLICAS]` (`0` restores scale-to-zero) and throws a
 * clear error before any network call. `appId` is named in the message when known.
 */
export function validateMinReplicas(value: unknown, appId?: string): void {
  if (value === undefined || value === null) return;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_MIN_REPLICAS
  ) {
    const where = appId ? ` for app "${appId}"` : "";
    throw new Error(
      `backend.minReplicas${where} must be an integer between 0 and ${MAX_MIN_REPLICAS}`,
    );
  }
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

/**
 * A declared app secret in fusebase.json. Only the key name and an optional
 * human description are ever stored here — the secret **value** is set out of
 * band in the FuseBase UI and is never written to, read from, or handled by the
 * CLI. `fusebase secret create` appends these entries; deploy/dev-start register
 * any declared-but-missing key on the platform with an empty value (NIM-secrets).
 */
export interface AppSecretDeclaration {
  key: string;
  description?: string;
}

export interface FeatureConfig {
  /**
   * Platform-issued app id. Optional in the declarative model (NIM-41746):
   * legacy entries keep it for back-compat, declarative entries omit it and
   * are resolved at deploy time by `subdomain`. Never hand-author this id —
   * it is produced by the platform (`fusebase app create` / deploy reconcile).
   */
  id?: string;
  /** App subdomain (`{subdomain}.thefusebase.app`); the declarative match key. */
  subdomain?: string;
  /** App title shown in the platform. */
  name?: string;
  /**
   * Coding-agent/model tracking captured at `app create`. In the declarative
   * model `app create` no longer creates the platform app, so these are stored
   * here and sent when deploy/dev-start creates the app (NIM-41997).
   */
  codingAgent?: string;
  model?: string;
  /**
   * Declared access principals for the app. In the declarative model these are
   * captured at `app create` (`--access`) and applied at deploy-time reconcile
   * via `updateApp`, instead of being sent imperatively at create.
   */
  access?: AppAccessPrincipal[];
  /**
   * Declared manual app permissions (dashboardView/database/gate). Captured at
   * `app create` (`--permissions`) and applied at deploy-time reconcile, merged
   * with the Gate SDK analyze snapshot (`fusebaseGateMeta`).
   */
  permissions?: AppPermissions;
  path?: string;
  dev?: DevConfig;
  build?: BuildConfig;
  backend?: BackendConfig;
  isolatedStores?: IsolatedStoresConfig;
  /**
   * Declared app secrets (key + optional description, never values). Registered
   * on the platform at deploy/dev-start reconcile if missing; values are set in
   * the FuseBase UI. Additive-only — deploy never deletes undeclared platform
   * secret keys (that would wipe a value set in the UI).
   */
  secrets?: AppSecretDeclaration[];
  /**
   * Gate privileges kept out of the browser gst (merged into manifest.backendOnlyGatePermissions on sync).
   * Non-store entries (e.g. org.members.read) stay in app.permissions; nimbus-ai subtracts them at browser mint.
   */
  backendOnlyGatePermissions?: string[];
  /** Gate SDK analyze snapshot scoped to this feature path. */
  fusebaseGateMeta?: GateSdkOperationsSnapshot;
  /** Cross-app API dependency analyze snapshot scoped to this feature path. */
  fusebaseAppApiDependenciesMeta?: AppApiDependenciesSnapshot;
}

/**
 * A deployable app declaration must be resolvable to a platform app: either it
 * carries a legacy `id`, or a declarative `subdomain` that deploy-time reconcile
 * matches/creates. Throws a guiding error otherwise (NIM-41746).
 */
export function assertDeployableFeature(app: FeatureConfig): void {
  if (app.id || app.subdomain) return;
  const where = app.path ? ` for app at "${app.path}"` : "";
  throw new Error(
    `fusebase.json: app entry${where} must have either an "id" (legacy) or a ` +
      `"subdomain" (declarative). Add a "subdomain" so deploy can match or ` +
      `create the platform app — do not hand-author an "id".`,
  );
}

/**
 * Return an app's resolved platform `id`, or throw. `id` is optional on
 * `FeatureConfig` (NIM-41746), but imperative commands (dev, analyze, gate,
 * contracts, isolated-store) operate only on apps already created on the
 * platform, so a missing id there is a real error, not a declarative entry.
 */
export function requireAppId(app: FeatureConfig): string {
  if (app.id) return app.id;
  const where = app.path ? ` (app at "${app.path}")` : "";
  throw new Error(
    `App is missing a platform "id"${where}. Run \`fusebase app create\` or ` +
      `\`fusebase deploy\` (which reconciles declarative entries) first.`,
  );
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
   * Manually reviewed Gate permissions to merge into the resolved permissions.
   * Use for dynamic SDK calls or intentionally hidden/admin operations that static analysis cannot see.
   */
  manualPermissions?: string[];
  /**
   * Gate permission strings required for the current `usedOps` (from `POST /v1/gate/resolve-operation-permissions`), sorted.
   * Includes `manualPermissions` when present.
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
  "declarative-manifest",
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
  "declarative-manifest":
    "Enable declarative `fusebase.json` apps (optional `id`, `subdomain` match) and deploy-time reconcile (bind/create). Off → deploy requires a legacy `id`.",
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
  const manualPermissionsRaw = o.manualPermissions as string[] | undefined;
  const manualPermissions =
    manualPermissionsRaw !== undefined
      ? sortGateUsedOps(manualPermissionsRaw)
      : undefined;
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
    ...(manualPermissions !== undefined ? { manualPermissions } : {}),
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
 * sdkVersion, analyzedAt, usedOpsChangedAt, permissionsChangedAt (if any), usedOps, manualPermissions (if any), permissions (if any).
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
    manualPermissions,
    permissions,
  } = s;
  const sortedManualPermissions =
    manualPermissions !== undefined
      ? sortGateUsedOps(manualPermissions)
      : undefined;
  if (permissions !== undefined) {
    return {
      sdkVersion,
      analyzedAt,
      usedOpsChangedAt,
      permissionsChangedAt: permissionsChangedAt ?? analyzedAt,
      usedOps,
      ...(sortedManualPermissions !== undefined
        ? { manualPermissions: sortedManualPermissions }
        : {}),
      permissions: sortGateUsedOps(permissions),
    };
  }
  return {
    sdkVersion,
    analyzedAt,
    usedOpsChangedAt,
    usedOps,
    ...(sortedManualPermissions !== undefined
      ? { manualPermissions: sortedManualPermissions }
      : {}),
  };
}

function mergeGatePermissionStrings(
  resolvedPermissions: string[] | undefined,
  manualPermissions: string[] | undefined,
): string[] | undefined {
  if (resolvedPermissions === undefined && manualPermissions === undefined) {
    return undefined;
  }

  return sortGateUsedOps([
    ...(resolvedPermissions ?? []),
    ...(manualPermissions ?? []),
  ]);
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

/**
 * Build a Gate SDK analyze snapshot in memory (same rules as fusebase.json writeback).
 */
export function buildGateSdkOperationsSnapshot(
  prev: GateSdkOperationsSnapshot | undefined,
  input: GateSdkOperationsWriteInput,
  options?: { preservePermissionsWhenUsedOpsUnchanged?: boolean },
): GateSdkOperationsSnapshot {
  const preservePermissionsWhenUsedOpsUnchanged =
    options?.preservePermissionsWhenUsedOpsUnchanged !== false;
  const usedSorted = sortGateUsedOps(input.usedOps);

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
  const manualPermissions = prev?.manualPermissions;

  if (
    preservePermissionsWhenUsedOpsUnchanged &&
    prev &&
    gateUsedOpsEqual(prev.usedOps, usedSorted) &&
    prev.permissions !== undefined
  ) {
    snapshot = {
      ...snapshot,
      permissions: mergeGatePermissionStrings(
        prev.permissions,
        manualPermissions,
      ),
      permissionsChangedAt: prev.permissionsChangedAt ?? prev.analyzedAt,
    };
  } else if (manualPermissions !== undefined && manualPermissions.length > 0) {
    snapshot = {
      ...snapshot,
      permissions: manualPermissions,
      permissionsChangedAt: prev?.permissionsChangedAt ?? input.analyzedAt,
    };
  }

  if (manualPermissions !== undefined) {
    snapshot = {
      ...snapshot,
      manualPermissions,
    };
  }

  return normalizeGateSdkOperationsSnapshot(snapshot);
}

/**
 * Merge resolved Gate permissions into an in-memory snapshot (no fusebase.json write).
 */
export function applyResolvedPermissionsToGateSnapshot(
  snapshot: GateSdkOperationsSnapshot,
  permissions: string[],
  resolvedAt: string,
): GateSdkOperationsSnapshot {
  const sorted = mergeGatePermissionStrings(
    permissions,
    snapshot.manualPermissions,
  )!;
  const permsChanged = !gatePermissionSetsEqual(snapshot.permissions, sorted);
  const nextPermissionsChangedAt = permsChanged
    ? resolvedAt
    : (snapshot.permissionsChangedAt ?? resolvedAt);
  return normalizeGateSdkOperationsSnapshot({
    ...snapshot,
    permissions: sorted,
    permissionsChangedAt: nextPermissionsChangedAt,
  });
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
  options?: { preservePermissionsWhenUsedOpsUnchanged?: boolean },
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

  const prev = readPreviousGateSnapshotForFeature(raw, featureId);
  const snapshot = buildGateSdkOperationsSnapshot(prev, input, options);

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

export function upsertManualAppApiDependencyInFusebaseJson(
  projectRoot: string,
  featureId: string,
  dependency: Omit<AppApiDependencySnapshot, "source">,
): { snapshot: AppApiDependenciesSnapshot; added: boolean } {
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
  const now = new Date().toISOString();
  const alreadyPresent = (prev?.dependencies ?? []).some(
    (item) =>
      item.targetOrgId === dependency.targetOrgId &&
      item.targetAppId === dependency.targetAppId &&
      item.operationId === dependency.operationId,
  );

  const nextDependencies = alreadyPresent
    ? dedupeAppApiDependencies(prev?.dependencies ?? [])
    : dedupeAppApiDependencies([
        ...(prev?.dependencies ?? []),
        {
          targetOrgId: dependency.targetOrgId,
          targetAppId: dependency.targetAppId,
          operationId: dependency.operationId,
          source: "manual",
        },
      ]);

  const snapshot = normalizeAppApiDependenciesSnapshot({
    sdkVersion: prev?.sdkVersion ?? null,
    analyzedAt: prev?.analyzedAt ?? now,
    dependenciesChangedAt: alreadyPresent
      ? (prev?.dependenciesChangedAt ?? prev?.analyzedAt ?? now)
      : now,
    unresolvedChangedAt:
      prev?.unresolvedChangedAt ?? prev?.analyzedAt ?? now,
    dependencies: nextDependencies,
    unresolved: prev?.unresolved ?? [],
  });

  writeAppApiDependenciesSnapshotToFeatureRaw(raw, featureId, snapshot);
  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();

  return {
    snapshot,
    added: !alreadyPresent,
  };
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
  const next = applyResolvedPermissionsToGateSnapshot(
    g,
    permissions,
    resolvedAt,
  );
  writeGateSnapshotToFeatureRaw(raw, featureId, next);
  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
  return next;
}

/**
 * Persist a deploy-resolved app `id` back into fusebase.json (NIM-41875).
 * Reconcile resolves a declarative (id-less) entry to a real platform id by
 * subdomain; after a successful deploy we write that id into the matching
 * `apps[]` entry so the next deploy takes the legacy (id) fast path. Matches by
 * `subdomain` (the declarative key, deploy-unique). No-op when the file is
 * missing/unparsable, the entry already has an `id`, or no entry matches the
 * subdomain. Best-effort: callers should not fail the deploy on a write error.
 * Returns true only when an id was written.
 */
export function writeResolvedAppIdToFusebaseJson(
  projectRoot: string,
  subdomain: string,
  appId: string,
): boolean {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) return false;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    return false;
  }
  normalizeRawFuseConfigShape(raw);
  const apps = raw.apps;
  if (!Array.isArray(apps)) return false;
  const idx = apps.findIndex(
    (a) =>
      a &&
      typeof a === "object" &&
      (a as Record<string, unknown>).subdomain === subdomain,
  );
  if (idx < 0) return false;
  const entry = apps[idx] as Record<string, unknown>;
  if (entry.id) return false;
  // `id` first to match `app create`'s key order.
  apps[idx] = { id: appId, ...entry };
  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
  return true;
}
/**
 * Persist `apps[].backendOnlyGatePermissions` in fusebase.json after a successful sync.
 * An empty `permissions` list removes the field (explicit cleanup).
 */
export function writeBackendOnlyGatePermissionsToFusebaseJson(
  projectRoot: string,
  featureId: string,
  permissions: string[],
): void {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) {
    throw new Error("fusebase.json not found.");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error("Could not parse fusebase.json");
  }
  normalizeRawFuseConfigShape(raw);
  rewriteLegacyFeaturePathsInRaw(raw, projectRoot);

  const apps = Array.isArray(raw.apps) ? [...raw.apps] : [];
  const featureIndex = getFeatureIndexById(raw, featureId);
  if (featureIndex === -1) {
    throw new Error(`App "${featureId}" not found in fusebase.json`);
  }

  const featureRaw = apps[featureIndex];
  if (!featureRaw || typeof featureRaw !== "object") {
    throw new Error(`App "${featureId}" is invalid in fusebase.json`);
  }

  const entry = { ...(featureRaw as Record<string, unknown>) };
  if (permissions.length > 0) {
    entry.backendOnlyGatePermissions = [...permissions].sort((a, b) => a.localeCompare(b));
  } else {
    // Empty result = explicit clear: remove the field entirely rather than leaving `[]`.
    delete entry.backendOnlyGatePermissions;
  }
  apps[featureIndex] = entry;
  raw.apps = apps;

  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
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
