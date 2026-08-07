import { access, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { IdePreset } from "./commands/steps/ide-setup";
import {
  applyMcpServersToCodexConfigToml,
  parseCodexMcpServersFromToml,
} from "./codex-mcp-config";
import {
  buildMcpServerSpecFromConnection,
  normalizeMcpServerSpec,
  type McpServerConnectionParams,
  type McpServerSpec,
  type McpServersMap,
} from "./mcp-server-spec";

export type { McpServerConnectionParams, McpServerSpec, McpServersMap };
export { buildMcpServerSpecFromConnection, normalizeMcpServerSpec };

const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";

export function getIdeMcpConfigPath(ide: IdePreset): string {
  switch (ide) {
    case "claude-code":
      return ".mcp.json";
    case "cursor":
      return ".cursor/mcp.json";
    case "vscode":
      return ".vscode/mcp.json";
    case "opencode":
      return "opencode.json";
    case "codex":
      return ".codex/config.toml";
    case "other":
      return "mcp_example.json";
    default: {
      const _exhaustive: never = ide;
      throw new Error(`Unsupported IDE preset: ${_exhaustive}`);
    }
  }
}

function getMcpContainerKey(ide: IdePreset): "mcpServers" | "mcp" | "servers" {
  if (ide === "opencode") return "mcp";
  if (ide === "vscode") return "servers";
  if (ide === "codex") {
    throw new Error("Codex MCP config is TOML; use codex-mcp-config helpers instead of JSON container keys.");
  }
  return "mcpServers";
}

function getMcpContainerFromJson(
  json: any,
  ide: IdePreset,
): Record<string, unknown> {
  const key = getMcpContainerKey(ide);
  if (!json || typeof json !== "object") json = {};
  if (!json[key] || typeof json[key] !== "object") json[key] = {};
  return json[key] as Record<string, unknown>;
}

function getIdeBaseConfig(ide: IdePreset): any {
  if (ide === "opencode") {
    return {
      $schema: OPENCODE_SCHEMA_URL,
      mcp: {},
    };
  }
  if (ide === "vscode") {
    return {
      servers: {},
    };
  }
  return {
    mcpServers: {},
  };
}

function formatJson(json: unknown): string {
  // Keep it stable/pretty because these files are user-edited.
  return JSON.stringify(json, null, 2) + "\n";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureMcpConfigInGitignore(targetDir: string): Promise<void> {
  const gitignorePath = join(targetDir, ".gitignore");
  const gitignoreExampleLines = [
    ".cursor/mcp.json",
    ".vscode/mcp.json",
    ".mcp.json",
    "opencode.json",
    "mcp_example.json",
    ".codex/config.toml",
  ];

  let projectContent = "";
  try {
    projectContent = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const currentLines = projectContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const missing = gitignoreExampleLines.filter((line) => !currentLines.includes(line));
  if (missing.length === 0) return;

  const suffix = (projectContent.trimEnd() ? "\n" : "") + missing.join("\n") + "\n";
  await writeFile(gitignorePath, projectContent.trimEnd() + suffix, "utf-8");
}

export type UpdateMcpServersResult = {
  targetPath: string;
  containerKey: "mcpServers" | "mcp" | "servers" | "mcp_servers";
  added: string[];
  updated: string[];
  removed: string[];
  ignoredRemove: string[];
  createdFile: boolean;
};

/**
 * Pure inner function:
 * Applies `add`/`remove` MCP server operations to an IDE MCP config JSON.
 * - Works with all IDE config types by `ide`.
 * - If `existingJson` is missing, it uses an empty base config for that IDE.
 */
export function applyMcpServersToIdeConfigJson(options: {
  ide: IdePreset;
  existingJson?: unknown;
  add?: Partial<McpServersMap>;
  remove?: string[];
}): {
  json: any;
  containerKey: "mcpServers" | "mcp" | "servers";
  added: string[];
  updated: string[];
  removed: string[];
  ignoredRemove: string[];
} {
  const { ide, existingJson, add, remove } = options;
  if (ide === "codex") {
    throw new Error("Codex uses .codex/config.toml; use applyMcpServersToCodexConfigToml instead.");
  }
  const containerKey = getMcpContainerKey(ide);

  const json: any =
    existingJson && typeof existingJson === "object" ? existingJson : getIdeBaseConfig(ide);

  const container = getMcpContainerFromJson(json, ide);

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const ignoredRemove: string[] = [];

  if (add && Object.keys(add).length > 0) {
    for (const [serverName, rawSpec] of Object.entries(add)) {
      if (rawSpec === undefined) continue;
      const spec = normalizeMcpServerSpec(rawSpec, serverName);
      if (Object.prototype.hasOwnProperty.call(container, serverName)) updated.push(serverName);
      else added.push(serverName);
      (container as any)[serverName] = spec;
    }
  }

  if (remove && remove.length > 0) {
    for (const serverName of remove) {
      const clean = serverName.trim();
      if (clean.length === 0) continue;
      if (Object.prototype.hasOwnProperty.call(container, clean)) {
        delete (container as any)[clean];
        removed.push(clean);
      } else {
        ignoredRemove.push(clean);
      }
    }
  }

  // Ensure the container key matches the IDE's expected format.
  if (containerKey === "mcp" && typeof json.mcp !== "object") json.mcp = container;
  if (containerKey === "mcpServers" && typeof json.mcpServers !== "object") json.mcpServers = container;
  if (containerKey === "servers" && typeof json.servers !== "object") json.servers = container;

  // Keep schema for opencode; if file existed, we preserve it.
  if (ide === "opencode" && typeof json.$schema !== "string") json.$schema = OPENCODE_SCHEMA_URL;

  return { json, containerKey, added, updated, removed, ignoredRemove };
}

/**
 * File-level wrapper:
 * Creates/writes the IDE MCP config file on disk and applies add/remove operations.
 */
export async function updateIdeMcpServers(options: {
  targetDir: string;
  ide: IdePreset;
  add?: Partial<McpServersMap>;
  remove?: string[];
}): Promise<UpdateMcpServersResult> {
  const { targetDir, ide, add, remove } = options;

  const relPath = getIdeMcpConfigPath(ide);
  const targetPath = join(targetDir, relPath);
  const createdFile = !(await fileExists(targetPath));

  if (ide === "codex") {
    let existingToml: string | undefined;
    if (!createdFile) {
      existingToml = await readFile(targetPath, "utf-8");
    }
    const before = existingToml ? parseCodexMcpServersFromToml(existingToml) : {};
    const out = applyMcpServersToCodexConfigToml({ existingToml, add, remove });

    const added: string[] = [];
    const updated: string[] = [];
    for (const name of Object.keys(add ?? {})) {
      const spec = add?.[name];
      if (spec === undefined) continue;
      if (before[name]) updated.push(name);
      else added.push(name);
    }

    const removed: string[] = [];
    const ignoredRemove: string[] = [];
    for (const name of remove ?? []) {
      const clean = name.trim();
      if (!clean.length) continue;
      if (before[clean]) removed.push(clean);
      else ignoredRemove.push(clean);
    }

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, out, "utf-8");
    await ensureMcpConfigInGitignore(targetDir);

    return {
      targetPath,
      containerKey: "mcp_servers",
      added,
      updated,
      removed,
      ignoredRemove,
      createdFile,
    };
  }

  let existingJson: any = undefined;
  if (!createdFile) {
    const raw = await readFile(targetPath, "utf-8");
    existingJson = JSON.parse(raw);
  }

  const applied = applyMcpServersToIdeConfigJson({
    ide,
    existingJson,
    add,
    remove,
  });

  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, formatJson(applied.json), "utf-8");
  await ensureMcpConfigInGitignore(targetDir);

  if (ide === "claude-code") {
    await mergeProjectClaudeCodeMcpJsonAllowlistInSettings(targetDir);
  }

  return {
    targetPath,
    containerKey: applied.containerKey,
    added: applied.added,
    updated: applied.updated,
    removed: applied.removed,
    ignoredRemove: applied.ignoredRemove,
    createdFile,
  };
}

/** Generated MCP servers whose bearer token comes from the project `.env`. */
const TOKENED_MCP_SERVERS: Record<string, string> = {
  "fusebase-dashboards": "DASHBOARDS_MCP_TOKEN",
  "fusebase-gate": "GATE_MCP_TOKEN",
};

const ALL_IDE_PRESETS: IdePreset[] = [
  "claude-code",
  "cursor",
  "vscode",
  "opencode",
  "codex",
  "other",
];

export type StaleIdeMcpConfig = {
  /** Config path relative to the project root. */
  path: string;
  /** Server names whose bearer token disagrees with the expected one. */
  servers: string[];
};

function bearerToken(spec: unknown): string | undefined {
  const headers = (spec as { headers?: Record<string, unknown> } | undefined)?.headers;
  const auth = headers?.["Authorization"];
  if (typeof auth !== "string") return undefined;
  const match = auth.match(/^Bearer\s+(.+)$/);
  return match?.[1]?.trim();
}

/**
 * IDE MCP configs embed the tokens as literals, so switching environments
 * leaves them pinned to the previous env until `config ide --force` reruns.
 * Report every generated config whose baked token disagrees with `envMap`.
 * Servers with no expected token (or no literal token in the config) are
 * skipped — nothing to compare.
 */
export async function findStaleIdeMcpConfigs(
  targetDir: string,
  envMap: Map<string, string>,
): Promise<StaleIdeMcpConfig[]> {
  const stale: StaleIdeMcpConfig[] = [];

  for (const ide of ALL_IDE_PRESETS) {
    const relPath = getIdeMcpConfigPath(ide);
    const fullPath = join(targetDir, relPath);
    if (!(await fileExists(fullPath))) continue;

    let servers: Record<string, unknown>;
    try {
      const raw = await readFile(fullPath, "utf-8");
      servers =
        ide === "codex"
          ? parseCodexMcpServersFromToml(raw)
          : getMcpContainerFromJson(JSON.parse(raw), ide);
    } catch {
      continue; // Unparsable/hand-edited config — not our call to judge.
    }

    const diverged: string[] = [];
    for (const [serverName, envKey] of Object.entries(TOKENED_MCP_SERVERS)) {
      const expected = envMap.get(envKey)?.trim();
      const actual = bearerToken(servers[serverName]);
      if (!expected || !actual) continue;
      if (actual !== expected) diverged.push(serverName);
    }

    if (diverged.length > 0) stale.push({ path: relPath, servers: diverged });
  }

  return stale;
}

/**
 * Claude Code only loads project-root `.mcp.json` servers that appear in
 * `.claude/settings.json` → `enabledMcpjsonServers` (or after interactive approval).
 * Merge every server name currently present in `.mcp.json` into that allowlist,
 * preserving the rest of `settings.json` and any existing allowlist entries.
 */
export async function mergeProjectClaudeCodeMcpJsonAllowlistInSettings(targetDir: string): Promise<void> {
  const mcpPath = join(targetDir, ".mcp.json");
  if (!(await fileExists(mcpPath))) {
    return;
  }

  let mcpJson: unknown;
  try {
    mcpJson = JSON.parse(await readFile(mcpPath, "utf-8"));
  } catch {
    return;
  }

  if (!mcpJson || typeof mcpJson !== "object") {
    return;
  }

  const servers = (mcpJson as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object") {
    return;
  }

  const fromMcp = Object.keys(servers as Record<string, unknown>).filter((k) => k.length > 0);
  if (fromMcp.length === 0) {
    return;
  }

  const settingsPath = join(targetDir, ".claude", "settings.json");
  let settings: Record<string, unknown> = {};

  if (await fileExists(settingsPath)) {
    try {
      const raw = await readFile(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = { ...parsed } as Record<string, unknown>;
      }
    } catch {
      console.warn("⚠ Could not parse .claude/settings.json; skipping Claude Code MCP allowlist merge.");
      return;
    }
  }

  const prev = settings["enabledMcpjsonServers"];
  const allow = new Set<string>();
  if (Array.isArray(prev)) {
    for (const x of prev) {
      if (typeof x === "string" && x.length > 0) allow.add(x);
    }
  }
  for (const name of fromMcp) {
    allow.add(name);
  }

  settings["enabledMcpjsonServers"] = [...allow].sort();

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

