/**
 * E2E test environment loader.
 *
 * Loads the small set of env vars required to talk to a real Fusebase
 * environment and exposes a single `getE2eEnv()` accessor plus a top-level
 * `e2eEnvAvailable` flag that test files can pass to `describe.skipIf` /
 * `test.skipIf` so the suite produces a clean SKIP (not a failure) when run
 * without credentials.
 */

export type FusebaseEnv = "dev" | "prod";

export interface E2eEnv {
  /** Public-API key. Bearer-style. */
  apiKey: string;
  /** Target environment. Drives the public-api base URL. */
  env: FusebaseEnv;
  /** Org under which test apps are created. */
  orgId: string;
  /** Resolved public-api base URL (no trailing slash). */
  apiBaseUrl: string;
}

const REQUIRED_VARS = [
  "FUSEBASE_API_KEY",
  "FUSEBASE_ENV",
  "FUSEBASE_TEST_ORG_ID",
] as const;

function readEnv(): { value: E2eEnv | null; missing: string[] } {
  const missing: string[] = [];
  for (const name of REQUIRED_VARS) {
    const v = process.env[name];
    if (!v || v.trim() === "") missing.push(name);
  }
  if (missing.length > 0) return { value: null, missing };

  const env = process.env.FUSEBASE_ENV as string;
  if (env !== "dev" && env !== "prod") {
    return { value: null, missing: [`FUSEBASE_ENV (got "${env}", expected "dev" or "prod")`] };
  }

  return {
    value: {
      apiKey: process.env.FUSEBASE_API_KEY!,
      env,
      orgId: process.env.FUSEBASE_TEST_ORG_ID!,
      apiBaseUrl: getApiBaseUrl(env),
    },
    missing: [],
  };
}

export function getApiBaseUrl(env: FusebaseEnv): string {
  switch (env) {
    case "dev":
      return "https://public-api.dev-thefusebase.com";
    case "prod":
      return "https://public-api.thefusebase.com";
  }
}

/**
 * Apps subdomain host (mirrors `getFusebaseAppHost` in lib/config.ts). Used to
 * reconstruct a feature's public URL before deploy, so cron jobs can be
 * configured with the URL via a secret without waiting for the deploy summary.
 */
export function getAppHost(env: FusebaseEnv): string {
  switch (env) {
    case "dev":
      return "dev-thefusebase-app.com";
    case "prod":
      return "thefusebase.app";
  }
}

const cached = readEnv();

/** True when every required env var is present and valid. */
export const e2eEnvAvailable: boolean = cached.value !== null;

/** Names of env vars that are missing; empty when {@link e2eEnvAvailable} is true. */
export const e2eEnvMissing: readonly string[] = cached.missing;

/**
 * Returns the resolved E2E env. Throws if any required var is missing — call
 * sites should gate themselves with `e2eEnvAvailable` first.
 */
export function getE2eEnv(): E2eEnv {
  if (!cached.value) {
    throw new Error(
      `E2E env not available. Missing: ${cached.missing.join(", ")}`,
    );
  }
  return cached.value;
}
