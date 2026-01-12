/**
 * MCP Integrations Step
 *
 * Interactive selection of optional MCP servers (integrations) from `ide-configs/mcp-servers.ts`,
 * plus custom HTTP MCP servers stored in `fusebase.json` → `mcpIntegrations.custom`.
 * - **Flag first:** if `entry.flag` is set and the flag is off, the entry is ignored (not required, not optional).
 * - **Then `required`:** among active entries, `required: true` are always on (not toggleable).
 * - optional active entries can be toggled; entries that become inactive (flag off) are removed from configs.
 *
 * Used automatically during `fusebase init` and can be called separately.
 */

import { checkbox } from "@inquirer/prompts";
import { join } from "path";
import { access, readFile } from "fs/promises";
import { pathToFileURL } from "url";
import { getFusebaseHost, hasFlag } from "../../config";
import { isMcpCatalogEntryActive } from "../../mcp-catalog";
import { updateIdeMcpServers } from "../../ide-mcp-config";
import { parseCodexMcpServersFromToml } from "../../codex-mcp-config";
import { getIdeConfigsDir, type IdePreset, resolveIdePresets } from "./ide-setup";
import type { McpServersCatalog, McpServerCatalogEntry } from "../../../ide-configs/mcp-servers";
import figures from "@inquirer/figures";
import { styleText } from "node:util";
import {
  buildEnabledCustomMcpAdds,
  isCustomIntegrationEnabled,
  readCustomIntegrationsMapSafe,
  readMcpIntegrationsFromFusebaseJson,
  writeMcpIntegrationsToFusebaseJson,
  type McpCustomIntegrationEntry,
} from "../../mcp-custom-integrations";

type LoadCatalogResult = {
  catalog: McpServersCatalog;
  cleanup?: () => Promise<void>;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getDashboardsMcpUrlFromFusebaseHost(): string {
  return `https://dashboards-mcp.${getFusebaseHost()}/mcp`;
}

function parseEnvFileToMap(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

async function parseProjectEnvFile(targetDir: string): Promise<Record<string, string>> {
  const envPath = join(targetDir, ".env");
  try {
    const content = await readFile(envPath, "utf-8");
    return parseEnvFileToMap(content);
  } catch {
    return {};
  }
}

function replacePlaceholdersDeep<T>(
  input: T,
  getReplacement: (key: string) => string | undefined,
): T {
  const visit = (value: any): any => {
    if (typeof value === "string") {
      return value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key: string) => {
        const replacement = getReplacement(key);
        return replacement !== undefined ? replacement : match;
      });
    }
    if (Array.isArray(value)) return value.map((v) => visit(v));
    if (value && typeof value === "object") {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) out[k] = visit(v);
      return out;
    }
    return value;
  };

  return visit(input);
}

function containsUnresolvedPlaceholders(value: unknown): boolean {
  const visit = (v: any): boolean => {
    if (typeof v === "string") {
      return /\{\{[A-Z0-9_]+\}\}/.test(v);
    }
    if (Array.isArray(v)) return v.some((x) => visit(x));
    if (v && typeof v === "object") return Object.values(v).some((x) => visit(x));
    return false;
  };
  return visit(value);
}

function collectPlaceholderKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  const visit = (v: any) => {
    if (typeof v === "string") {
      const matches = v.match(/\{\{([A-Z0-9_]+)\}\}/g);
      if (matches) {
        for (const m of matches) {
          const keyMatch = m.match(/\{\{([A-Z0-9_]+)\}\}/);
          if (keyMatch?.[1]) keys.add(keyMatch[1]);
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v)) visit(x);
    }
  };
  visit(value);
  return keys;
}

function getIdeMcpConfigFilePath(targetDir: string, ide: IdePreset): string {
  switch (ide) {
    case "claude-code":
      return join(targetDir, ".mcp.json");
    case "cursor":
      return join(targetDir, ".cursor/mcp.json");
    case "vscode":
      return join(targetDir, ".vscode/mcp.json");
    case "opencode":
      return join(targetDir, "opencode.json");
    case "codex":
      return join(targetDir, ".codex/config.toml");
    case "other":
      return join(targetDir, "mcp_example.json");
    default: {
      const _exhaustive: never = ide;
      throw new Error(`Unsupported IDE preset: ${_exhaustive}`);
    }
  }
}

function getIdeMcpContainerKey(ide: IdePreset): "mcpServers" | "servers" | "mcp" {
  if (ide === "opencode") return "mcp";
  if (ide === "vscode") return "servers";
  if (ide === "codex") {
    throw new Error("Codex uses .codex/config.toml (TOML), not a JSON container key.");
  }
  return "mcpServers";
}

export async function loadMcpServersCatalog(): Promise<LoadCatalogResult> {
  const configsInfo = await getIdeConfigsDir();
  const catalogPath = join(configsInfo.path, "mcp-servers.ts");
  const mod = await import(pathToFileURL(catalogPath).href);
  const catalog = (mod.MCP_SERVERS_CATALOG as McpServersCatalog | undefined)
    ?? (mod.default as McpServersCatalog | undefined);
  if (!catalog) {
    throw new Error("Failed to load MCP servers catalog (mcp-servers.ts).");
  }
  return { catalog, cleanup: configsInfo.cleanup };
}

function inferEnabledOptionalServersFromIdeConfigs(options: {
  targetDir: string;
  idePresets: Set<IdePreset>;
  optionalServerNames: string[];
}): Promise<Set<string>> {
  const { targetDir, idePresets, optionalServerNames } = options;

  return (async () => {
    const enabled = new Set<string>();
    for (const ide of idePresets) {
      const filePath = getIdeMcpConfigFilePath(targetDir, ide);
      if (!(await fileExists(filePath))) continue;

      try {
        if (ide === "codex") {
          const raw = await readFile(filePath, "utf-8");
          const mcp = parseCodexMcpServersFromToml(raw);
          for (const serverName of optionalServerNames) {
            if (serverName in mcp) enabled.add(serverName);
          }
          continue;
        }
        const raw = await readFile(filePath, "utf-8");
        const json = JSON.parse(raw) as any;
        const containerKey = getIdeMcpContainerKey(ide);
        const container = json?.[containerKey];
        if (!container || typeof container !== "object") continue;
        for (const serverName of optionalServerNames) {
          if (serverName in container) enabled.add(serverName);
        }
      } catch {
        // Ignore parse errors and continue.
      }
    }
    return enabled;
  })();
}

function toResolvedServerSpec(entry: McpServerCatalogEntry): any {
  const { required: _required, flag: _flag, ...spec } = entry;
  return spec;
}

function buildResolvedCatalogAdds(options: {
  catalog: McpServersCatalog;
  envMap: Record<string, string>;
  serverNames: string[];
}): Record<string, any> {
  const { catalog, envMap, serverNames } = options;

  const fallbackDashboardsUrl = envMap["DASHBOARDS_MCP_URL"] ?? getDashboardsMcpUrlFromFusebaseHost();

  const getReplacement = (key: string): string | undefined => {
    if (key === "DASHBOARDS_MCP_URL") return fallbackDashboardsUrl;
    return envMap[key];
  };

  const resolvedAdd: Record<string, any> = {};
  for (const serverName of serverNames) {
    const entry = catalog[serverName];
    if (!entry) continue;

    const spec = toResolvedServerSpec(entry);
    const resolvedSpec = replacePlaceholdersDeep(spec, getReplacement);
    resolvedAdd[serverName] = resolvedSpec;

    const unresolvedKeys = collectPlaceholderKeys(resolvedSpec);
    if (unresolvedKeys.size > 0) {
      console.warn(
        `⚠ MCP: unresolved placeholders for server "${serverName}" (missing from .env): ${Array.from(
          unresolvedKeys,
        ).join(", ")}`,
      );
    }
  }
  return resolvedAdd;
}

export type ApplyMcpIntegrationsSyncInput = {
  targetDir: string;
  idePresets: Set<IdePreset>;
  catalog: McpServersCatalog;
  envMap: Record<string, string>;
  fallbackDashboardsUrl: string;
  requiredServerNames: string[];
  optionalServerNames: string[];
  inactiveByFlagServerNames: string[];
  /** Optional catalog servers that should stay enabled. */
  selectedOptionalCatalog: Set<string>;
  /** Custom integrations (from fusebase.json); `enabled: false` entries are removed from IDE configs. */
  customByName: Record<string, McpCustomIntegrationEntry>;
  /** Strip these names from IDE configs (e.g. after deleting a custom integration from fusebase.json). */
  extraRemoveServerNames?: string[];
};

/**
 * Applies catalog + custom MCP servers to all IDE config files for the given presets.
 */
export async function applyMcpIntegrationsSync(input: ApplyMcpIntegrationsSyncInput): Promise<void> {
  const {
    targetDir,
    idePresets,
    catalog,
    envMap,
    fallbackDashboardsUrl,
    requiredServerNames,
    optionalServerNames,
    inactiveByFlagServerNames,
    selectedOptionalCatalog,
    customByName,
    extraRemoveServerNames = [],
  } = input;

  const desiredAddCatalogNames = [
    ...requiredServerNames,
    ...optionalServerNames.filter((n) => selectedOptionalCatalog.has(n)),
  ];

  const resolvedCatalogAdds = buildResolvedCatalogAdds({
    catalog,
    envMap: {
      ...envMap,
      DASHBOARDS_MCP_URL: fallbackDashboardsUrl,
    },
    serverNames: desiredAddCatalogNames,
  });

  for (const serverName of requiredServerNames) {
    if (containsUnresolvedPlaceholders(resolvedCatalogAdds[serverName])) {
      throw new Error(
        `Failed to resolve placeholders for required MCP server "${serverName}". Make sure required variables are present in .env.`,
      );
    }
  }

  const customAdds = buildEnabledCustomMcpAdds(customByName);
  const addMap = { ...resolvedCatalogAdds, ...customAdds };

  const removeOptionalCatalog = optionalServerNames.filter((n) => !selectedOptionalCatalog.has(n));
  const disabledCustomNames = Object.keys(customByName).filter(
    (k) => !isCustomIntegrationEnabled(customByName[k]),
  );
  const removeList = [
    ...new Set([
      ...removeOptionalCatalog,
      ...inactiveByFlagServerNames,
      ...disabledCustomNames,
      ...extraRemoveServerNames,
    ]),
  ];

  for (const ide of idePresets) {
    await updateIdeMcpServers({
      targetDir,
      ide,
      add: addMap,
      remove: removeList,
    });
  }
}

const ALL_IDE_PRESETS = new Set<IdePreset>([
  "claude-code",
  "cursor",
  "vscode",
  "opencode",
  "codex",
  "other",
]);

/**
 * Recomputes MCP entries from the catalog, optional selections inferred from existing IDE configs,
 * and custom entries in fusebase.json — then writes all IDE MCP configs.
 */
export async function syncMcpIntegrationsNow(options: {
  targetDir: string;
  idePresets?: Set<IdePreset>;
  /** Use after removing a custom server from fusebase.json so IDE configs drop the stale entry. */
  extraRemoveServerNames?: string[];
}): Promise<void> {
  const idePresets = options.idePresets ?? ALL_IDE_PRESETS;
  const { catalog, cleanup } = await loadMcpServersCatalog();
  try {
    const requiredServerNames = Object.entries(catalog)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        const e = entry as McpServerCatalogEntry;
        if (!isMcpCatalogEntryActive(e, hasFlag)) return false;
        return e.required === true;
      })
      .map(([name]) => name);

    const optionalServerNames = Object.entries(catalog)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        const e = entry as McpServerCatalogEntry;
        if (!isMcpCatalogEntryActive(e, hasFlag)) return false;
        return e.required !== true;
      })
      .map(([name]) => name);

    const inactiveByFlagServerNames = Object.entries(catalog)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        return !isMcpCatalogEntryActive(entry as McpServerCatalogEntry, hasFlag);
      })
      .map(([name]) => name);

    const envMap = await parseProjectEnvFile(options.targetDir);
    const fallbackDashboardsUrl = envMap["DASHBOARDS_MCP_URL"] ?? getDashboardsMcpUrlFromFusebaseHost();
    const requiredToken = envMap["DASHBOARDS_MCP_TOKEN"];
    if (!requiredToken) {
      throw new Error(
        "Missing DASHBOARDS_MCP_TOKEN in project .env. Run `fusebase env create` first.",
      );
    }

    const inferredOptional = await inferEnabledOptionalServersFromIdeConfigs({
      targetDir: options.targetDir,
      idePresets,
      optionalServerNames,
    });

    const customByName = readCustomIntegrationsMapSafe(options.targetDir);

    await applyMcpIntegrationsSync({
      targetDir: options.targetDir,
      idePresets,
      catalog,
      envMap,
      fallbackDashboardsUrl,
      requiredServerNames,
      optionalServerNames,
      inactiveByFlagServerNames,
      selectedOptionalCatalog: inferredOptional,
      customByName,
      extraRemoveServerNames: options.extraRemoveServerNames,
    });

    const enabledCustom = Object.keys(customByName).filter((k) =>
      isCustomIntegrationEnabled(customByName[k]),
    );
    // eslint-disable-next-line no-console
    console.log(
      `✓ MCP integrations applied. Catalog optional (from IDE): ${inferredOptional.size ? Array.from(inferredOptional).join(", ") : "(none)"}${enabledCustom.length ? ` | Custom: ${enabledCustom.join(", ")}` : ""}`,
    );
  } finally {
    if (cleanup) await cleanup();
  }
}

/**
 * Run MCP integrations step:
 * - optional servers selection (checkbox) including custom servers from fusebase.json
 * - enable/disable optional servers in all IDE configs via add/remove
 */
export async function runMcpIntegrationsStep(options: {
  targetDir: string;
  ide?: string; // optional CLI arg preset
  idePresets?: Set<IdePreset>;
  interactive?: boolean;
}): Promise<void> {
  const { targetDir } = options;
  const idePresets = options.idePresets
    ?? (options.ide ? resolveIdePresets(options.ide) : ALL_IDE_PRESETS);

  const { catalog, cleanup } = await loadMcpServersCatalog();
  try {
    const requiredServerNames = Object.entries(catalog)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        const e = entry as McpServerCatalogEntry;
        if (!isMcpCatalogEntryActive(e, hasFlag)) return false;
        return e.required === true;
      })
      .map(([name]) => name);

    const optionalServerNames = Object.entries(catalog)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        const e = entry as McpServerCatalogEntry;
        if (!isMcpCatalogEntryActive(e, hasFlag)) return false;
        return e.required !== true;
      })
      .map(([name]) => name);

    const inactiveByFlagServerNames = Object.entries(catalog)
      .filter(([, entry]) => {
        if (!entry || typeof entry !== "object") return false;
        return !isMcpCatalogEntryActive(entry as McpServerCatalogEntry, hasFlag);
      })
      .map(([name]) => name);

    const envMap = await parseProjectEnvFile(targetDir);
    const fallbackDashboardsUrl = envMap["DASHBOARDS_MCP_URL"] ?? getDashboardsMcpUrlFromFusebaseHost();
    const requiredToken = envMap["DASHBOARDS_MCP_TOKEN"];
    if (!requiredToken) {
      throw new Error(
        "Missing DASHBOARDS_MCP_TOKEN in project .env. Run `fusebase env create` first.",
      );
    }

    let customByName: Record<string, McpCustomIntegrationEntry> = readCustomIntegrationsMapSafe(
      targetDir,
    );
    const customNames = Object.keys(customByName);

    const inferredEnabledOptional = await inferEnabledOptionalServersFromIdeConfigs({
      targetDir,
      idePresets,
      optionalServerNames,
    });

    const shouldPrompt = options.interactive ?? process.stdin.isTTY;

    let selectedOptionalCatalog: Set<string>;
    if (shouldPrompt) {
      const selectedFromCheckbox = await checkbox({
        message: "Select MCP integrations (required are always enabled):",
        choices: [
          ...requiredServerNames.map((serverName) => ({
            name: serverName,
            value: serverName,
            checked: true,
            disabled: "required",
          })),
          ...optionalServerNames.map((serverName) => ({
            name: serverName,
            value: serverName,
            checked: inferredEnabledOptional.has(serverName),
          })),
          ...customNames.map((serverName) => ({
            name: `${serverName} (custom)`,
            value: serverName,
            checked: isCustomIntegrationEnabled(customByName[serverName]),
          })),
        ],
        theme: {
          style: {
            disabledChoice: (text: string) => {
              const cleaned = text.replace(/\s+required$/, "").trim();
              return ` ${styleText("green", figures.circleFilled)} ${cleaned}`;
            },
          },
        },
      });

      selectedOptionalCatalog = new Set(
        selectedFromCheckbox.filter((n) => optionalServerNames.includes(n)),
      );

      const selectedCustom = new Set(
        selectedFromCheckbox.filter((n) => customNames.includes(n)),
      );

      if (customNames.length) {
        try {
          const prev = readMcpIntegrationsFromFusebaseJson(targetDir);
          const mergedCustom = { ...(prev.custom ?? {}) };
          for (const name of customNames) {
            const entry = mergedCustom[name];
            if (!entry) continue;
            mergedCustom[name] = { ...entry, enabled: selectedCustom.has(name) };
          }
          writeMcpIntegrationsToFusebaseJson(targetDir, { ...prev, custom: mergedCustom });
          customByName = mergedCustom;
        } catch {
          // fusebase.json missing — skip persisting custom flags
        }
      }
    } else {
      selectedOptionalCatalog = inferredEnabledOptional;
    }

    await applyMcpIntegrationsSync({
      targetDir,
      idePresets,
      catalog,
      envMap,
      fallbackDashboardsUrl,
      requiredServerNames,
      optionalServerNames,
      inactiveByFlagServerNames,
      selectedOptionalCatalog,
      customByName,
    });

    const catalogOptionalEnabled = optionalServerNames.filter((n) => selectedOptionalCatalog.has(n));
    const customEnabled = Object.keys(customByName).filter((k) =>
      isCustomIntegrationEnabled(customByName[k]),
    );

    // eslint-disable-next-line no-console
    console.log(
      `✓ MCP integrations applied. Catalog optional: ${catalogOptionalEnabled.length ? catalogOptionalEnabled.join(", ") : "(none)"}${customEnabled.length ? ` | Custom: ${customEnabled.join(", ")}` : ""}`,
    );
  } finally {
    if (cleanup) await cleanup();
  }
}
