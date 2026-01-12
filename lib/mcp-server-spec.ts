export type McpServerSpec = {
  type: string;
  url: string;
  headers?: Record<string, string>;
  // Allow extra fields supported by a given IDE/MCP client.
  [key: string]: unknown;
};

/**
 * Connection params shape a caller passes in.
 * Example: { type: "http", url: "https://mcp.notion.com/mcp" }
 */
export type McpServerConnectionParams = McpServerSpec;

export type McpServersMap = Record<string, McpServerSpec>;

export function normalizeMcpServerSpec(value: unknown, serverName: string): McpServerSpec {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid MCP spec for "${serverName}": expected an object.`);
  }
  const obj = value as any;
  const type = obj.type;
  const url = obj.url;
  if (typeof type !== "string" || type.trim().length === 0) {
    throw new Error(`Invalid MCP spec for "${serverName}": "type" must be a non-empty string.`);
  }
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error(`Invalid MCP spec for "${serverName}": "url" must be a non-empty string.`);
  }

  const spec: McpServerSpec = {
    ...obj,
    type: type.trim(),
    url: url.trim(),
  };

  if (obj.headers !== undefined) {
    if (!obj.headers || typeof obj.headers !== "object") {
      throw new Error(`Invalid MCP spec for "${serverName}": "headers" must be an object.`);
    }
    const headers = obj.headers as Record<string, unknown>;
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v !== "string") {
        throw new Error(
          `Invalid MCP spec for "${serverName}": header "${k}" must be a string.`,
        );
      }
      normalized[k] = v;
    }
    spec.headers = normalized;
  }

  return spec;
}

/**
 * Transform connection params into a single MCP server spec.
 * - Keeps this IDE-agnostic (doesn't care whether container is `mcpServers`, `servers`, or `mcp`).
 */
export function buildMcpServerSpecFromConnection(
  params: unknown,
  serverName: string,
): McpServerSpec {
  return normalizeMcpServerSpec(params, serverName);
}
