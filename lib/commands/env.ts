/**
 * Env commands.
 *
 * Legacy: `env create` — create/update `.env` with MCP tokens.
 *
 * App environments (flag `environments`, design docs/proposals/APP-ENVIRONMENTS.md):
 * `env init|add|clone|use|list|status|tokens` manage named environment
 * profiles in `environments/<name>.json` with per-env dotenv files
 * (`.env.<name>`). The active env's dotenv is materialized into `.env` so
 * existing consumers (IDE MCP configs, dev server, app code) keep working.
 */

import { Command } from "commander";
import { readFile, access } from "fs/promises";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { createEnvFile, printCreateEnvResult, readEnvFileMap, areMcpEnvTokensPresent } from "./steps/create-env";
import { confirm, input, select } from "@inquirer/prompts";
import {
  printIdeSetupResults,
  setupIdeConfig,
  type IdePreset,
} from "./steps/ide-setup";
import {
  getConfig,
  getRawConfig,
  getEnv,
  hasFlag,
  normalizeRawFuseConfigShape,
  rewriteLegacyFeaturePathsInRaw,
  invalidateFuseConfigCache,
  setProcessEnvOverride,
} from "../config";
import { fetchOrgs, type Organization } from "../api";
import {
  ENVIRONMENTS_FLAG,
  environmentsFeatureEnabled,
  ensureEnvGitignoreEntries,
  getActiveEnvironment,
  getEnvironmentEnvFilePath,
  getEnvironmentFilePath,
  hasEnvironmentsDir,
  isValidEnvironmentName,
  listEnvironmentNames,
  loadEnvironmentConfig,
  materializeActiveEnvFile,
  readActiveEnvironmentState,
  clearActiveEnvironmentState,
  resolveActiveEnvironmentName,
  setEnvironmentOverride,
  writeActiveEnvironmentState,
  writeEnvironmentAppResolution,
  writeEnvironmentConfig,
  type ActiveEnvironment,
  type EnvironmentAppEntry,
  type EnvironmentBackend,
  type EnvironmentConfig,
} from "../environments";
import {
  DASHBOARDS_MCP_POLICY_FP_KEY,
  GATE_MCP_POLICY_FP_KEY,
  matchesCurrentOrLegacyFallback,
} from "../mcp-token-policy";
import { runAuthFlow } from "./steps/auth-flow";

const FUSE_JSON = "fusebase.json";

interface FuseAppEntry {
  id?: string;
  key?: string;
  subdomain?: string;
  path?: string;
  isolatedStores?: {
    sql?: Array<{ alias?: string; storeId?: string }>;
  };
}

interface FuseConfig {
  orgId?: string;
  productId?: string;
  apps?: FuseAppEntry[];
}

const ALL_IDE_PRESETS: IdePreset[] = ["claude-code", "cursor", "vscode", "opencode", "codex", "other"];

const VALID_BACKENDS: EnvironmentBackend[] = ["dev", "prod", "local"];

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadFuseConfig(cwd: string): Promise<FuseConfig> {
  const fuseJsonPath = join(cwd, FUSE_JSON);
  try {
    const data = await readFile(fuseJsonPath, "utf-8");
    const raw = JSON.parse(data) as Record<string, unknown>;
    normalizeRawFuseConfigShape(raw);
    rewriteLegacyFeaturePathsInRaw(raw, cwd);
    return raw as FuseConfig;
  } catch {
    return {};
  }
}

function requireEnvironmentsFlag(): void {
  if (environmentsFeatureEnabled()) return;
  console.error(
    `Error: app environments are experimental. Enable them first with:\n  fusebase config set-flag ${ENVIRONMENTS_FLAG}`,
  );
  process.exit(1);
}

function isTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Stable key an app is tracked under across environments. */
function appKeyOf(app: FuseAppEntry): string | undefined {
  return (
    app.key ??
    app.subdomain ??
    app.id ??
    (app.path ? basename(app.path) : undefined)
  );
}

type BackendAuthState = "ok" | "legacy" | "missing";

/** Whether ~/.fusebase has a key bound to this backend, only the legacy key, or nothing. */
function backendAuthState(backend: string): BackendAuthState {
  const raw = getRawConfig();
  if (raw.auth?.[backend]?.apiKey) return "ok";
  if (process.env.FUSEBASE_API_KEY) return "ok";
  if (raw.apiKey) return "legacy";
  return "missing";
}

function printProtectedBanner(env: ActiveEnvironment): void {
  if (!env.config.protected) return;
  console.log(
    `\n  ⚠ PROTECTED environment "${env.name}" (backend: ${env.config.backend}, org: ${env.config.orgId}) — mutating commands will ask for confirmation.\n`,
  );
}

// --- token flow (shared by legacy `env create` and `env tokens`) ------------

async function offerIdeRefresh(cwd: string): Promise<void> {
  if (!isTty()) return;
  let shouldRunIdeRefresh = false;
  try {
    shouldRunIdeRefresh = await confirm({
      message: "Tokens updated. Update MCP configs for all IDEs now? (runs `fusebase config ide --force`)",
      default: true,
    });
  } catch {
    // Prompt can be interrupted; treat as refusal and show manual step.
    shouldRunIdeRefresh = false;
  }

  if (!shouldRunIdeRefresh) {
    console.log("Next step: run `fusebase config ide --force` to refresh MCP tokens in all IDE MCP configs.");
    return;
  }

  const presets = new Set<IdePreset>(ALL_IDE_PRESETS);
  const ideResult = await setupIdeConfig({
    targetDir: cwd,
    presets,
    force: true,
  });
  printIdeSetupResults(ideResult, presets);
}

/**
 * Write MCP tokens for a named environment into `.env.<name>`; when that env
 * is the active one, also materialize `.env`.
 */
async function runTokensForEnvironment(
  env: ActiveEnvironment,
  force: boolean,
): Promise<void> {
  const cwd = process.cwd();
  const { config } = env;

  // Only the env lockfile counts — falling back to fusebase.json productId
  // would borrow another environment's product (wrong org/backend).
  const productId = config.productId;
  if (!productId) {
    console.error(
      `Error: environment "${env.name}" has no productId yet. Run \`fusebase deploy --env ${env.name}\` (reconcile creates the product) or add "productId" to ${env.filePath}.`,
    );
    process.exit(1);
  }

  // Effective key for this env's backend (auth map / FUSEBASE_API_KEY / legacy).
  const apiKey = getConfig().apiKey;
  if (!apiKey) {
    const authHint = config.backend === "dev" ? "fusebase auth --dev" : "fusebase auth";
    console.error(`Error: no API key for backend "${config.backend}". Run '${authHint}' first.`);
    process.exit(1);
  }

  const result = await createEnvFile({
    targetDir: cwd,
    apiKey,
    orgId: config.orgId,
    appId: productId,
    force,
    envFileName: `.env.${env.name}`,
  });

  printCreateEnvResult(result);
  if (result.error) {
    process.exit(1);
  }

  ensureEnvGitignoreEntries(cwd);

  const activeName = resolveActiveEnvironmentName(cwd)?.name;
  if (activeName === env.name && materializeActiveEnvFile(cwd, env.name)) {
    console.log(`✓ Materialized .env from .env.${env.name}`);
  }

  if (result.created || result.updated) {
    await offerIdeRefresh(cwd);
  }
}

export async function runEnvCreate(force: boolean = true): Promise<void> {
  const cwd = process.cwd();
  const fuseJsonPath = join(cwd, FUSE_JSON);

  if (!(await fileExists(fuseJsonPath))) {
    console.error("Error: fusebase.json not found. Run 'fusebase init' first.");
    process.exit(1);
  }

  // With an active environment, `env create` is an alias for `env tokens`.
  const active = getActiveEnvironment(cwd);
  if (active) {
    await runTokensForEnvironment(active, force);
    return;
  }

  const fuseConfig = await loadFuseConfig(cwd);
  if (!fuseConfig.orgId) {
    console.error("Error: orgId not found in fusebase.json.");
    process.exit(1);
  }
  if (!fuseConfig.productId) {
    console.error("Error: productId not found in fusebase.json.");
    process.exit(1);
  }

  // getConfig() resolves the effective apiKey for the current backend
  // (auth.<backend> map with legacy fallback).
  const config = getConfig();
  if (!config.apiKey) {
    console.error("Error: No API key configured. Run 'fusebase auth' first.");
    process.exit(1);
  }

  const result = await createEnvFile({
    targetDir: cwd,
    apiKey: config.apiKey,
    orgId: fuseConfig.orgId,
    appId: fuseConfig.productId,
    force,
  });

  printCreateEnvResult(result);

  if (result.error) {
    process.exit(1);
  }

  if (result.created || result.updated) {
    await offerIdeRefresh(cwd);
  }
}

// --- env init ----------------------------------------------------------------

interface EnvInitOptions {
  name?: string;
  strip?: boolean;
}

async function runEnvInit(options: EnvInitOptions): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();

  if (!(await fileExists(join(cwd, FUSE_JSON)))) {
    console.error("Error: fusebase.json not found. Run 'fusebase init' first.");
    process.exit(1);
  }
  if (hasEnvironmentsDir(cwd)) {
    console.error(
      `Error: ${join(cwd, "environments")} already exists. Use \`fusebase env add <name>\` to add another environment.`,
    );
    process.exit(1);
  }

  const fuseConfig = await loadFuseConfig(cwd);
  if (!fuseConfig.orgId) {
    console.error("Error: orgId not found in fusebase.json.");
    process.exit(1);
  }

  // Compute the backend BEFORE creating environments/ (afterwards the active
  // environment would drive getEnv()).
  const legacyEnv = getEnv() ?? "prod";
  const backend = (VALID_BACKENDS as string[]).includes(legacyEnv)
    ? (legacyEnv as EnvironmentBackend)
    : "prod";

  const name = options.name ?? backend;
  if (!isValidEnvironmentName(name)) {
    console.error(
      `Error: invalid environment name "${name}" (lowercase letters, digits, "-", "_").`,
    );
    process.exit(1);
  }

  // Adopt the current fusebase.json context as the first environment.
  const apps: Record<string, EnvironmentAppEntry> = {};
  for (const app of fuseConfig.apps ?? []) {
    const key = appKeyOf(app);
    if (!key) continue;
    const entry: EnvironmentAppEntry = {};
    if (app.id) entry.id = app.id;
    const stores: Record<string, string> = {};
    for (const store of app.isolatedStores?.sql ?? []) {
      if (store.alias && store.storeId) stores[store.alias] = store.storeId;
    }
    if (Object.keys(stores).length > 0) entry.stores = stores;
    apps[key] = entry;
  }

  const envConfig: EnvironmentConfig = {
    backend,
    orgId: fuseConfig.orgId,
    ...(fuseConfig.productId ? { productId: fuseConfig.productId } : {}),
    ...(Object.keys(apps).length > 0 ? { apps } : {}),
  };

  const filePath = writeEnvironmentConfig(cwd, name, envConfig);
  console.log(`✓ Created ${filePath} (backend: ${backend}, org: ${fuseConfig.orgId})`);

  // Current .env (if any) becomes this environment's dotenv; keep `.env`
  // itself as the materialized copy for existing consumers.
  const legacyDotenv = join(cwd, ".env");
  if (existsSync(legacyDotenv)) {
    const content = readFileSync(legacyDotenv, "utf-8");
    writeFileSync(getEnvironmentEnvFilePath(cwd, name), content, "utf-8");
    console.log(`✓ Copied .env → .env.${name}`);
  }

  writeActiveEnvironmentState(cwd, name);
  if (existsSync(getEnvironmentEnvFilePath(cwd, name))) {
    materializeActiveEnvFile(cwd, name);
  }
  const addedIgnores = ensureEnvGitignoreEntries(cwd);
  if (addedIgnores.length > 0) {
    console.log(`✓ Added to .gitignore: ${addedIgnores.join(", ")}`);
  }
  console.log(`✓ Active environment: ${name}`);

  if (options.strip) {
    stripEnvSpecificIdsFromFusebaseJson(cwd);
    console.log(
      "✓ Stripped apps[].id and isolated store storeId values from fusebase.json (now owned by the environment lockfile)",
    );
  } else {
    console.log(
      "Note: ids left in fusebase.json are harmless — the environment file wins. Re-run with --strip for a clean manifest.",
    );
  }

  console.log(
    `\nNext: add another environment with \`fusebase env add <name> --backend <dev|prod> --org <orgId>\` and switch with \`fusebase env use <name>\`.`,
  );
}

function stripEnvSpecificIdsFromFusebaseJson(projectRoot: string): void {
  const fuseJsonPath = join(projectRoot, FUSE_JSON);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    console.warn("Warning: could not parse fusebase.json; skipping --strip.");
    return;
  }
  normalizeRawFuseConfigShape(raw);
  if (!Array.isArray(raw.apps)) return;
  for (const app of raw.apps) {
    if (!app || typeof app !== "object") continue;
    const a = app as Record<string, unknown>;
    // Preserve a stable cross-env key before dropping the env-specific id.
    if (!a.key && !a.subdomain && typeof a.id === "string") {
      a.key = a.id;
    }
    delete a.id;
    const stores = (a.isolatedStores as { sql?: Array<Record<string, unknown>> } | undefined)?.sql;
    for (const store of stores ?? []) {
      delete store.storeId;
    }
  }
  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
}

// --- env add / clone ----------------------------------------------------------

interface EnvAddOptions {
  backend?: string;
  org?: string;
  product?: string;
  subdomainSuffix?: string;
  protected?: boolean;
}

/**
 * Interactive fallback for `env add`: any parameter not passed as an option is
 * prompted in a TTY — backend as a select, org from the live org list of that
 * backend (with a manual-id fallback when the API is unreachable), then name,
 * optional subdomain suffix, and the protected marker. Non-TTY keeps the
 * strict flags contract.
 */
async function runEnvAdd(
  name: string | undefined,
  options: EnvAddOptions,
): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();
  const interactive = isTty();

  if (!interactive && (!name || !options.backend || !options.org)) {
    const missing = [
      ...(name ? [] : ["<name>"]),
      ...(options.backend ? [] : ["--backend"]),
      ...(options.org ? [] : ["--org"]),
    ];
    console.error(
      `Error: missing ${missing.join(", ")}. In a terminal, run \`fusebase env add\` with no arguments for interactive setup.`,
    );
    process.exit(1);
  }

  // Backend. The dev/prod choice is internal-only: customers always target
  // the prod platform, so the prompt is hidden behind the `dev-backend` flag
  // (explicit --backend keeps working regardless). `local` never appears in
  // the prompt — flag-only.
  let backend = options.backend;
  if (backend === undefined && interactive) {
    if (hasFlag("dev-backend")) {
      backend = await select({
        message: "Platform backend for the new environment:",
        choices: [
          { name: "prod (thefusebase.com)", value: "prod" },
          { name: "dev (dev-thefusebase.com)", value: "dev" },
        ],
      });
    } else {
      backend = "prod";
    }
  }
  if (!backend || !(VALID_BACKENDS as string[]).includes(backend)) {
    console.error(`Error: --backend must be one of: ${VALID_BACKENDS.join(", ")}.`);
    process.exit(1);
  }

  // Org: from options, or selected from the live org list of that backend.
  let orgId = options.org;
  if (orgId === undefined && interactive) {
    // Resolve API/base URL against the chosen backend for the org listing.
    setProcessEnvOverride(backend);
    if (backendAuthState(backend) === "missing") {
      const runAuth = await confirm({
        message: `No API key for backend "${backend}". Authenticate now? (opens browser)`,
        default: true,
      });
      if (runAuth) {
        await runAuthFlow(backend === "dev");
      }
    }
    const apiKey = getConfig().apiKey;
    let orgs: Organization[] = [];
    if (apiKey) {
      try {
        orgs = (await fetchOrgs(apiKey)).organizations;
      } catch {
        console.warn(`Warning: could not list organizations on "${backend}".`);
      }
    }
    if (orgs.length > 0) {
      orgId = await select({
        message: `Organization in "${backend}":`,
        choices: orgs.map((o) => ({ name: `${o.title} (${o.id})`, value: o.id })),
      });
    } else {
      orgId = (
        await input({
          message: `Organization id in "${backend}":`,
          validate: (v) => (v.trim().length > 0 ? true : "orgId is required"),
        })
      ).trim();
    }
  }
  if (!orgId) {
    console.error("Error: --org is required.");
    process.exit(1);
  }

  // Name.
  let envName = name;
  if (envName === undefined && interactive) {
    const taken = new Set(listEnvironmentNames(cwd));
    const suggested = taken.has(backend) ? `${backend}-2` : backend;
    envName = (
      await input({
        message: "Environment name:",
        default: suggested,
        validate: (v) => {
          if (!isValidEnvironmentName(v)) {
            return 'lowercase letters, digits, "-", "_" (must start with a letter or digit)';
          }
          if (taken.has(v)) return `environment "${v}" already exists`;
          return true;
        },
      })
    ).trim();
  }
  if (!envName || !isValidEnvironmentName(envName)) {
    console.error(`Error: invalid environment name "${envName ?? ""}".`);
    process.exit(1);
  }
  if (existsSync(getEnvironmentFilePath(cwd, envName))) {
    console.error(`Error: environment "${envName}" already exists.`);
    process.exit(1);
  }

  // Subdomain suffix — essential when another env already targets the same
  // backend (subdomains are globally unique per backend).
  let subdomainSuffix = options.subdomainSuffix;
  if (subdomainSuffix === undefined && interactive) {
    const sameBackendEnv = listEnvironmentNames(cwd).some((n) => {
      try {
        return loadEnvironmentConfig(cwd, n).backend === backend;
      } catch {
        return false;
      }
    });
    const entered = await input({
      message: `Subdomain suffix for this environment (e.g. "-${envName}"; empty for none)${
        sameBackendEnv
          ? " — another environment already targets this backend, a suffix avoids subdomain collisions"
          : ""
      }:`,
      default: sameBackendEnv ? `-${envName}` : "",
    });
    subdomainSuffix = entered.trim() || undefined;
  }

  let isProtected = options.protected;
  if (isProtected === undefined && interactive) {
    isProtected = await confirm({
      message: "Mark as protected? (mutating commands will ask for confirmation)",
      default: false,
    });
  }

  const envConfig: EnvironmentConfig = {
    backend: backend as EnvironmentBackend,
    orgId,
    ...(options.product ? { productId: options.product } : {}),
    ...(subdomainSuffix ? { subdomainSuffix } : {}),
    ...(isProtected ? { protected: true } : {}),
  };

  const filePath = writeEnvironmentConfig(cwd, envName, envConfig);
  ensureEnvGitignoreEntries(cwd);
  console.log(`✓ Created ${filePath}`);
  console.log(
    `Next: \`fusebase env use ${envName}\` to activate, then \`fusebase deploy --env ${envName}\` to bind/create apps in org ${orgId}.`,
  );
}

interface EnvCloneOptions {
  org?: string;
  backend?: string;
  subdomainSuffix?: string;
}

async function runEnvClone(
  from: string,
  to: string,
  options: EnvCloneOptions,
): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();

  if (!isValidEnvironmentName(to)) {
    console.error(`Error: invalid environment name "${to}".`);
    process.exit(1);
  }
  if (existsSync(getEnvironmentFilePath(cwd, to))) {
    console.error(`Error: environment "${to}" already exists.`);
    process.exit(1);
  }
  const source = loadEnvironmentConfig(cwd, from);
  if (options.backend && !(VALID_BACKENDS as string[]).includes(options.backend)) {
    console.error(`Error: --backend must be one of: ${VALID_BACKENDS.join(", ")}.`);
    process.exit(1);
  }

  // Copy the structure; clear platform-resolved state (ids, stores,
  // resources, per-env subdomains) — the new env resolves its own at deploy.
  const apps: Record<string, EnvironmentAppEntry> = {};
  for (const key of Object.keys(source.apps ?? {})) {
    apps[key] = {};
  }

  const envConfig: EnvironmentConfig = {
    backend: (options.backend as EnvironmentBackend) ?? source.backend,
    orgId: options.org ?? source.orgId,
    ...(options.subdomainSuffix ? { subdomainSuffix: options.subdomainSuffix } : {}),
    ...(Object.keys(apps).length > 0 ? { apps } : {}),
    ...(source.fixtures ? { fixtures: source.fixtures } : {}),
  };

  if (
    envConfig.backend === source.backend &&
    envConfig.orgId === source.orgId &&
    !envConfig.subdomainSuffix
  ) {
    console.warn(
      `Warning: "${to}" targets the same backend and org as "${from}" — apps will collide on subdomains unless you set --subdomain-suffix or per-app subdomains.`,
    );
  }

  const filePath = writeEnvironmentConfig(cwd, to, envConfig);
  ensureEnvGitignoreEntries(cwd);
  console.log(`✓ Created ${filePath} (cloned from "${from}", ids cleared)`);
  console.log(`Next: \`fusebase env use ${to}\`, then \`fusebase deploy --env ${to}\`.`);
}

// --- env use -------------------------------------------------------------------

async function runEnvUse(name: string, options: { tokens?: boolean }): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();

  const config = loadEnvironmentConfig(cwd, name); // throws with guidance
  writeActiveEnvironmentState(cwd, name);
  ensureEnvGitignoreEntries(cwd);
  console.log(`✓ Active environment: ${name} (backend: ${config.backend}, org: ${config.orgId})`);
  printProtectedBanner({ name, config, filePath: getEnvironmentFilePath(cwd, name) });

  // Auth for this backend.
  const authState = backendAuthState(config.backend);
  if (authState === "missing") {
    const authCmd = config.backend === "dev" ? "fusebase auth --dev" : "fusebase auth";
    if (isTty()) {
      let runAuth = false;
      try {
        runAuth = await confirm({
          message: `No API key for backend "${config.backend}". Authenticate now? (opens browser)`,
          default: true,
        });
      } catch {
        runAuth = false;
      }
      if (runAuth) {
        await runAuthFlow(config.backend === "dev");
      } else {
        console.log(`Next: run \`${authCmd}\` before using this environment.`);
      }
    } else {
      console.warn(`Warning: no API key for backend "${config.backend}". Run \`${authCmd}\`.`);
    }
  } else if (authState === "legacy") {
    const authCmd = config.backend === "dev" ? "fusebase auth --dev" : "fusebase auth";
    console.warn(
      `Note: using the legacy API key for backend "${config.backend}". Run \`${authCmd}\` once to bind a key to this backend.`,
    );
  }

  // Per-env dotenv.
  const envFile = getEnvironmentEnvFilePath(cwd, name);
  if (!existsSync(envFile)) {
    if (options.tokens) {
      const active = getActiveEnvironment(cwd);
      if (active) await runTokensForEnvironment(active, true);
    } else if (isTty()) {
      let createTokens = false;
      try {
        createTokens = await confirm({
          message: `.env.${name} does not exist. Create MCP tokens for this environment now?`,
          default: true,
        });
      } catch {
        createTokens = false;
      }
      if (createTokens) {
        const active = getActiveEnvironment(cwd);
        if (active) await runTokensForEnvironment(active, true);
      } else {
        console.log(`Next: run \`fusebase env tokens\` to create .env.${name}.`);
      }
    } else {
      console.warn(`Warning: .env.${name} does not exist. Run \`fusebase env tokens\`.`);
    }
    if (!existsSync(envFile) && existsSync(join(cwd, ".env"))) {
      console.warn(
        `Warning: .env still contains values from the previous environment — refresh with \`fusebase env tokens\`.`,
      );
    }
  } else if (options.tokens) {
    const active = getActiveEnvironment(cwd);
    if (active) await runTokensForEnvironment(active, true);
  } else if (materializeActiveEnvFile(cwd, name)) {
    console.log(`✓ Materialized .env from .env.${name}`);
  }
}

// --- env strip ------------------------------------------------------------------

/**
 * Post-adoption cleanup: move env-specific ids (`apps[].id`, isolated-store
 * `storeId`s) out of fusebase.json into an environment lockfile — the same
 * thing `env init --strip` does at adoption time, for projects that adopted
 * without it. Ids not yet recorded in ANY environment are first merged into
 * the "home" environment (the one matching fusebase.json's own org/product,
 * or `--into <name>`), so nothing is orphaned.
 */
async function runEnvStrip(options: { into?: string }): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();

  if (!hasEnvironmentsDir(cwd)) {
    console.error(
      "Error: no environments/ directory. Use `fusebase env init --strip` to adopt environments and strip in one step.",
    );
    process.exit(1);
  }

  const fuseConfig = await loadFuseConfig(cwd); // raw read (local helper)
  const apps = fuseConfig.apps ?? [];
  const names = listEnvironmentNames(cwd);
  const envConfigs = new Map<string, EnvironmentConfig>();
  for (const n of names) {
    try {
      envConfigs.set(n, loadEnvironmentConfig(cwd, n));
    } catch {
      // Invalid env file — ignore for lookup purposes.
    }
  }

  // Collect fusebase.json ids that no environment records yet.
  interface OrphanEntry {
    key: string;
    id?: string;
    stores: Record<string, string>;
  }
  const orphans: OrphanEntry[] = [];
  for (const app of apps) {
    const key = appKeyOf(app);
    if (!key) continue;
    const recordedIds = new Set(
      [...envConfigs.values()]
        .map((c) => c.apps?.[key]?.id)
        .filter(Boolean) as string[],
    );
    const orphanId = app.id && !recordedIds.has(app.id) ? app.id : undefined;
    const stores: Record<string, string> = {};
    for (const store of app.isolatedStores?.sql ?? []) {
      if (!store.alias || !store.storeId) continue;
      const recorded = [...envConfigs.values()].some(
        (c) => c.apps?.[key]?.stores?.[store.alias!] === store.storeId,
      );
      if (!recorded) stores[store.alias] = store.storeId;
    }
    if (orphanId || Object.keys(stores).length > 0) {
      orphans.push({ key, id: orphanId, stores });
    }
  }

  if (orphans.length > 0) {
    // Home env: --into, or the single env matching fusebase.json's own org
    // (and product when both declare one).
    let homeName = options.into;
    if (homeName && !envConfigs.has(homeName)) {
      console.error(`Error: environment "${homeName}" not found (--into).`);
      process.exit(1);
    }
    if (!homeName) {
      const matches = [...envConfigs.entries()].filter(
        ([, c]) =>
          c.orgId === fuseConfig.orgId &&
          (!c.productId || !fuseConfig.productId || c.productId === fuseConfig.productId),
      );
      if (matches.length === 1) {
        homeName = matches[0]![0];
      } else {
        console.error(
          `Error: fusebase.json carries ids not recorded in any environment (${orphans
            .map((o) => o.key)
            .join(", ")}), and the home environment is ambiguous. Pass --into <name> to choose where to record them.`,
        );
        process.exit(1);
      }
    }
    for (const orphan of orphans) {
      writeEnvironmentAppResolution(cwd, homeName, orphan.key, {
        ...(orphan.id ? { id: orphan.id } : {}),
      });
      if (Object.keys(orphan.stores).length > 0) {
        const config = loadEnvironmentConfig(cwd, homeName);
        const appsMap = { ...(config.apps ?? {}) };
        const entry = { ...(appsMap[orphan.key] ?? {}) };
        entry.stores = { ...(entry.stores ?? {}), ...orphan.stores };
        appsMap[orphan.key] = entry;
        writeEnvironmentConfig(cwd, homeName, { ...config, apps: appsMap });
      }
    }
    console.log(
      `✓ Recorded ${orphans.length} unrecorded id(s) into environments/${homeName}.json (${orphans
        .map((o) => o.key)
        .join(", ")})`,
    );
  }

  stripEnvSpecificIdsFromFusebaseJson(cwd);
  console.log(
    "✓ Stripped apps[].id and isolated store storeId values from fusebase.json (owned by environment lockfiles)",
  );
}

// --- env remove -----------------------------------------------------------------

/**
 * Remove an environment's LOCAL files: `environments/<name>.json`,
 * `.env.<name>`, and the active-state entry when it pointed at this env.
 * Platform entities (product, apps, stores) are deliberately untouched —
 * deleting deployed infrastructure must never be a local-file side effect.
 */
async function runEnvRemove(
  name: string,
  options: { yes?: boolean },
): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();

  const filePath = getEnvironmentFilePath(cwd, name);
  if (!existsSync(filePath)) {
    const available = listEnvironmentNames(cwd);
    console.error(
      `Error: environment "${name}" not found.${available.length > 0 ? ` Available: ${available.join(", ")}.` : ""}`,
    );
    process.exit(1);
  }

  let config: EnvironmentConfig | undefined;
  try {
    config = loadEnvironmentConfig(cwd, name);
  } catch {
    // Corrupt file — still removable.
  }

  if (!options.yes) {
    if (!isTty()) {
      console.error("Error: pass --yes to remove an environment non-interactively.");
      process.exit(1);
    }
    const label = config
      ? `"${name}" (backend: ${config.backend}, org: ${config.orgId}${config.protected ? ", PROTECTED" : ""})`
      : `"${name}"`;
    const confirmed = await confirm({
      message: `Remove environment ${label}? Local files only — deployed product/apps on the platform are NOT deleted.`,
      default: false,
    });
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
    if (config?.protected) {
      const confirmedProtected = await confirm({
        message: `"${name}" is marked protected. Really remove its local environment files?`,
        default: false,
      });
      if (!confirmedProtected) {
        console.log("Aborted.");
        return;
      }
    }
  }

  rmSync(filePath);
  console.log(`✓ Removed ${filePath}`);

  const dotenvPath = getEnvironmentEnvFilePath(cwd, name);
  if (existsSync(dotenvPath)) {
    rmSync(dotenvPath);
    console.log(`✓ Removed .env.${name}`);
  }

  if (readActiveEnvironmentState(cwd) === name) {
    clearActiveEnvironmentState(cwd);
    const remaining = listEnvironmentNames(cwd);
    console.log(
      `✓ Cleared active environment${remaining.length > 0 ? ` — select another with \`fusebase env use <name>\` (available: ${remaining.join(", ")})` : ""}`,
    );
  }

  if (config?.productId) {
    console.log(
      `Note: product ${config.productId} and its apps still exist in org ${config.orgId} on the platform — remove them there if no longer needed.`,
    );
  }
}

// --- env list / status ----------------------------------------------------------

async function runEnvList(): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();
  const names = listEnvironmentNames(cwd);
  if (names.length === 0) {
    console.log("No environments defined. Run `fusebase env init` to adopt environments.");
    return;
  }
  const active = resolveActiveEnvironmentName(cwd)?.name;
  console.log("Environments:\n");
  for (const name of names) {
    let line = `  ${active === name ? "*" : " "} ${name}`;
    try {
      const config = loadEnvironmentConfig(cwd, name);
      const auth = backendAuthState(config.backend);
      const authLabel = auth === "ok" ? "auth ok" : auth === "legacy" ? "auth legacy-key" : "auth MISSING";
      line += `  backend=${config.backend}  org=${config.orgId}  ${authLabel}`;
      if (config.protected) line += "  [protected]";
    } catch {
      line += "  (invalid file)";
    }
    console.log(line);
  }
  if (!active) {
    console.log("\nNo active environment. Select one with `fusebase env use <name>`.");
  }
}

async function runEnvStatus(): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();

  const resolved = resolveActiveEnvironmentName(cwd);
  if (!resolved) {
    const names = listEnvironmentNames(cwd);
    if (names.length === 0) {
      console.log("No environments defined. Run `fusebase env init`.");
    } else {
      console.log(
        `No active environment (available: ${names.join(", ")}). Select one with \`fusebase env use <name>\`.`,
      );
    }
    return;
  }

  const config = loadEnvironmentConfig(cwd, resolved.name);
  const sourceLabels: Record<string, string> = {
    override: "--env option",
    "env-var": "FUSEBASE_ENV",
    state: ".fusebase/state.json",
    default: "fusebase.json defaultEnvironment",
    single: "only environment (auto)",
  };

  console.log(`Environment: ${resolved.name} (selected via ${sourceLabels[resolved.source] ?? resolved.source})`);
  console.log(`  backend:   ${config.backend}`);
  console.log(`  org:       ${config.orgId}`);
  console.log(`  product:   ${config.productId ?? "(unresolved — run deploy)"}`);
  if (config.protected) console.log("  protected: yes");
  if (config.subdomainSuffix) console.log(`  subdomainSuffix: ${config.subdomainSuffix}`);

  const auth = backendAuthState(config.backend);
  console.log(
    `  auth:      ${auth === "ok" ? "ok" : auth === "legacy" ? "legacy key fallback (run auth to bind)" : `MISSING — run \`fusebase auth${config.backend === "dev" ? " --dev" : ""}\``}`,
  );

  // Apps: manifest keys vs resolved ids in the env file. Only the env
  // lockfile counts — a legacy id in fusebase.json belongs to the environment
  // that adopted it at `env init`, not to every environment.
  const fuseConfig = await loadFuseConfig(cwd);
  const manifestApps = fuseConfig.apps ?? [];
  if (manifestApps.length > 0) {
    console.log("  apps:");
    for (const app of manifestApps) {
      const key = appKeyOf(app);
      if (!key) continue;
      const id = config.apps?.[key]?.id;
      const legacyHint =
        !id && app.id ? ` (fusebase.json id=${app.id} is not bound to this environment)` : "";
      console.log(
        `    ${key}: ${id ? `id=${id}` : `unresolved (run deploy)${legacyHint}`}`,
      );
    }
  }

  // Per-env dotenv freshness.
  const envFileName = `.env.${resolved.name}`;
  if (!existsSync(join(cwd, envFileName))) {
    console.log(`  tokens:    ${envFileName} missing — run \`fusebase env tokens\``);
  } else {
    const envMap = await readEnvFileMap(cwd, envFileName);
    if (!areMcpEnvTokensPresent(envMap)) {
      console.log(`  tokens:    ${envFileName} present, MCP tokens missing — run \`fusebase env tokens\``);
    } else {
      const fresh = matchesCurrentOrLegacyFallback({
        dashboards: envMap.get(DASHBOARDS_MCP_POLICY_FP_KEY),
        gate: envMap.get(GATE_MCP_POLICY_FP_KEY),
      });
      console.log(
        `  tokens:    ${envFileName} ${fresh ? "ok" : "STALE policy — run `fusebase env tokens`"}`,
      );
    }
  }
}

// --- env tokens ------------------------------------------------------------------

async function runEnvTokens(options: { env?: string; force?: boolean }): Promise<void> {
  requireEnvironmentsFlag();
  const cwd = process.cwd();
  if (options.env) {
    setEnvironmentOverride(options.env);
  }
  const active = getActiveEnvironment(cwd);
  if (!active) {
    console.error(
      "Error: no active environment. Select one with `fusebase env use <name>` or pass --env <name>.",
    );
    process.exit(1);
  }
  await runTokensForEnvironment(active, options.force !== false);
}

// --- command wiring ------------------------------------------------------------

export const envCommand = new Command("env")
  .description("Manage .env files and app environments");

envCommand
  .command("create")
  .description("Create or overwrite .env with MCP token (alias for `env tokens` when an environment is active)")
  .option("--no-force", "Do not overwrite existing .env (only add if missing)")
  .action(async (options: { force?: boolean }) => {
    try {
      await runEnvCreate(options.force !== false);
    } catch (error) {
      console.error("Error: Failed to create .env file:", error);
      process.exit(1);
    }
  });

envCommand
  .command("init")
  .description("Adopt app environments: current fusebase.json context becomes the first environment")
  .option("--name <name>", "Name for the first environment (default: current backend, e.g. prod)")
  .option("--strip", "Remove env-specific ids (apps[].id, storeId) from fusebase.json", false)
  .action(async (options: EnvInitOptions) => {
    try {
      await runEnvInit(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("add [name]")
  .description("Create a new environment file (no platform calls); prompts for missing parameters in a terminal")
  .option("--backend <backend>", "Platform backend: dev | prod | local")
  .option("--org <orgId>", "Organization id in that backend")
  .option("--product <productId>", "Product id (filled by deploy reconcile when omitted)")
  .option("--subdomain-suffix <suffix>", "Suffix appended to every app subdomain in this environment")
  .option("--protected", "Mark environment as protected (mutating commands ask for confirmation)")
  .action(async (name: string | undefined, options: EnvAddOptions) => {
    try {
      await runEnvAdd(name, options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("clone <from> <to>")
  .description("Create a new environment copying structure from an existing one (platform ids cleared)")
  .option("--org <orgId>", "Organization id for the new environment")
  .option("--backend <backend>", "Platform backend for the new environment (default: same as source)")
  .option("--subdomain-suffix <suffix>", "Suffix appended to every app subdomain in the new environment")
  .action(async (from: string, to: string, options: EnvCloneOptions) => {
    try {
      await runEnvClone(from, to, options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("use <name>")
  .description("Switch the active environment for this checkout")
  .option("--tokens", "Refresh .env.<name> MCP tokens without prompting", false)
  .action(async (name: string, options: { tokens?: boolean }) => {
    try {
      await runEnvUse(name, options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("strip")
  .description("Move env-specific ids (apps[].id, storeId) from fusebase.json into environment lockfiles")
  .option("--into <name>", "Environment to record unrecorded ids into (default: the env matching fusebase.json's org/product)")
  .action(async (options: { into?: string }) => {
    try {
      await runEnvStrip(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("remove <name>")
  .alias("delete")
  .description("Remove an environment's local files (env lockfile + .env.<name>); platform product/apps are NOT deleted")
  .option("--yes", "Skip confirmation (required in non-interactive mode)", false)
  .action(async (name: string, options: { yes?: boolean }) => {
    try {
      await runEnvRemove(name, options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("list")
  .description("List environments with backend, org, auth status")
  .action(async () => {
    try {
      await runEnvList();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("status")
  .description("Show the active environment: backend, org, auth, app ids, token freshness")
  .action(async () => {
    try {
      await runEnvStatus();
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

envCommand
  .command("tokens")
  .description("Write MCP tokens into .env.<env> for the active (or named) environment")
  .option("--env <name>", "Target environment (default: active)")
  .option("--no-force", "Do not overwrite existing tokens (only add if missing)")
  .action(async (options: { env?: string; force?: boolean }) => {
    try {
      await runEnvTokens(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
