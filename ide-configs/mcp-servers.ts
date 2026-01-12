export type McpServerCatalogEntry = {
  /**
   * If set, this entry is ignored unless the flag is enabled in ~/.fusebase/config.json.
   * Evaluated first; `required` is only considered when this entry is active (no flag or flag on).
   */
  flag?: string;
  /** Meaningful only for active entries (see `flag`). */
  required?: boolean;
  type: string;
  url: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
};

export type McpServersCatalog = Record<string, McpServerCatalogEntry>;

// Single source of truth for "allowed" MCP servers across IDEs.
// Generators in `lib/commands/steps/ide-setup.ts` will:
//  - apply `flag` first; if the entry is inactive, skip it entirely
//  - among active entries, include only `required: true` in the default required set
//  - replace placeholders `{{SOME_ENV_KEY}}` from target project `.env`
//  - write final IDE configs with the correct container key (`mcpServers`/`servers`/`mcp`).
export const MCP_SERVERS_CATALOG: McpServersCatalog = {
  "fusebase-dashboards": {
    required: true,
    type: "http",
    url: "{{DASHBOARDS_MCP_URL}}",
    headers: {
      Authorization: "Bearer {{DASHBOARDS_MCP_TOKEN}}",
    },
  },
  "fusebase-gate": {
    required: true,
    type: "http",
    url: "{{GATE_MCP_URL}}",
    headers: {
      Authorization: "Bearer {{GATE_MCP_TOKEN}}",
    },
  },
  notion: {
    required: false,
    type: "http",
    url: "https://mcp.notion.com/mcp",
  },
  asana: {
    required: false,
    type: "http",
    url: "https://mcp.asana.com/mcp",
  },
  atlassian: {
    required: false,
    flag: "mcp-beta",
    type: "http",
    url: "https://mcp.atlassian.com/v1/mcp",
  },
  figma: {
    required: false,
    flag: "mcp-beta",
    type: "http",
    url: "https://mcp.figma.com/mcp",
  },
};

export default MCP_SERVERS_CATALOG;

