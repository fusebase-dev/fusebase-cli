/**
 * App Environments (design: docs/proposals/APP-ENVIRONMENTS.md).
 *
 * An environment is a named profile binding the project to a platform context:
 * which backend (dev/prod platform), which org/product, resolved app ids, store
 * ids, resource ids, test fixtures. Stored in `environments/<name>.json`
 * (committed, no secrets); the matching `.env.<name>` (gitignored) carries MCP
 * tokens and secrets. The active environment is per-checkout state in
 * `.fusebase/state.json`.
 *
 * Resolution precedence for the active environment name:
 *   --env flag (via setEnvironmentOverride) > FUSEBASE_ENV >
 *   .fusebase/state.json > fusebase.json "defaultEnvironment" >
 *   single existing environment (auto-pick) > none (legacy mode).
 *
 * Legacy mode (no `environments/` dir, or the `environments` flag off) keeps
 * every pre-existing behavior: global env in ~/.fusebase/config.json, ids in
 * fusebase.json, single `.env`.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "fs";
import { join, basename } from "path";
import { hasFlag } from "./config";

export const ENVIRONMENTS_FLAG = "environments";
export const ENVIRONMENTS_DIR = "environments";
export const PROJECT_STATE_DIR = ".fusebase";
export const PROJECT_STATE_FILE = "state.json";

export type EnvironmentBackend = "dev" | "prod" | "local";

const VALID_BACKENDS: readonly EnvironmentBackend[] = ["dev", "prod", "local"];

/** Per-app resolved platform state inside an environment lockfile. */
export interface EnvironmentAppEntry {
  /** Platform-issued app id for this environment (reconcile write-back). */
  id?: string;
  /**
   * Env-effective subdomain override. Subdomains are globally unique per
   * backend, so two environments on the same backend cannot share one.
   * Wins over the environment-level `subdomainSuffix`.
   */
  subdomain?: string;
  /** Isolated store ids keyed by store alias from fusebase.json. */
  stores?: Record<string, string>;
  /** Resolved platform resource ids (dashboards, views, …) keyed by app-defined name. */
  resources?: Record<string, string>;
  [key: string]: unknown;
}

export interface EnvironmentFixtureUser {
  key: string;
  email: string;
  role?: string;
  [key: string]: unknown;
}

export interface EnvironmentFixtures {
  testUsers?: EnvironmentFixtureUser[];
  [key: string]: unknown;
}

/** Shape of `environments/<name>.json`. Committed; must never contain secrets. */
export interface EnvironmentConfig {
  /** Platform stage this environment targets. A field inside the env, not the env itself. */
  backend: EnvironmentBackend;
  orgId: string;
  /** Product id in that org; filled by reconcile when absent. */
  productId?: string;
  /** Mutating commands print a banner and require confirmation. */
  protected?: boolean;
  /** Appended to every app's default subdomain unless the app entry overrides `subdomain`. */
  subdomainSuffix?: string;
  /** Keyed by app key (fusebase.json apps[].key, defaulting to apps[].subdomain). */
  apps?: Record<string, EnvironmentAppEntry>;
  fixtures?: EnvironmentFixtures;
  [key: string]: unknown;
}

export interface ActiveEnvironment {
  name: string;
  config: EnvironmentConfig;
  /** Absolute path to environments/<name>.json. */
  filePath: string;
}

export type ActiveEnvironmentSource =
  | "override"
  | "env-var"
  | "state"
  | "default"
  | "single";

// --- feature gate -----------------------------------------------------------

let featureOverrideForTests: boolean | null = null;

/** Test-only: force the `environments` feature on/off (null restores real flag). */
export function overrideEnvironmentsFeatureForTests(
  value: boolean | null,
): void {
  featureOverrideForTests = value;
}

export function environmentsFeatureEnabled(): boolean {
  if (featureOverrideForTests !== null) return featureOverrideForTests;
  return hasFlag(ENVIRONMENTS_FLAG);
}

// --- filesystem layout ------------------------------------------------------

export function getEnvironmentsDir(projectRoot: string): string {
  return join(projectRoot, ENVIRONMENTS_DIR);
}

export function hasEnvironmentsDir(projectRoot: string): boolean {
  return existsSync(getEnvironmentsDir(projectRoot));
}

export function getEnvironmentFilePath(
  projectRoot: string,
  name: string,
): string {
  return join(getEnvironmentsDir(projectRoot), `${name}.json`);
}

/** Path to the per-environment dotenv file (`.env.<name>`, gitignored). */
export function getEnvironmentEnvFilePath(
  projectRoot: string,
  name: string,
): string {
  return join(projectRoot, `.env.${name}`);
}

const ENV_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/;

export function isValidEnvironmentName(name: string): boolean {
  return ENV_NAME_PATTERN.test(name);
}

export function listEnvironmentNames(projectRoot: string): string[] {
  const dir = getEnvironmentsDir(projectRoot);
  if (!existsSync(dir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const name = basename(entry, ".json");
    if (isValidEnvironmentName(name)) names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

// --- validation & loading ---------------------------------------------------

/** Validate a parsed environment config; returns human-readable issues (empty = valid). */
export function validateEnvironmentConfig(raw: unknown): string[] {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return ["environment file must be a JSON object"];
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.backend !== "string") {
    issues.push(`"backend" is required (one of: ${VALID_BACKENDS.join(", ")})`);
  } else if (!VALID_BACKENDS.includes(o.backend as EnvironmentBackend)) {
    issues.push(
      `"backend" must be one of: ${VALID_BACKENDS.join(", ")} (got "${o.backend}")`,
    );
  }
  if (typeof o.orgId !== "string" || o.orgId.length === 0) {
    issues.push(`"orgId" is required`);
  }
  if (o.productId !== undefined && typeof o.productId !== "string") {
    issues.push(`"productId" must be a string when present`);
  }
  if (o.protected !== undefined && typeof o.protected !== "boolean") {
    issues.push(`"protected" must be a boolean when present`);
  }
  if (
    o.subdomainSuffix !== undefined &&
    typeof o.subdomainSuffix !== "string"
  ) {
    issues.push(`"subdomainSuffix" must be a string when present`);
  }
  if (o.apps !== undefined) {
    if (!o.apps || typeof o.apps !== "object" || Array.isArray(o.apps)) {
      issues.push(`"apps" must be an object keyed by app key`);
    } else {
      for (const [key, entry] of Object.entries(
        o.apps as Record<string, unknown>,
      )) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          issues.push(`"apps.${key}" must be an object`);
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (e.id !== undefined && typeof e.id !== "string") {
          issues.push(`"apps.${key}.id" must be a string when present`);
        }
        if (e.subdomain !== undefined && typeof e.subdomain !== "string") {
          issues.push(`"apps.${key}.subdomain" must be a string when present`);
        }
      }
    }
  }
  return issues;
}

/**
 * Load and validate `environments/<name>.json`.
 * @throws with a guiding message when the file is missing or invalid.
 */
export function loadEnvironmentConfig(
  projectRoot: string,
  name: string,
): EnvironmentConfig {
  const filePath = getEnvironmentFilePath(projectRoot, name);
  if (!existsSync(filePath)) {
    const available = listEnvironmentNames(projectRoot);
    const hint =
      available.length > 0
        ? `Available environments: ${available.join(", ")}.`
        : `No environments defined yet — run \`fusebase env init\` to adopt environments in this project.`;
    throw new Error(`Environment "${name}" not found (${filePath}). ${hint}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    throw new Error(`Could not parse ${filePath} — invalid JSON.`);
  }
  const issues = validateEnvironmentConfig(raw);
  if (issues.length > 0) {
    throw new Error(
      `Invalid environment "${name}" (${filePath}):\n` +
        issues.map((i) => `  - ${i}`).join("\n"),
    );
  }
  return raw as EnvironmentConfig;
}

/** Persist an environment config with stable formatting. */
export function writeEnvironmentConfig(
  projectRoot: string,
  name: string,
  config: EnvironmentConfig,
): string {
  const dir = getEnvironmentsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const filePath = getEnvironmentFilePath(projectRoot, name);
  writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  invalidateActiveEnvironmentCache();
  return filePath;
}

// --- per-checkout state (.fusebase/state.json) ------------------------------

interface ProjectState {
  activeEnvironment?: string;
  [key: string]: unknown;
}

function getStateFilePath(projectRoot: string): string {
  return join(projectRoot, PROJECT_STATE_DIR, PROJECT_STATE_FILE);
}

function readProjectState(projectRoot: string): ProjectState {
  const path = getStateFilePath(projectRoot);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as ProjectState) : {};
  } catch {
    return {};
  }
}

export function readActiveEnvironmentState(
  projectRoot: string,
): string | undefined {
  const value = readProjectState(projectRoot).activeEnvironment;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function writeActiveEnvironmentState(
  projectRoot: string,
  name: string,
): void {
  const state = { ...readProjectState(projectRoot), activeEnvironment: name };
  mkdirSync(join(projectRoot, PROJECT_STATE_DIR), { recursive: true });
  writeFileSync(
    getStateFilePath(projectRoot),
    JSON.stringify(state, null, 2) + "\n",
    "utf-8",
  );
  invalidateActiveEnvironmentCache();
}

/** Drop the active-environment selection (used when the active env is removed). */
export function clearActiveEnvironmentState(projectRoot: string): void {
  const state = { ...readProjectState(projectRoot) };
  if (state.activeEnvironment === undefined) return;
  delete state.activeEnvironment;
  mkdirSync(join(projectRoot, PROJECT_STATE_DIR), { recursive: true });
  writeFileSync(
    getStateFilePath(projectRoot),
    JSON.stringify(state, null, 2) + "\n",
    "utf-8",
  );
  invalidateActiveEnvironmentCache();
}

// --- gitignore hygiene ------------------------------------------------------

/**
 * Entries the env layer requires in the project .gitignore: per-env dotenv
 * files carry secrets, `.fusebase/` is per-checkout state. The baseline
 * template ignores only `.env` and a few fixed variants — not `.env.<name>`.
 */
const ENV_GITIGNORE_ENTRIES = [".env.*", `${PROJECT_STATE_DIR}/`] as const;

/** Append missing env-layer entries to .gitignore (creates the file if absent). */
export function ensureEnvGitignoreEntries(projectRoot: string): string[] {
  const gitignorePath = join(projectRoot, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const lines = new Set(
    existing
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const missing = ENV_GITIGNORE_ENTRIES.filter((e) => !lines.has(e));
  if (missing.length === 0) return [];
  const block =
    (existing.length > 0 && !existing.endsWith("\n") ? "\n" : "") +
    (existing.length > 0 ? "\n# Fusebase environments\n" : "# Fusebase environments\n") +
    missing.join("\n") +
    "\n";
  if (existsSync(gitignorePath)) {
    appendFileSync(gitignorePath, block, "utf-8");
  } else {
    writeFileSync(gitignorePath, block, "utf-8");
  }
  return [...missing];
}

// --- active environment resolution ------------------------------------------

let environmentOverride: string | undefined;
let activeEnvCache: { key: string; value: ActiveEnvironment | null } | null =
  null;
let noSelectionWarningPrinted = false;
let flagOffHintPrinted = false;

/**
 * Set the per-command environment override (from a `--env <name>` option).
 * Call early in a command action; wins over every other source.
 */
export function setEnvironmentOverride(name: string | undefined): void {
  environmentOverride = name;
  invalidateActiveEnvironmentCache();
}

export function invalidateActiveEnvironmentCache(): void {
  activeEnvCache = null;
}

/** Test-only: reset override, cache, and one-time warning state. */
export function resetEnvironmentsStateForTests(): void {
  environmentOverride = undefined;
  activeEnvCache = null;
  noSelectionWarningPrinted = false;
  flagOffHintPrinted = false;
  featureOverrideForTests = null;
}

function readDefaultEnvironmentFromFusebaseJson(
  projectRoot: string,
): string | undefined {
  const path = join(projectRoot, "fusebase.json");
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<
      string,
      unknown
    >;
    const value = raw.defaultEnvironment;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the active environment name without loading its config.
 * Returns null when no environment is selected (legacy mode candidates).
 * @throws never — existence/validity is checked by getActiveEnvironment.
 */
export function resolveActiveEnvironmentName(
  projectRoot: string,
): { name: string; source: ActiveEnvironmentSource } | null {
  if (environmentOverride) {
    return { name: environmentOverride, source: "override" };
  }
  const fromEnvVar = process.env.FUSEBASE_ENV;
  if (fromEnvVar && fromEnvVar.length > 0) {
    return { name: fromEnvVar, source: "env-var" };
  }
  const fromState = readActiveEnvironmentState(projectRoot);
  if (fromState) {
    return { name: fromState, source: "state" };
  }
  const fromDefault = readDefaultEnvironmentFromFusebaseJson(projectRoot);
  if (fromDefault) {
    return { name: fromDefault, source: "default" };
  }
  const names = listEnvironmentNames(projectRoot);
  if (names.length === 1) {
    return { name: names[0]!, source: "single" };
  }
  return null;
}

/**
 * Resolve and load the active environment for a project.
 *
 * Returns null (= legacy mode) when the feature flag is off, `environments/`
 * does not exist, or nothing selects an environment (with a one-time warning
 * in the ambiguous multiple-envs case). Explicitly selected names
 * (--env / FUSEBASE_ENV / state / defaultEnvironment) that are missing or
 * invalid throw with guidance — a wrong explicit selection must never fall
 * back silently to a different backend.
 */
export function getActiveEnvironment(
  projectRoot: string = process.cwd(),
): ActiveEnvironment | null {
  if (!hasEnvironmentsDir(projectRoot)) {
    return null;
  }
  if (!environmentsFeatureEnabled()) {
    if (!flagOffHintPrinted) {
      flagOffHintPrinted = true;
      console.warn(
        `fusebase: this project has an ${ENVIRONMENTS_DIR}/ directory, but the "${ENVIRONMENTS_FLAG}" flag is off — using legacy single-env behavior. Enable with: fusebase config set-flag ${ENVIRONMENTS_FLAG}`,
      );
    }
    return null;
  }

  const resolved = resolveActiveEnvironmentName(projectRoot);
  if (!resolved) {
    const names = listEnvironmentNames(projectRoot);
    if (names.length > 1 && !noSelectionWarningPrinted) {
      noSelectionWarningPrinted = true;
      console.warn(
        `fusebase: no active environment selected (available: ${names.join(", ")}) — using legacy env resolution. Select one with: fusebase env use <name>`,
      );
    }
    return null;
  }

  const cacheKey = `${projectRoot}${resolved.name}`;
  if (activeEnvCache && activeEnvCache.key === cacheKey) {
    return activeEnvCache.value;
  }

  const config = loadEnvironmentConfig(projectRoot, resolved.name);
  const value: ActiveEnvironment = {
    name: resolved.name,
    config,
    filePath: getEnvironmentFilePath(projectRoot, resolved.name),
  };
  activeEnvCache = { key: cacheKey, value };
  return value;
}

/**
 * Like getActiveEnvironment, but throws when no environment is active.
 * For commands that require an environment context (deploy --env, env status, …).
 */
export function requireActiveEnvironment(
  projectRoot: string = process.cwd(),
): ActiveEnvironment {
  const active = getActiveEnvironment(projectRoot);
  if (!active) {
    const names = listEnvironmentNames(projectRoot);
    const hint =
      names.length > 0
        ? `Select one with \`fusebase env use <name>\` or pass --env <name> (available: ${names.join(", ")}).`
        : `Run \`fusebase env init\` to adopt environments in this project.`;
    throw new Error(`No active environment. ${hint}`);
  }
  return active;
}

/**
 * Active environment's backend for host/base-URL resolution, or undefined in
 * legacy mode. The implicit no-selection case returns undefined; an explicit
 * invalid selection propagates the load error (fail loud rather than silently
 * target a wrong backend via the legacy fallback).
 */
export function getActiveEnvironmentBackend(): string | undefined {
  return getActiveEnvironment()?.config.backend;
}

// --- derived values -----------------------------------------------------------

/**
 * Stable cross-environment key for a fusebase.json app entry: explicit `key`
 * > `subdomain` > `id` > basename of `path`. This key indexes
 * `environments/<name>.json` `apps{}`.
 */
export function environmentAppKey(app: {
  key?: string;
  subdomain?: string;
  id?: string;
  path?: string;
}): string | undefined {
  return (
    app.key ??
    app.subdomain ??
    app.id ??
    (app.path ? basename(app.path) : undefined)
  );
}

/** Reconcile write-back for one app into `environments/<name>.json` (NIM-41875, env mode). */
export function writeEnvironmentAppResolution(
  projectRoot: string,
  envName: string,
  appKey: string,
  resolution: { id?: string; subdomain?: string },
): void {
  const config = loadEnvironmentConfig(projectRoot, envName);
  const apps = { ...(config.apps ?? {}) };
  const entry: EnvironmentAppEntry = { ...(apps[appKey] ?? {}) };
  if (resolution.id) entry.id = resolution.id;
  if (resolution.subdomain) entry.subdomain = resolution.subdomain;
  apps[appKey] = entry;
  writeEnvironmentConfig(projectRoot, envName, { ...config, apps });
}

/** Persist a reconcile-created productId into `environments/<name>.json`. */
export function writeEnvironmentProductId(
  projectRoot: string,
  envName: string,
  productId: string,
): void {
  const config = loadEnvironmentConfig(projectRoot, envName);
  writeEnvironmentConfig(projectRoot, envName, { ...config, productId });
}

/**
 * Materialize the active environment's dotenv into `.env`.
 *
 * `.env` stays the single file every existing consumer reads (IDE MCP configs,
 * dev server, app backends); with environments enabled it is a generated copy
 * of `.env.<active>` refreshed by `fusebase env use` / `env tokens`. Returns
 * false when `.env.<name>` does not exist.
 */
export function materializeActiveEnvFile(
  projectRoot: string,
  name: string,
): boolean {
  const source = getEnvironmentEnvFilePath(projectRoot, name);
  if (!existsSync(source)) return false;
  const content = readFileSync(source, "utf-8");
  const header = `# Generated from .env.${name} by \`fusebase env\` — edit .env.${name}, not this file.\n`;
  writeFileSync(join(projectRoot, ".env"), header + content, "utf-8");
  return true;
}

// --- env-info injection (docs/proposals/APP-ENVIRONMENTS.md §10) -------------

/** A sibling deployment of the same app in another environment. */
export interface EnvInfoCounterpart {
  env: string;
  backend: string;
  url: string;
  protected: boolean;
  sameOrg: boolean;
}

/**
 * Payload baked into the app bundle as `fusebase-env.json` at deploy. Read by
 * the in-app env panel (staff/debug surface) and by test runners asserting
 * they target the intended stage. Deterministic on purpose — no timestamps —
 * so it never churns deploy hashes.
 */
export interface EnvInfoPayload {
  env: string;
  protected: boolean;
  backend: string;
  orgId: string;
  productId?: string;
  appKey: string;
  appId?: string;
  subdomain?: string;
  url?: string;
  counterparts: EnvInfoCounterpart[];
}

/**
 * Build the env-info payload for one app. Counterpart subdomains derive from
 * the RAW fusebase.json default (not the active overlay) so each environment's
 * own override/suffix applies. `appHostForBackend` is injected to avoid a
 * config.ts import cycle at module scope.
 */
export function buildEnvInfoPayload(params: {
  projectRoot: string;
  active: ActiveEnvironment;
  appKey: string;
  appId?: string;
  effectiveSubdomain?: string;
  appHostForBackend: (backend: string) => string;
}): EnvInfoPayload {
  const { projectRoot, active, appKey, appId, appHostForBackend } = params;

  // Raw manifest default subdomain for this app (pre-overlay).
  let rawDefaultSubdomain: string | undefined;
  try {
    const raw = JSON.parse(
      readFileSync(join(projectRoot, "fusebase.json"), "utf-8"),
    ) as { apps?: Array<Record<string, unknown>> };
    const entry = (raw.apps ?? []).find(
      (a) => environmentAppKey(a as { key?: string }) === appKey,
    );
    rawDefaultSubdomain =
      typeof entry?.subdomain === "string" ? entry.subdomain : undefined;
  } catch {
    // No raw manifest — counterpart URLs fall back to explicit env subdomains.
  }

  const counterparts: EnvInfoCounterpart[] = [];
  for (const name of listEnvironmentNames(projectRoot)) {
    if (name === active.name) continue;
    let config: EnvironmentConfig;
    try {
      config = loadEnvironmentConfig(projectRoot, name);
    } catch {
      continue;
    }
    const sub =
      config.apps?.[appKey]?.subdomain ??
      (rawDefaultSubdomain
        ? effectiveSubdomain(config, appKey, rawDefaultSubdomain)
        : undefined);
    if (!sub) continue;
    counterparts.push({
      env: name,
      backend: config.backend,
      url: `https://${sub}.${appHostForBackend(config.backend)}/`,
      protected: config.protected === true,
      sameOrg:
        config.orgId === active.config.orgId &&
        config.backend === active.config.backend,
    });
  }

  const sub = params.effectiveSubdomain;
  return {
    env: active.name,
    protected: active.config.protected === true,
    backend: active.config.backend,
    orgId: active.config.orgId,
    ...(active.config.productId ? { productId: active.config.productId } : {}),
    appKey,
    ...(appId ? { appId } : {}),
    ...(sub ? { subdomain: sub } : {}),
    ...(sub
      ? { url: `https://${sub}.${appHostForBackend(active.config.backend)}/` }
      : {}),
    counterparts,
  };
}

/**
 * Inject the env-info payload into an index.html as a synchronous global
 * (`window.__FUSEBASE_ENV__`) so app code can read the runtime context
 * (backend/orgId/appId) BEFORE any fetch resolves — eliminates the race where
 * a stale build-time constant is used until `fusebase-env.json` loads.
 * Idempotent: an existing injected block is replaced. Returns the new HTML,
 * or null when no <head> insertion point is found.
 */
export function injectEnvInfoIntoIndexHtml(
  html: string,
  payload: EnvInfoPayload,
): string | null {
  const MARKER_START = "<!--fusebase-env-->";
  const MARKER_END = "<!--/fusebase-env-->";
  const block = `${MARKER_START}<script>window.__FUSEBASE_ENV__=${JSON.stringify(
    payload,
  ).replace(/</g, "\\u003c")};</script>${MARKER_END}`;

  const existingStart = html.indexOf(MARKER_START);
  if (existingStart !== -1) {
    const existingEnd = html.indexOf(MARKER_END, existingStart);
    if (existingEnd !== -1) {
      return (
        html.slice(0, existingStart) +
        block +
        html.slice(existingEnd + MARKER_END.length)
      );
    }
  }

  const headMatch = /<head[^>]*>/i.exec(html);
  if (!headMatch) return null;
  const insertAt = headMatch.index + headMatch[0].length;
  return html.slice(0, insertAt) + "\n" + block + html.slice(insertAt);
}

/**
 * Env-effective subdomain for an app: explicit per-app override in the env
 * file > default subdomain + env subdomainSuffix > default subdomain.
 */
export function effectiveSubdomain(
  config: EnvironmentConfig,
  appKey: string,
  defaultSubdomain: string,
): string {
  const entry = config.apps?.[appKey];
  if (entry?.subdomain) return entry.subdomain;
  if (config.subdomainSuffix) return `${defaultSubdomain}${config.subdomainSuffix}`;
  return defaultSubdomain;
}
