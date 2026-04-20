/**
 * IDE Setup Step
 *
 * Copies MCP configuration files for various IDEs/editors.
 * Source: ide-configs/ folder (separate from project-template)
 */

import { access, readdir, mkdir, cp, stat, chmod, rm, readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { select } from "@inquirer/prompts";
import { embeddedFiles } from "bun";
import AdmZip from "adm-zip";
import { getFusebaseHost, hasFlag } from "../../config";
import { isMcpCatalogEntryActive } from "../../mcp-catalog";
import {
  applyMcpServersToIdeConfigJson,
  mergeProjectClaudeCodeMcpJsonAllowlistInSettings,
} from "../../ide-mcp-config";
import { applyMcpServersToCodexConfigToml } from "../../codex-mcp-config";
import { pathToFileURL } from "url";
import type { McpServerCatalogEntry } from "../../../ide-configs/mcp-servers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// IDE preset types (single choice)
export type IdePreset = "claude-code" | "cursor" | "vscode" | "opencode" | "codex" | "other";

// IDE asset mappings: source folder in ide-configs/ -> files to copy
interface IdeAssetConfig {
  sourceFolder: string; // folder inside ide-configs/
  files: {
    source: string; // relative to sourceFolder
    target: string; // relative to project root
  }[];
  description: string; // human-readable description
  instructions?: string; // post-copy instructions
}

const IDE_CONFIGS: Record<IdePreset, IdeAssetConfig> = {
  "claude-code": {
    sourceFolder: "",
    files: [{ source: "mcp-servers.ts", target: ".mcp.json" }],
    description: "Claude Code CLI - repo root config",
  },
  cursor: {
    sourceFolder: "",
    files: [{ source: "mcp-servers.ts", target: ".cursor/mcp.json" }],
    description: "Cursor IDE - project-level MCP config",
  },
  vscode: {
    sourceFolder: "",
    files: [{ source: "mcp-servers.ts", target: ".vscode/mcp.json" }],
    description: "VS Code - workspace MCP config",
  },
  opencode: {
    sourceFolder: "",
    files: [{ source: "mcp-servers.ts", target: "opencode.json" }],
    description: "OpenCode - project root config",
  },
  codex: {
    sourceFolder: "",
    files: [{ source: "mcp-servers.ts", target: ".codex/config.toml" }],
    description: "Codex CLI - project .codex/config.toml",
  },
  other: {
    sourceFolder: "",
    files: [{ source: "mcp-servers.ts", target: "mcp_example.json" }],
    description: "Other IDE (Antigravity, WebStorm, Claude Desktop, etc.) - example MCP config",
  },
};

const IDE_PRESET_ORDER: IdePreset[] = [
  "claude-code",
  "cursor",
  "vscode",
  "opencode",
  "codex",
  "other",
];

const IDE_PRESET_MCP_DISPLAY_NAME: Record<IdePreset, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  vscode: "VS Code",
  opencode: "OpenCode",
  codex: "Codex",
  other: "Other IDEs (mcp_example.json)",
};

/** Human-readable list of IDE targets for MCP status lines (stable order). */
export function formatIdePresetsForMcpSummary(presets: Set<IdePreset>): string {
  return IDE_PRESET_ORDER.filter((p) => presets.has(p)).map((p) => IDE_PRESET_MCP_DISPLAY_NAME[p]).join(", ");
}

export interface CopyResult {
  copied: string[];
  skipped: string[];
  notFound: string[];
}

export interface IdeSetupResult {
  scripts: CopyResult;
  ide: CopyResult;
  instructions: string[];
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
 * Resolve single IDE preset from input string (takes first valid value)
 */
export function resolveIdePresets(input?: string): Set<IdePreset> {
  if (!input) {
    return new Set<IdePreset>();
  }

  const validPresets = new Set<IdePreset>(["claude-code", "cursor", "vscode", "opencode", "codex", "other"]);
  const trimmed = input.toLowerCase().trim() as IdePreset;
  if (validPresets.has(trimmed)) {
    return new Set([trimmed]);
  }
  return new Set<IdePreset>();
}

/**
 * Legacy helper: interactive IDE selection.
 * Current CLI defaults to generating configs for all IDEs unless `--ide` is provided.
 */
export async function promptIdeSelection(): Promise<Set<IdePreset>> {
  const selected = await select({
    message: "Select IDE configuration to set up:",
    choices: [
      { name: "Claude Code - repo root .mcp.json", value: "claude-code" as IdePreset },
      { name: "Cursor - project-level MCP config", value: "cursor" as IdePreset },
      { name: "VS Code - workspace MCP config", value: "vscode" as IdePreset },
      { name: "OpenCode - project root opencode.json", value: "opencode" as IdePreset },
      { name: "Codex - project .codex/config.toml", value: "codex" as IdePreset },
      { name: "Other (Antigravity, WebStorm, Claude Desktop, etc.) - mcp_example.json", value: "other" as IdePreset },
    ],
  });

  return new Set([selected]);
}

/**
 * Copy a file or directory if source exists, with overwrite control
 */
async function copyIfExists(
  src: string,
  dest: string,
  options: { force: boolean; recursive: boolean }
): Promise<"copied" | "skipped" | "not-found"> {
  if (!(await fileExists(src))) {
    return "not-found";
  }

  if (await fileExists(dest)) {
    if (!options.force) {
      return "skipped";
    }
  }

  await mkdir(dirname(dest), { recursive: true });

  if (options.recursive) {
    await cp(src, dest, { recursive: true, force: options.force });
  } else {
    await cp(src, dest, { force: options.force });
  }

  // Preserve executable permissions
  if (!options.recursive) {
    try {
      const srcStat = await stat(src);
      await chmod(dest, srcStat.mode);
    } catch {
      // Ignore permission errors
    }
  }

  return "copied";
}

function getDashboardsMcpUrlFromFusebaseHost(): string {
  return `https://dashboards-mcp.${getFusebaseHost()}/mcp`;
}

async function parseProjectMcpEnvVars(targetDir: string): Promise<{
  token?: string;
  url?: string;
}> {
  const envPath = join(targetDir, ".env");
  try {
    const content = await readFile(envPath, "utf-8");
    const tokenMatch = content.match(/DASHBOARDS_MCP_TOKEN\s*=\s*(["']?)([^\s#"']+)\1/);
    const urlMatch = content.match(/DASHBOARDS_MCP_URL\s*=\s*(["']?)([^\s#"']+)\1/);
    return {
      token: tokenMatch?.[2]?.trim() ?? undefined,
      url: urlMatch?.[2]?.trim() ?? undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Parse a project `.env` into a key/value map.
 */
function parseProjectEnvFileToMap(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) env[key] = value;
  }
  return env;
}

async function parseProjectEnvFile(targetDir: string): Promise<Record<string, string>> {
  const envPath = join(targetDir, ".env");
  try {
    const content = await readFile(envPath, "utf-8");
    return parseProjectEnvFileToMap(content);
  } catch {
    return {};
  }
}

/**
 * Deeply replace placeholder strings like `{{SOME_KEY}}` in an object/array tree.
 */
function replacePlaceholdersInTree<T>(
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

function isMcpConfigTarget(target: string): boolean {
  return (
    target === ".cursor/mcp.json" ||
    target === ".vscode/mcp.json" ||
    target === ".mcp.json" ||
    target === "opencode.json" ||
    target === "mcp_example.json" ||
    target === ".codex/config.toml"
  );
}

/**
 * Copy scripts directory, preserving permissions
 */
async function copyScriptsDirectory(ideConfigsDir: string, targetDir: string, force: boolean): Promise<CopyResult> {
  const result: CopyResult = { copied: [], skipped: [], notFound: [] };
  const srcScripts = join(ideConfigsDir, "scripts");
  const destScripts = join(targetDir, "scripts");

  if (!(await fileExists(srcScripts))) {
    result.notFound.push("scripts/");
    return result;
  }

  await mkdir(destScripts, { recursive: true });

  try {
    const files = await readdir(srcScripts);
    for (const file of files) {
      const srcFile = join(srcScripts, file);
      const destFile = join(destScripts, file);
      const copyResult = await copyIfExists(srcFile, destFile, { force, recursive: false });

      const relativePath = `scripts/${file}`;
      if (copyResult === "copied") {
        result.copied.push(relativePath);
        try {
          const srcStat = await stat(srcFile);
          await chmod(destFile, srcStat.mode);
        } catch {
          // Ignore
        }
      } else if (copyResult === "skipped") {
        result.skipped.push(relativePath);
      }
    }
  } catch {
    result.notFound.push("scripts/");
  }

  return result;
}

const MCP_GITIGNORE_EXAMPLE = ".gitignore.example";

/**
 * Ensure project .gitignore includes all MCP config paths from ide-configs/.gitignore.example.
 * Reads the example, checks which lines are missing in the project .gitignore, appends only those.
 */
async function ensureMcpConfigInGitignore(ideConfigsDir: string, targetDir: string): Promise<void> {
  const examplePath = join(ideConfigsDir, MCP_GITIGNORE_EXAMPLE);
  if (!(await fileExists(examplePath))) {
    return;
  }
  const exampleContent = await readFile(examplePath, "utf-8");
  const exampleLines = exampleContent
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let projectContent = "";
  const gitignorePath = join(targetDir, ".gitignore");
  try {
    projectContent = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  const missingLines = exampleLines.filter((line) => !projectContent.includes(line));
  if (missingLines.length === 0) {
    return;
  }

  const suffix = (projectContent.trimEnd() ? "\n" : "") + "\n" + missingLines.join("\n") + "\n";
  await writeFile(gitignorePath, projectContent.trimEnd() + suffix, "utf-8");
}

/**
 * Copy IDE-specific assets based on selected presets
 */
async function copyIdeAssets(
  ideConfigsDir: string,
  targetDir: string,
  presets: Set<IdePreset>,
  force: boolean
): Promise<{ result: CopyResult; instructions: string[] }> {
  const result: CopyResult = { copied: [], skipped: [], notFound: [] };
  const instructions: string[] = [];

  for (const preset of presets) {
    const config = IDE_CONFIGS[preset];

    for (const file of config.files) {
      // For "other" preset, source is directly in ide-configs/
      const src = config.sourceFolder
        ? join(ideConfigsDir, config.sourceFolder, file.source)
        : join(ideConfigsDir, file.source);
      const dest = join(targetDir, file.target);

      if (!(await fileExists(src))) {
        result.notFound.push(file.source);
        continue;
      }
      if ((await fileExists(dest)) && !force) {
        result.skipped.push(file.target);
        continue;
      }

      await mkdir(dirname(dest), { recursive: true });

      if (isMcpConfigTarget(file.target)) {
        // `ide-configs/mcp-servers.ts` is a typed module exporting the catalog.
        // We dynamic-import it from the resolved `ideConfigsDir` (dev or binary temp extraction).
        const catalogMod = await import(pathToFileURL(src).href);
        const catalog =
          (catalogMod.MCP_SERVERS_CATALOG as Record<string, unknown> | undefined) ??
          (catalogMod.default as Record<string, unknown> | undefined);
        if (!catalog) {
          throw new Error(`Failed to load MCP servers catalog from: ${src}`);
        }

        const envMap = await parseProjectEnvFile(targetDir);
        const fallbackDashboardsUrl = envMap["DASHBOARDS_MCP_URL"] ?? getDashboardsMcpUrlFromFusebaseHost();

        const getReplacement = (key: string): string | undefined => {
          if (key === "DASHBOARDS_MCP_URL") return fallbackDashboardsUrl;
          if (key === "DASHBOARDS_MCP_TOKEN") return envMap["DASHBOARDS_MCP_TOKEN"];
          return envMap[key];
        };

        // Flag gate first; then only active required servers.
        const requiredAdd: Record<string, unknown> = {};
        for (const [serverName, serverValue] of Object.entries(catalog)) {
          if (!serverValue || typeof serverValue !== "object") continue;
          const v = serverValue as McpServerCatalogEntry;
          if (!isMcpCatalogEntryActive(v, hasFlag)) continue;
          if (v.required !== true) continue;
          const { required: _required, flag: _flag, ...spec } = v;
          requiredAdd[serverName] = spec;
        }

        const resolvedRequiredAdd = replacePlaceholdersInTree(requiredAdd, getReplacement);

        // Warn if some placeholders couldn't be resolved from `.env`.
        for (const [serverName, spec] of Object.entries(resolvedRequiredAdd)) {
          const unresolvedKeys = collectPlaceholderKeys(spec);
          if (unresolvedKeys.size > 0) {
            console.warn(
              `⚠ MCP: unresolved placeholders for required server "${serverName}" (missing from .env): ${Array.from(
                unresolvedKeys,
              ).join(", ")}`,
            );
          }
        }

        // Preserve optional servers already present in the target file.
        let existingJson: unknown = undefined;
        if (await fileExists(dest)) {
          try {
            const destRaw = await readFile(dest, "utf-8");
            existingJson = JSON.parse(destRaw);
          } catch {
            // Ignore invalid JSON and re-generate required-only content.
            existingJson = undefined;
          }
        }

        if (file.target === ".codex/config.toml") {
          let existingToml: string | undefined;
          if (await fileExists(dest)) {
            try {
              existingToml = await readFile(dest, "utf-8");
            } catch {
              existingToml = undefined;
            }
          }
          const out = applyMcpServersToCodexConfigToml({
            existingToml,
            add: resolvedRequiredAdd as any,
            remove: [],
          });
          await writeFile(dest, out, "utf-8");
        } else {
          const { json } = applyMcpServersToIdeConfigJson({
            ide: preset,
            existingJson,
            add: resolvedRequiredAdd as any,
          });

          await writeFile(dest, JSON.stringify(json, null, 2) + "\n", "utf-8");
        }
      } else {
        await cp(src, dest, { force: true });
        try {
          const srcStat = await stat(src);
          await chmod(dest, srcStat.mode);
        } catch {
          // Ignore
        }
      }

      result.copied.push(file.target);
      if (config.instructions && !instructions.includes(config.instructions)) {
        instructions.push(config.instructions);
      }
    }
  }

  if (presets.has("claude-code")) {
    try {
      await mergeProjectClaudeCodeMcpJsonAllowlistInSettings(targetDir);
    } catch (err) {
      console.warn("⚠ Could not sync Claude Code MCP allowlist (.claude/settings.json):", err);
    }
  }

  return { result, instructions };
}

/**
 * Get the ide-configs directory path.
 * In binary mode, extracts from embedded zip to temp directory.
 * In dev mode, returns the ide-configs directory path.
 */
export async function getIdeConfigsDir(): Promise<{
  path: string;
  isBinaryMode: boolean;
  cleanup?: () => Promise<void>;
}> {
  const zipFile = embeddedFiles.find(
    (f: { name?: string; arrayBuffer: () => Promise<ArrayBuffer> }) =>
      f.name?.includes("ide-configs") && f.name?.endsWith(".zip"),
  );

  if (zipFile) {
    // Binary mode - extract to temp directory
    const tempDir = join(tmpdir(), `fusebase-ide-configs-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const zipData = await zipFile.arrayBuffer();
    const zip = new AdmZip(Buffer.from(zipData));
    zip.extractAllTo(tempDir, true);

    return {
      path: tempDir,
      isBinaryMode: true,
      cleanup: async () => {
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  } else {
    // Development mode - use ide-configs directory
    return {
      path: join(__dirname, "..", "..", "..", "ide-configs"),
      isBinaryMode: false,
    };
  }
}

/**
 * Print copy results summary.
 * @param presets When set (e.g. from `setupIdeConfig`), prints which IDEs got required MCP config.
 */
export function printIdeSetupResults(result: IdeSetupResult, presets?: Set<IdePreset>): void {
  const allCopied = [...result.scripts.copied, ...result.ide.copied];
  const allSkipped = [...result.scripts.skipped, ...result.ide.skipped];

  if (allCopied.length > 0) {
    console.log(`✓ Copied: ${allCopied.join(", ")}`);
  }

  if (allSkipped.length > 0) {
    console.log(`⚠ Skipped (already exist, use --force to overwrite): ${allSkipped.join(", ")}`);
  }

  if (presets && presets.size > 0) {
    console.log(`✓ Required MCP configured for: ${formatIdePresetsForMcpSummary(presets)}.`);
    console.log("  Optional servers: run `fusebase integrations` to add from the catalog.");
  }

  if (result.instructions.length > 0) {
    console.log("\nAdditional setup instructions:");
    for (const instruction of result.instructions) {
      console.log(instruction);
    }
  }
}

export interface SetupIdeConfigOptions {
  targetDir: string;
  presets: Set<IdePreset>;
  force: boolean;
  /** Optional: provide ide-configs dir directly */
  ideConfigsDir?: string;
}

/**
 * Set up IDE configurations in target directory
 *
 * - Always copies scripts/ directory (MCP bridge)
 * - Copies IDE-specific config files based on selected presets
 */
export async function setupIdeConfig(options: SetupIdeConfigOptions): Promise<IdeSetupResult> {
  const { targetDir, presets, force } = options;

  let ideConfigsDir = options.ideConfigsDir;
  let cleanup: (() => Promise<void>) | undefined;

  if (!ideConfigsDir) {
    const configsInfo = await getIdeConfigsDir();
    ideConfigsDir = configsInfo.path;
    cleanup = configsInfo.cleanup;
  }

  try {
    // Always copy scripts/ directory (optional; may be absent when using HTTP-only configs)
    const scriptsResult = await copyScriptsDirectory(ideConfigsDir, targetDir, force);

    // Copy IDE-specific assets based on selected presets
    const { result: ideResult, instructions } = await copyIdeAssets(ideConfigsDir, targetDir, presets, force);

    // Ensure MCP config files are gitignored (they contain token)
    if (presets.size > 0) {
      await ensureMcpConfigInGitignore(ideConfigsDir, targetDir);
    }

    return {
      scripts: scriptsResult,
      ide: ideResult,
      instructions,
    };
  } finally {
    if (cleanup) {
      await cleanup();
    }
  }
}