import { cp, access, rm } from "fs/promises";
import { join, dirname } from "path";
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

/** Skills that require a specific flag to be included. */
const FLAG_GATED_SKILLS: Record<string, string> = {};

/**
 * Check whether a zip entry path should be skipped based on flag-gated skills.
 */
function shouldSkipEntry(name: string): boolean {
  for (const [skill, flag] of Object.entries(FLAG_GATED_SKILLS)) {
    if (name.startsWith(`.claude/skills/${skill}/`) && !hasFlag(flag)) {
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
      if (!hasFlag(flag)) {
        const skillDir = join(skillsDest, skill);
        if (await fileExists(skillDir)) {
          await rm(skillDir, { recursive: true, force: true });
        }
      }
    }
  }

  // Render Eta templates based on active flags
  const context = buildTemplateContext();
  renderTemplateFile(join(targetDir, "AGENTS.md"), context);
  renderTemplatesInDir(join(targetDir, ".claude", "skills"), context);
}
