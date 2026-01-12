import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { invalidateFuseConfigCache } from "./config";
import type { McpServerSpec } from "./mcp-server-spec";

export type McpCustomIntegrationEntry = {
  type: string;
  url: string;
  /** Stored in fusebase.json; sent as `Authorization: Bearer …` unless headers already set Authorization */
  token?: string;
  headers?: Record<string, string>;
  /**
   * When false, the server is not written to IDE MCP configs.
   * Missing is treated as enabled for backward compatibility.
   */
  enabled?: boolean;
};

export type McpIntegrationsConfig = {
  custom?: Record<string, McpCustomIntegrationEntry>;
};

const CUSTOM_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function isValidCustomIntegrationName(name: string): boolean {
  return CUSTOM_NAME_RE.test(name.trim());
}

export function assertCustomNameNotReserved(
  name: string,
  catalogServerNames: Set<string>,
): void {
  const n = name.trim();
  if (!isValidCustomIntegrationName(n)) {
    throw new Error(
      `Invalid server name "${name}". Use a letter first, then letters, digits, underscores, or hyphens (max 64 chars).`,
    );
  }
  if (catalogServerNames.has(n)) {
    throw new Error(
      `Name "${n}" is reserved for a catalog MCP server. Pick a different name.`,
    );
  }
}

export function customEntryToMcpSpec(entry: McpCustomIntegrationEntry): McpServerSpec {
  const headers: Record<string, string> = { ...(entry.headers ?? {}) };
  const token = entry.token?.trim();
  if (token && headers.Authorization === undefined) {
    headers.Authorization = `Bearer ${token}`;
  }
  const spec: McpServerSpec = {
    type: entry.type.trim(),
    url: entry.url.trim(),
  };
  if (Object.keys(headers).length > 0) spec.headers = headers;
  return spec;
}

export function isCustomIntegrationEnabled(entry: McpCustomIntegrationEntry | undefined): boolean {
  if (!entry) return false;
  return entry.enabled !== false;
}

export function buildEnabledCustomMcpAdds(
  customByName: Record<string, McpCustomIntegrationEntry>,
): Record<string, McpServerSpec> {
  const out: Record<string, McpServerSpec> = {};
  for (const [name, entry] of Object.entries(customByName)) {
    if (!isCustomIntegrationEnabled(entry)) continue;
    out[name] = customEntryToMcpSpec(entry);
  }
  return out;
}

export function readMcpIntegrationsFromFusebaseJson(projectRoot: string): McpIntegrationsConfig {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) {
    throw new Error("fusebase.json not found. Run fusebase init first.");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error("Could not parse fusebase.json");
  }
  const mi = raw.mcpIntegrations;
  if (mi === undefined) return {};
  if (typeof mi !== "object" || mi === null || Array.isArray(mi)) {
    throw new Error("Invalid fusebase.json: mcpIntegrations must be an object.");
  }
  return mi as McpIntegrationsConfig;
}

export function readCustomIntegrationsMap(
  projectRoot: string,
): Record<string, McpCustomIntegrationEntry> {
  const cfg = readMcpIntegrationsFromFusebaseJson(projectRoot);
  const custom = cfg.custom;
  if (custom === undefined) return {};
  if (typeof custom !== "object" || custom === null || Array.isArray(custom)) {
    throw new Error("Invalid fusebase.json: mcpIntegrations.custom must be an object.");
  }
  return custom as Record<string, McpCustomIntegrationEntry>;
}

/** Same as readCustomIntegrationsMap but returns {} if fusebase.json is missing or invalid. */
export function readCustomIntegrationsMapSafe(
  projectRoot: string,
): Record<string, McpCustomIntegrationEntry> {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) return {};
  try {
    return readCustomIntegrationsMap(projectRoot);
  } catch {
    return {};
  }
}

export function writeMcpIntegrationsToFusebaseJson(
  projectRoot: string,
  next: McpIntegrationsConfig,
): void {
  const fuseJsonPath = join(projectRoot, "fusebase.json");
  if (!existsSync(fuseJsonPath)) {
    throw new Error("fusebase.json not found. Run fusebase init first.");
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(fuseJsonPath, "utf-8")) as Record<string, unknown>;
  } catch {
    throw new Error("Could not parse fusebase.json");
  }

  const cleaned: McpIntegrationsConfig = { ...next };
  if (cleaned.custom && Object.keys(cleaned.custom).length === 0) {
    delete cleaned.custom;
  }
  if (Object.keys(cleaned).length === 0) {
    delete raw.mcpIntegrations;
  } else {
    raw.mcpIntegrations = cleaned;
  }

  writeFileSync(fuseJsonPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
  invalidateFuseConfigCache();
}

export function upsertCustomIntegration(
  projectRoot: string,
  name: string,
  entry: McpCustomIntegrationEntry,
): void {
  const prev = readMcpIntegrationsFromFusebaseJson(projectRoot);
  const custom = { ...(prev.custom ?? {}), [name.trim()]: entry };
  writeMcpIntegrationsToFusebaseJson(projectRoot, { ...prev, custom });
}

export function setCustomIntegrationEnabled(
  projectRoot: string,
  name: string,
  enabled: boolean,
): void {
  const prev = readMcpIntegrationsFromFusebaseJson(projectRoot);
  const custom = { ...(prev.custom ?? {}) };
  const key = name.trim();
  if (!custom[key]) {
    throw new Error(`No custom MCP integration named "${key}".`);
  }
  custom[key] = { ...custom[key], enabled };
  writeMcpIntegrationsToFusebaseJson(projectRoot, { ...prev, custom });
}

export function removeCustomIntegration(projectRoot: string, name: string): void {
  const prev = readMcpIntegrationsFromFusebaseJson(projectRoot);
  const custom = { ...(prev.custom ?? {}) };
  const key = name.trim();
  if (!custom[key]) {
    throw new Error(`No custom MCP integration named "${key}".`);
  }
  delete custom[key];
  writeMcpIntegrationsToFusebaseJson(projectRoot, { ...prev, custom });
}
