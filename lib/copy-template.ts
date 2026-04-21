import { cp, access, rm, readdir, readFile, writeFile } from "fs/promises";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { embeddedFiles } from "bun";
import AdmZip from "adm-zip";
import { hasFlag } from "./config";
import { buildTemplateContext, renderTemplateFile, renderTemplatesInDir } from "./template-engine";

// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const CUSTOM_BLOCK_BEGIN = "<!-- CUSTOM:SKILL:BEGIN -->";
const CUSTOM_BLOCK_END = "<!-- CUSTOM:SKILL:END -->";

async function collectMarkdownFilesRecursively(root: string): Promise<string[]> {
  if (!(await fileExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFilesRecursively(full)));
    } else if (entry.isFile() && full.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function extractCustomBlock(content: string): string | null {
  const begin = content.indexOf(CUSTOM_BLOCK_BEGIN);
  if (begin < 0) return null;
  const end = content.indexOf(CUSTOM_BLOCK_END, begin + CUSTOM_BLOCK_BEGIN.length);
  if (end < 0) return null;
  return content.slice(begin, end + CUSTOM_BLOCK_END.length);
}

function stripCustomBlock(content: string): string {
  const begin = content.indexOf(CUSTOM_BLOCK_BEGIN);
  if (begin < 0) return content;
  const end = content.indexOf(CUSTOM_BLOCK_END, begin + CUSTOM_BLOCK_BEGIN.length);
  if (end < 0) return content;
  const before = content.slice(0, begin).trimEnd();
  const after = content.slice(end + CUSTOM_BLOCK_END.length).trim();
  if (after.length > 0) {
    return `${before}\n\n${after}\n`;
  }
  return `${before}\n`;
}

function appendCustomBlock(content: string, block: string): string {
  const base = stripCustomBlock(content).trimEnd();
  return `${base}\n\n${block}\n`;
}

async function captureCustomBlocks(targetDir: string): Promise<Map<string, string>> {
  const blocks = new Map<string, string>();
  const agentsPath = join(targetDir, "AGENTS.md");
  if (await fileExists(agentsPath)) {
    const agents = await readFile(agentsPath, "utf-8");
    const block = extractCustomBlock(agents);
    if (block) {
      blocks.set("AGENTS.md", block);
    }
  }

  const skillsRoot = join(targetDir, ".claude", "skills");
  const mdFiles = await collectMarkdownFilesRecursively(skillsRoot);
  for (const file of mdFiles) {
    const content = await readFile(file, "utf-8");
    const block = extractCustomBlock(content);
    if (!block) continue;
    const rel = relative(targetDir, file).replace(/\\/g, "/");
    blocks.set(rel, block);
  }

  return blocks;
}

async function restoreCustomBlocks(targetDir: string, blocks: Map<string, string>): Promise<void> {
  for (const [relPath, block] of blocks.entries()) {
    const absPath = join(targetDir, relPath);
    if (!(await fileExists(absPath))) continue;
    const current = await readFile(absPath, "utf-8");
    const next = appendCustomBlock(current, block);
    if (next !== current) {
      await writeFile(absPath, next, "utf-8");
    }
  }
}

/** Skills that require a specific flag to be included. */
const FLAG_GATED_SKILLS: Record<string, string> = {
  "git-workflow": "git-init",
  "app-business-docs": "app-business-docs",
  "mcp-gate-debug": "mcp-gate-debug",
  "feature-sidecar": "sidecar",
};

/** Template paths that require a specific flag to be included. */
const FLAG_GATED_PATH_PREFIXES: Record<string, string> = {
  ".claude/skills/fusebase-gate/references/isolated.md": "isolated-stores",
  ".claude/skills/fusebase-gate/references/isolated-nosql.md": "isolated-stores",
  ".claude/skills/fusebase-gate/references/isolated-sql.md": "isolated-stores",
  ".claude/skills/fusebase-gate/references/isolated-sql-stores.md": "isolated-stores",
  ".claude/skills/fusebase-gate/references/isolated-sql-migration-discipline.md": "isolated-stores",
};

/**
 * Check whether a zip entry path should be skipped based on flag-gated skills.
 */
function shouldSkipEntry(name: string): boolean {
  for (const [skill, flag] of Object.entries(FLAG_GATED_SKILLS)) {
    if (skill === "git-workflow") {
      const enabled = hasFlag("git-init") || hasFlag("git-debug-commits");
      if (name.startsWith(`.claude/skills/${skill}/`) && !enabled) {
        return true;
      }
      continue;
    }
    if (name.startsWith(`.claude/skills/${skill}/`) && !hasFlag(flag)) {
      return true;
    }
  }
  for (const [pathPrefix, flag] of Object.entries(FLAG_GATED_PATH_PREFIXES)) {
    if (name.startsWith(pathPrefix) && !hasFlag(flag)) {
      return true;
    }
  }
  return false;
}

/**
 * Copy AGENTS.md, .claude/skills/, .claude/agents/, .claude/hooks/ and .claude/settings.json from project-template to targetDir.
 * Works in both development (copy from disk) and binary (extract from embedded zip) modes.
 * After copying, renders Eta templates based on active flags.
 */
export async function copyAgentsAndSkills(targetDir: string): Promise<void> {
  const customBlocks = await captureCustomBlocks(targetDir);

  // Check for obsolete ./skills folder
  const obsoleteSkillsPath = join(targetDir, "skills");
  if (await fileExists(obsoleteSkillsPath)) {
    console.warn("⚠️  Warning: The './skills' folder is obsolete and should be deleted.");
    console.warn("   Skills are now stored in '.claude/skills/' instead.");
  }

  const zipFile = embeddedFiles.find(
    (f) => (f as { name?: string }).name?.includes("project-template") && (f as { name?: string }).name?.endsWith(".zip")
  );

  if (zipFile) {
    const zipData = await zipFile.arrayBuffer();
    const zip = new AdmZip(Buffer.from(zipData));
    const entries = zip.getEntries();
    const normalized = (name: string) => name.replace(/\\/g, "/");
    for (const entry of entries) {
      const name = normalized(entry.entryName);
      if (shouldSkipEntry(name)) continue;
      if (name === "AGENTS.md" || name.startsWith(".claude/skills/") || name.startsWith(".claude/agents/") || name.startsWith(".claude/hooks/") || name === ".claude/settings.json") {
        zip.extractEntryTo(entry, targetDir, true, true);
      }
    }
  } else {
    const templateDir = join(__dirname, "..", "project-template");
    const agentsMdSrc = join(templateDir, "AGENTS.md");
    const skillsSrc = join(templateDir, ".claude", "skills");
    const agentsSrc = join(templateDir, ".claude", "agents");
    const hooksSrc = join(templateDir, ".claude", "hooks");
    const settingsSrc = join(templateDir, ".claude", "settings.json");
    const agentsMdDest = join(targetDir, "AGENTS.md");
    const skillsDest = join(targetDir, ".claude", "skills");
    const agentsDest = join(targetDir, ".claude", "agents");
    const hooksDest = join(targetDir, ".claude", "hooks");
    const settingsDest = join(targetDir, ".claude", "settings.json");

    if (await fileExists(agentsMdSrc)) {
      await cp(agentsMdSrc, agentsMdDest, { force: true });
    }
    if (await fileExists(skillsSrc)) {
      await cp(skillsSrc, skillsDest, { recursive: true, force: true });
    }
    if (await fileExists(agentsSrc)) {
      await cp(agentsSrc, agentsDest, { recursive: true, force: true });
    }
    if (await fileExists(hooksSrc)) {
      await cp(hooksSrc, hooksDest, { recursive: true, force: true });
    }
    if (await fileExists(settingsSrc)) {
      await cp(settingsSrc, settingsDest, { force: true });
    }

    // Remove flag-gated skill directories that shouldn't be present
    for (const [skill, flag] of Object.entries(FLAG_GATED_SKILLS)) {
      if (skill === "git-workflow") {
        const enabled = hasFlag("git-init") || hasFlag("git-debug-commits");
        if (!enabled) {
          const skillDir = join(skillsDest, skill);
          if (await fileExists(skillDir)) {
            await rm(skillDir, { recursive: true, force: true });
          }
        }
        continue;
      }
      if (!hasFlag(flag)) {
        const skillDir = join(skillsDest, skill);
        if (await fileExists(skillDir)) {
          await rm(skillDir, { recursive: true, force: true });
        }
      }
    }

    // Remove flag-gated files that shouldn't be present
    for (const [pathPrefix, flag] of Object.entries(FLAG_GATED_PATH_PREFIXES)) {
      if (!hasFlag(flag)) {
        const relativePath = pathPrefix.replace(".claude/skills/", "");
        const targetPath = join(skillsDest, relativePath);
        if (await fileExists(targetPath)) {
          await rm(targetPath, { recursive: true, force: true });
        }
      }
    }
  }

  // Render Eta templates based on active flags
  const context = buildTemplateContext();
  renderTemplateFile(join(targetDir, "AGENTS.md"), context);
  renderTemplatesInDir(join(targetDir, ".claude", "skills"), context);

  if (customBlocks.size > 0) {
    await restoreCustomBlocks(targetDir, customBlocks);
  }
}
