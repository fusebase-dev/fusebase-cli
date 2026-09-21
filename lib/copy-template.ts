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
const CUSTOM_BLOCK_REGEX =
  /<!-- CUSTOM:SKILL:BEGIN -->[\s\S]*?<!-- CUSTOM:SKILL:END -->/g;

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

function stripAllCustomBlocks(content: string): string {
  return content.replace(CUSTOM_BLOCK_REGEX, "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Content between the custom markers, without the markers themselves. */
function customBlockBody(block: string): string {
  const start = block.indexOf(CUSTOM_BLOCK_BEGIN);
  const end = block.lastIndexOf(CUSTOM_BLOCK_END);
  if (start < 0 || end < 0) return block;
  return block.slice(start + CUSTOM_BLOCK_BEGIN.length, end);
}

function normalizeForComparison(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Whether the block's content is already present in `content`.
 *
 * A project's custom block often gets promoted into the skill template itself,
 * where it ships as plain markdown without the custom markers. Restoring the
 * captured block on top of that would duplicate the text, so compare bodies
 * rather than whole marker-delimited blocks.
 */
function containsCustomBlockContent(content: string, block: string): boolean {
  const body = normalizeForComparison(customBlockBody(block));
  if (!body) return false;
  return normalizeForComparison(content).includes(body);
}

function nonEmptyLineBefore(content: string, index: number): string | null {
  const before = content.slice(0, index);
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line) return line;
  }
  return null;
}

function nonEmptyLineAfter(content: string, index: number): string | null {
  const after = content.slice(index);
  const lines = after.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line) return line;
  }
  return null;
}

export type CapturedCustomBlock = {
  content: string;
  beforeLine: string | null;
  afterLine: string | null;
};


/**
 * Sections the template itself once shipped inside a custom block and that managed
 * guidance has since replaced. Dropped on update only when the app's block still holds
 * the shipped text verbatim, so app-authored edits and additions survive untouched.
 */
const SUPERSEDED_TEMPLATE_SECTIONS = [
  // Replaced by the "Flow Selection" section of file-upload/references/upload-lifecycle.md,
  // which makes the presigned single PUT the default for non-note uploads (NIM-43290).
  [
    "## Flow Selection Rule",
    "",
    "- Use the `web-editor/file/v2-upload` -> `bucket-files/create-relative` flow for files uploaded as note attachments.",
    "- Use the Gate `startMultipartFileUpload` -> direct `PUT` -> `completeMultipartFileUpload` flow for non-note file uploads.",
    "- When a note needs a readable image/file URL after upload, keep the note attachment lifecycle on the web-editor flow and use the resulting file descriptor or URL returned by that flow.",
  ].join("\n"),
];

function dropSupersededTemplateSections(block: string): string {
  const normalized = block.replace(/\r\n/g, "\n");
  let next = normalized;
  for (const section of SUPERSEDED_TEMPLATE_SECTIONS) {
    next = next.replace(`${section}\n\n`, "").replace(section, "");
  }
  return next === normalized ? block : next;
}

function extractCustomBlocks(content: string): CapturedCustomBlock[] {
  const matches = [...content.matchAll(CUSTOM_BLOCK_REGEX)];
  return matches.map((match) => {
    const start = match.index ?? 0;
    const block = match[0];
    const end = start + block.length;
    return {
      content: dropSupersededTemplateSections(block),
      beforeLine: nonEmptyLineBefore(content, start),
      afterLine: nonEmptyLineAfter(content, end),
    };
  });
}

function insertBlockBetweenAnchors(
  baseContent: string,
  block: CapturedCustomBlock,
): { content: string; inserted: boolean } {
  const { beforeLine, afterLine } = block;
  if (!beforeLine && !afterLine) return { content: baseContent, inserted: false };

  const beforeIdx = beforeLine ? baseContent.indexOf(beforeLine) : -1;
  const afterIdx = afterLine ? baseContent.indexOf(afterLine) : -1;

  if (beforeIdx >= 0 && afterIdx >= 0 && beforeIdx < afterIdx) {
    const insertAt = beforeIdx + beforeLine!.length;
    const next =
      baseContent.slice(0, insertAt) +
      `\n\n${block.content}\n\n` +
      baseContent.slice(insertAt);
    return { content: next, inserted: true };
  }

  if (beforeIdx >= 0) {
    const insertAt = beforeIdx + beforeLine!.length;
    const next =
      baseContent.slice(0, insertAt) +
      `\n\n${block.content}\n` +
      baseContent.slice(insertAt);
    return { content: next, inserted: true };
  }

  if (afterIdx >= 0) {
    const next =
      baseContent.slice(0, afterIdx) +
      `${block.content}\n\n` +
      baseContent.slice(afterIdx);
    return { content: next, inserted: true };
  }

  return { content: baseContent, inserted: false };
}

export function mergeCustomBlocks(content: string, blocks: CapturedCustomBlock[]): string {
  let merged = stripAllCustomBlocks(content).trimEnd();
  for (const block of blocks) {
    // The template may already ship this text (as plain markdown, or because an
    // earlier captured block carried the same content) — don't restore a copy.
    if (containsCustomBlockContent(merged, block.content)) continue;
    const attempt = insertBlockBetweenAnchors(merged, block);
    if (attempt.inserted) {
      merged = attempt.content.trimEnd();
      continue;
    }
    merged = `${merged}\n\n${block.content}`.trimEnd();
  }
  return `${merged}\n`;
}

type OptionalSkillAudience = "dbManagement" | "dashboardManagement";

function parseAudiencesFromFrontmatter(content: string): OptionalSkillAudience[] {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatterMatch) {
    return [];
  }

  const audiencesLine = frontmatterMatch[1]
    .split(/\r?\n/)
    .find((line) => line.startsWith("audiences: "));
  if (!audiencesLine) {
    return [];
  }

  const rawValue = audiencesLine.slice("audiences: ".length).trim();
  try {
    const parsed: unknown = JSON.parse(rawValue);
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is OptionalSkillAudience =>
            value === "dbManagement" || value === "dashboardManagement",
        )
      : [];
  } catch {
    return [];
  }
}

async function captureCustomBlocks(targetDir: string): Promise<Map<string, CapturedCustomBlock[]>> {
  const blocks = new Map<string, CapturedCustomBlock[]>();
  const agentsPath = join(targetDir, "AGENTS.md");
  if (await fileExists(agentsPath)) {
    const agents = await readFile(agentsPath, "utf-8");
    const extracted = extractCustomBlocks(agents);
    if (extracted.length > 0) {
      blocks.set("AGENTS.md", extracted);
    }
  }

  const skillsRoot = join(targetDir, ".claude", "skills");
  const mdFiles = await collectMarkdownFilesRecursively(skillsRoot);
  for (const file of mdFiles) {
    const content = await readFile(file, "utf-8");
    const extracted = extractCustomBlocks(content);
    if (extracted.length === 0) continue;
    const rel = relative(targetDir, file).replace(/\\/g, "/");
    blocks.set(rel, extracted);
  }

  return blocks;
}

async function restoreCustomBlocks(
  targetDir: string,
  blocks: Map<string, CapturedCustomBlock[]>,
): Promise<void> {
  for (const [relPath, fileBlocks] of blocks.entries()) {
    const absPath = join(targetDir, relPath);
    if (!(await fileExists(absPath))) continue;
    const current = await readFile(absPath, "utf-8");
    const next = mergeCustomBlocks(current, fileBlocks);
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
  "fusebase-portal-specific-apps": "portal-specific-apps",
  "managed-integrations": "managed-integrations",
  "app-api-contract-testing": "cross-app-api-calls-analysis",
};

/** Template paths that require a specific flag to be included. */
const FLAG_GATED_PATH_PREFIXES: Record<string, string> = {
  ".claude/skills/managed-integrations/references/personal-auth-flow.md":
    "managed-integrations-personal-auth",
  "examples/isolated-sql-rls": "postgres-rls",
};

function normalizeTemplateEntryPath(name: string): string {
  const normalized = name.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("project-template/")
    ? normalized.slice("project-template/".length)
    : normalized;
}

/**
 * Check whether a zip entry path should be skipped based on flag-gated skills.
 */
function shouldSkipEntry(name: string): boolean {
  const entryPath = normalizeTemplateEntryPath(name);
  for (const [skill, flag] of Object.entries(FLAG_GATED_SKILLS)) {
    if (skill === "git-workflow") {
      const enabled = hasFlag("git-init") || hasFlag("git-debug-commits");
      if (entryPath.startsWith(`.claude/skills/${skill}/`) && !enabled) {
        return true;
      }
      continue;
    }
    if (entryPath.startsWith(`.claude/skills/${skill}/`) && !hasFlag(flag)) {
      return true;
    }
  }
  for (const [pathPrefix, flag] of Object.entries(FLAG_GATED_PATH_PREFIXES)) {
    if (entryPath.startsWith(pathPrefix) && !hasFlag(flag)) {
      return true;
    }
  }
  return false;
}

async function removeDisabledFlagGatedAssets(skillsDest: string): Promise<void> {
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

async function pruneDisabledOptionalDashboardRefs(skillsDest: string): Promise<void> {
  const dashboardsSkillDir = join(skillsDest, "fusebase-dashboards");
  const referencesDir = join(dashboardsSkillDir, "references");
  if (!(await fileExists(referencesDir))) {
    return;
  }

  const enabledAudiences = new Set<OptionalSkillAudience>();
  if (hasFlag("legacy-dashboards-db")) {
    enabledAudiences.add("dbManagement");
  }

  const entries = await readdir(referencesDir, { withFileTypes: true });
  const removedReferenceFiles: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const refPath = join(referencesDir, entry.name);
    const content = await readFile(refPath, "utf-8");
    const audiences = parseAudiencesFromFrontmatter(content);
    const shouldRemove = audiences.some((audience) => !enabledAudiences.has(audience));
    if (!shouldRemove) {
      continue;
    }
    await rm(refPath, { force: true });
    removedReferenceFiles.push(entry.name);
  }

  if (removedReferenceFiles.length === 0) {
    return;
  }

  const skillPath = join(dashboardsSkillDir, "SKILL.md");
  if (!(await fileExists(skillPath))) {
    return;
  }

  const skillContent = await readFile(skillPath, "utf-8");
  const filteredSkillContent = skillContent
    .split(/\r?\n/)
    .filter(
      (line) =>
        !removedReferenceFiles.some((file) => line.includes(`references/${file}`)),
    )
    .join("\n");
  await writeFile(skillPath, filteredSkillContent, "utf-8");
}

/**
 * Copy AGENTS.md, .claude/skills/, .claude/agents/, .claude/hooks/ and .claude/settings.json from project-template to targetDir.
 * Works in both development (copy from disk) and binary (extract from embedded zip) modes.
 * After copying, renders Eta templates based on active flags.
 */
export async function copyAgentsAndSkills(targetDir: string): Promise<void> {
  const customBlocks = await captureCustomBlocks(targetDir);
  const skillsDest = join(targetDir, ".claude", "skills");

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
    for (const entry of entries) {
      const name = normalizeTemplateEntryPath(entry.entryName);
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

  }

  // Ensure flag-gated assets are removed even if template content was copied earlier
  // (for example init's full template extraction in binary mode).
  await removeDisabledFlagGatedAssets(skillsDest);
  await pruneDisabledOptionalDashboardRefs(skillsDest);

  // Render Eta templates based on active flags
  const context = buildTemplateContext();
  renderTemplateFile(join(targetDir, "AGENTS.md"), context);
  renderTemplateFile(join(targetDir, "CLAUDE.md"), context);
  renderTemplateFile(join(targetDir, ".claude", "settings.json"), context);
  renderTemplatesInDir(join(targetDir, ".claude", "skills"), context);
  renderTemplatesInDir(join(targetDir, ".claude", "agents"), context);
  renderTemplatesInDir(join(targetDir, ".claude", "hooks"), context);

  if (customBlocks.size > 0) {
    await restoreCustomBlocks(targetDir, customBlocks);
  }
}
