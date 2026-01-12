import * as TOML from "@iarna/toml";
import type { McpServerSpec, McpServersMap } from "./mcp-server-spec";
import { normalizeMcpServerSpec } from "./mcp-server-spec";

function escapeTomlBasicString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatCodexServerBlock(name: string, spec: McpServerSpec): string {
  const lines: string[] = [];
  const safeName = name.replace(/"/g, '\\"');
  lines.push(`[mcp_servers."${safeName}"]`);
  lines.push(`enabled = true`);
  lines.push(`url = "${escapeTomlBasicString(spec.url)}"`);
  if (spec.headers && Object.keys(spec.headers).length > 0) {
    const parts = Object.entries(spec.headers).map(
      ([k, v]) => `${k} = "${escapeTomlBasicString(v)}"`,
    );
    lines.push(`http_headers = { ${parts.join(", ")} }`);
  }
  return lines.join("\n");
}

export function serializeCodexMcpServersToml(mcpServers: Record<string, McpServerSpec>): string {
  const names = Object.keys(mcpServers).sort();
  if (names.length === 0) return "";
  const blocks = names.map((n) => {
    const spec = mcpServers[n];
    if (!spec) return "";
    return formatCodexServerBlock(n, spec);
  }).filter((b) => b.length > 0);
  return `${blocks.join("\n\n")}\n`;
}

/**
 * Read `[mcp_servers.*]` entries from a Codex `.codex/config.toml` file into normalized MCP specs.
 */
export function parseCodexMcpServersFromToml(raw: string): Record<string, McpServerSpec> {
  let parsed: unknown;
  try {
    parsed = TOML.parse(raw);
  } catch {
    return {};
  }
  const root = parsed as Record<string, unknown>;
  const mcp = root?.mcp_servers;
  if (!mcp || typeof mcp !== "object") return {};

  const out: Record<string, McpServerSpec> = {};
  for (const [serverName, entry] of Object.entries(mcp as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const url = typeof e.url === "string" ? e.url : "";
    if (!url.trim()) continue;

    const rawHeaders = (e.http_headers ?? e.headers) as Record<string, unknown> | undefined;
    const specLike: Record<string, unknown> = {
      type: "http",
      url: e.url,
    };
    if (rawHeaders && typeof rawHeaders === "object") {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") headers[k] = v;
      }
      if (Object.keys(headers).length > 0) specLike.headers = headers;
    }

    try {
      out[serverName] = normalizeMcpServerSpec(specLike, serverName);
    } catch {
      // skip invalid blocks
    }
  }
  return out;
}

/**
 * Merge MCP server add/remove into Codex TOML, preserving unrelated `[mcp_servers.*]` entries.
 */
export function applyMcpServersToCodexConfigToml(options: {
  existingToml?: string | undefined;
  add?: Partial<McpServersMap>;
  remove?: string[];
}): string {
  const { existingToml, add, remove } = options;
  const container = existingToml ? parseCodexMcpServersFromToml(existingToml) : {};

  for (const [serverName, rawSpec] of Object.entries(add ?? {})) {
    if (rawSpec === undefined) continue;
    container[serverName] = normalizeMcpServerSpec(rawSpec, serverName);
  }

  for (const name of remove ?? []) {
    const clean = name.trim();
    if (!clean) continue;
    delete container[clean];
  }

  return serializeCodexMcpServersToml(container);
}
