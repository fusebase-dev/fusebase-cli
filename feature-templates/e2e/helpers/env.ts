/**
 * Environment-aware test harness.
 *
 * Resolves the TARGET environment for a test run and exposes everything specs
 * need: base URLs per app, test-user fixtures, and a stage assertion. The same
 * spec set runs against any environment — select it with:
 *
 *   FUSEBASE_ENV=dev npx playwright test
 *
 * Sources (all owned by the `fusebase env` tooling — do not hand-edit ids):
 *  - `environments/<name>.json` — backend, org, per-app subdomains, fixtures
 *  - `.env.<name>`              — secrets (e.g. PW_USER_<KEY>_PASSWORD)
 *  - `fusebase.json`            — app declarations (default subdomains)
 *  - `.fusebase/state.json`     — active env fallback when FUSEBASE_ENV unset
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface EnvFixtureUser {
  key: string;
  email: string;
  role?: string;
}

export interface EnvironmentFile {
  backend: "dev" | "prod" | "local";
  orgId: string;
  productId?: string;
  protected?: boolean;
  subdomainSuffix?: string;
  apps?: Record<
    string,
    { id?: string; subdomain?: string; stores?: Record<string, string> }
  >;
  fixtures?: { testUsers?: EnvFixtureUser[] };
}

export interface TargetEnvironment {
  name: string;
  projectRoot: string;
  config: EnvironmentFile;
  /** Parsed .env.<name> (secrets; never log values). */
  secrets: Record<string, string>;
}

/** Walk up from cwd until fusebase.json is found. */
export function findProjectRoot(startDir = process.cwd()): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "fusebase.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        "fusebase.json not found — run tests from inside a Fusebase project",
      );
    }
    dir = parent;
  }
}

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[trimmed.slice(0, eq).trim()] = value;
  }
  return out;
}

/**
 * Resolve the target environment: FUSEBASE_ENV > .fusebase/state.json >
 * the only environment in environments/. Fails loud otherwise — a test run
 * must never silently target the wrong stage.
 */
export function resolveTargetEnvironment(): TargetEnvironment {
  const projectRoot = findProjectRoot();
  const envsDir = join(projectRoot, "environments");
  if (!existsSync(envsDir)) {
    throw new Error(
      "environments/ not found — adopt environments first (fusebase env init)",
    );
  }
  const available = readdirSync(envsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => basename(f, ".json"));

  let name = process.env.FUSEBASE_ENV;
  if (!name) {
    const statePath = join(projectRoot, ".fusebase", "state.json");
    if (existsSync(statePath)) {
      try {
        name = JSON.parse(readFileSync(statePath, "utf-8")).activeEnvironment;
      } catch {
        // fall through
      }
    }
  }
  if (!name && available.length === 1) name = available[0];
  if (!name) {
    throw new Error(
      `No target environment. Set FUSEBASE_ENV=<name> (available: ${available.join(", ")})`,
    );
  }

  const configPath = join(envsDir, `${name}.json`);
  if (!existsSync(configPath)) {
    throw new Error(
      `Environment "${name}" not found (available: ${available.join(", ")})`,
    );
  }
  const config = JSON.parse(readFileSync(configPath, "utf-8")) as EnvironmentFile;

  const dotenvPath = join(projectRoot, `.env.${name}`);
  const secrets = existsSync(dotenvPath)
    ? parseDotenv(readFileSync(dotenvPath, "utf-8"))
    : {};

  return { name, projectRoot, config, secrets };
}

function appHostForBackend(backend: string): string {
  return backend === "prod" ? "thefusebase.app" : "dev-thefusebase-app.com";
}

/**
 * Base URL of an app in the target environment. `appKey` is the fusebase.json
 * app key (subdomain by default); omit it when the project has a single app.
 */
export function appBaseUrl(env: TargetEnvironment, appKey?: string): string {
  const fuseConfig = JSON.parse(
    readFileSync(join(env.projectRoot, "fusebase.json"), "utf-8"),
  ) as { apps?: Array<{ key?: string; subdomain?: string; id?: string; path?: string }> };
  const apps = fuseConfig.apps ?? [];

  const entry = appKey
    ? apps.find(
        (a) =>
          (a.key ?? a.subdomain ?? a.id ?? (a.path ? basename(a.path) : "")) ===
          appKey,
      )
    : apps[0];
  if (!entry) {
    throw new Error(`App "${appKey ?? "(first)"}" not found in fusebase.json`);
  }
  const key = entry.key ?? entry.subdomain ?? entry.id ?? basename(entry.path ?? "");

  const envApp = env.config.apps?.[key];
  const subdomain =
    envApp?.subdomain ??
    (entry.subdomain
      ? `${entry.subdomain}${env.config.subdomainSuffix ?? ""}`
      : undefined);
  if (!subdomain) {
    throw new Error(`No subdomain resolvable for app "${key}" in env "${env.name}"`);
  }
  return `https://${subdomain}.${appHostForBackend(env.config.backend)}`;
}

/** Fixture user by key; password from .env.<name> `PW_USER_<KEY>_PASSWORD`. */
export function fixtureUser(
  env: TargetEnvironment,
  key: string,
): { email: string; password: string; role?: string } | null {
  const user = env.config.fixtures?.testUsers?.find((u) => u.key === key);
  if (!user) return null;
  const password = env.secrets[`PW_USER_${key.toUpperCase()}_PASSWORD`];
  if (!password) return null;
  return { email: user.email, password, role: user.role };
}

/**
 * Shape of `fusebase-env.json` baked into every environment-aware deploy
 * (also available synchronously as `window.__FUSEBASE_ENV__`).
 */
export interface DeployedEnvInfo {
  env: string;
  backend: string;
  orgId: string;
  appId?: string;
  protected?: boolean;
}

/**
 * Fetch the deployed bundle's env info. Specs MUST assert
 * `info.env === env.name` before doing anything else — cheap protection
 * against pointing a run at the wrong stage.
 */
export async function fetchDeployedEnvInfo(
  baseUrl: string,
): Promise<DeployedEnvInfo | null> {
  try {
    const res = await fetch(`${baseUrl}/fusebase-env.json`, {
      redirect: "manual",
    });
    if (!res.ok) return null;
    return (await res.json()) as DeployedEnvInfo;
  } catch {
    return null;
  }
}
