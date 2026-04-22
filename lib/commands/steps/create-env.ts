/**
 * Create .env Step
 *
 * Creates or updates a .env file with MCP token and URL for the project.
 * Generates a new token with full permissions for the organization scope.
 * If .env exists, merges new values (preserves existing vars, updates MCP vars).
 */

import { writeFile, readFile, access } from "fs/promises";
import { join } from "path";
import { createDashboardsToken, createGateToken } from "../../api";
import { getFusebaseHost, getFusebaseAppHost } from "../../config";
import {
  buildDashboardsMcpTokenRequest,
  buildGateMcpTokenRequest,
  DASHBOARDS_MCP_POLICY_FP_KEY,
  GATE_MCP_POLICY_FP_KEY,
  getExpectedMcpPolicyFingerprints,
  matchesCurrentOrLegacyFallback,
} from "../../mcp-token-policy";

function getDashboardsMcpUrl(): string {
  return `https://dashboards-mcp.${getFusebaseHost()}/mcp`;
}

function getGateMcpUrl(): string {
  return `https://gate-mcp.${getFusebaseHost()}/mcp`;
}

const ENV_KEYS = [
  "DASHBOARDS_MCP_URL",
  "DASHBOARDS_MCP_TOKEN",
  "GATE_MCP_URL",
  "GATE_MCP_TOKEN",
  "FUSEBASE_HOST",
  "FUSEBASE_APP_HOST",
] as const;

export interface CreateEnvOptions {
  targetDir: string;
  apiKey: string;
  orgId: string;
  /** Gate MCP token includes `client` scope (app id) alongside org. */
  appId: string;
  force?: boolean;
  /** Refresh dashboards MCP token/key values in `.env` (default: true). */
  refreshDashboardsToken?: boolean;
  /** Refresh gate MCP token/key values in `.env` (default: true). */
  refreshGateToken?: boolean;
}

export interface CreateEnvResult {
  created: boolean;
  updated: boolean;
  skipped: boolean;
  envPath: string;
  error?: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse .env file content into key-value map
 */
function parseEnvFile(content: string): Map<string, string> {
  const env = new Map<string, string>();
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env.set(key, value);
    }
  }

  return env;
}

/**
 * Serialize env map back to .env file format, preserving original structure
 */
function serializeEnvFile(originalContent: string, updates: Map<string, string>): string {
  const lines = originalContent.split("\n");
  const updatedKeys = new Set<string>();
  const result: string[] = [];

  // Update existing lines
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      if (updates.has(key)) {
        result.push(`${key}=${updates.get(key)}`);
        updatedKeys.add(key);
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  // Add new keys that weren't in original
  for (const [key, value] of updates) {
    if (!updatedKeys.has(key)) {
      result.push(`${key}=${value}`);
    }
  }

  // Ensure file ends with newline
  let content = result.join("\n");
  if (!content.endsWith("\n")) {
    content += "\n";
  }

  return content;
}

/**
 * Check if MCP env vars already exist and have values
 */
function hasMcpEnvVars(env: Map<string, string>): boolean {
  return ENV_KEYS.every((key) => {
    const value = env.get(key);
    return value !== undefined && value.trim() !== "";
  });
}

/** True when `.env` policy fingerprints match what this CLI build would issue. */
function mcpPolicyFingerprintsMatchEnv(env: Map<string, string>): boolean {
  return matchesCurrentOrLegacyFallback({
    dashboards: env.get(DASHBOARDS_MCP_POLICY_FP_KEY),
    gate: env.get(GATE_MCP_POLICY_FP_KEY),
  });
}

/** Exported for `fusebase app update` — true when all MCP URL/token/host vars are set. */
export function areMcpEnvTokensPresent(env: Map<string, string>): boolean {
  return hasMcpEnvVars(env);
}

async function generateMcpToken(apiKey: string, orgId: string): Promise<string> {
  const request = buildDashboardsMcpTokenRequest(orgId);
  const response = await createDashboardsToken(apiKey, request);
  return response.data.token;
}

async function generateGateMcpToken(
  apiKey: string,
  orgId: string,
  appId: string,
): Promise<string> {
  const request = buildGateMcpTokenRequest(orgId, appId);
  const response = await createGateToken(apiKey, request);
  return response.data.token;
}

/**
 * Create or update .env file with MCP configuration
 *
 * Behavior:
 * - If .env doesn't exist: create with MCP vars
 * - If .env exists but missing MCP vars: add them
 * - If .env exists with MCP vars: skip (unless force=true)
 */
export async function readEnvFileMap(targetDir: string): Promise<Map<string, string>> {
  const envPath = join(targetDir, ".env");
  if (!(await fileExists(envPath))) {
    return new Map();
  }
  const existingContent = await readFile(envPath, "utf-8");
  return parseEnvFile(existingContent);
}

export async function createEnvFile(options: CreateEnvOptions): Promise<CreateEnvResult> {
  const {
    targetDir,
    apiKey,
    orgId,
    appId,
    force = false,
    refreshDashboardsToken = true,
    refreshGateToken = true,
  } = options;
  const envPath = join(targetDir, ".env");

  try {
    let existingContent = "";
    let existingEnv = new Map<string, string>();
    const envExists = await fileExists(envPath);

    if (envExists) {
      existingContent = await readFile(envPath, "utf-8");
      existingEnv = parseEnvFile(existingContent);

      // Skip only when MCP vars exist, not forced, and `.env` policy fingerprints match CLI
      if (hasMcpEnvVars(existingEnv) && !force && mcpPolicyFingerprintsMatchEnv(existingEnv)) {
        return {
          created: false,
          updated: false,
          skipped: true,
          envPath,
        };
      }
    }

    // Generate MCP tokens (selective refresh supported for `fusebase app update`).
    const dashboardsToken = refreshDashboardsToken
      ? await generateMcpToken(apiKey, orgId)
      : undefined;
    const gateToken = refreshGateToken
      ? await generateGateMcpToken(apiKey, orgId, appId)
      : undefined;

    // Prepare updates
    const fps = getExpectedMcpPolicyFingerprints();
    const updates = new Map<string, string>([
      ["FUSEBASE_HOST", getFusebaseHost()],
      ["FUSEBASE_APP_HOST", getFusebaseAppHost()],
      [DASHBOARDS_MCP_POLICY_FP_KEY, fps.dashboards],
      [GATE_MCP_POLICY_FP_KEY, fps.gate],
    ]);
    if (refreshDashboardsToken) {
      updates.set("DASHBOARDS_MCP_URL", getDashboardsMcpUrl());
      if (dashboardsToken) {
        updates.set("DASHBOARDS_MCP_TOKEN", dashboardsToken);
      }
    }
    if (refreshGateToken) {
      updates.set("GATE_MCP_URL", getGateMcpUrl());
      if (gateToken) {
        updates.set("GATE_MCP_TOKEN", gateToken);
      }
    }

    // Create or update .env content
    let envContent: string;
    if (envExists && existingContent.trim()) {
      envContent = serializeEnvFile(existingContent, updates);
    } else {
      envContent = Array.from(updates.entries())
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
    }

    // Write .env file
    await writeFile(envPath, envContent, "utf-8");

    return {
      created: !envExists,
      updated: envExists,
      skipped: false,
      envPath,
    };
  } catch (error) {
    return {
      created: false,
      updated: false,
      skipped: false,
      envPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Print result of .env creation/update
 */
export function printCreateEnvResult(result: CreateEnvResult): void {
  if (result.created) {
    console.log("✓ Created .env file with MCP token");
  } else if (result.updated) {
    console.log("✓ Updated .env file with MCP token");
  } else if (result.skipped) {
    console.log(
      "⚠ Skipped .env (MCP vars already set and DASHBOARDS_MCP_POLICY_FP / GATE_MCP_POLICY_FP match CLI — use --force to regenerate)",
    );
  } else if (result.error) {
    console.error(`✗ Failed to create .env: ${result.error}`);
  }
}
