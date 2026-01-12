import { Command } from "commander";
import { join } from "path";
import { access } from "fs/promises";
import { copyAgentsAndSkills } from "../copy-template";

const FUSE_JSON = "fusebase.json";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export const skillsCommand = new Command("skills")
  .description("Manage project-template AGENTS.md and skills in the app");

skillsCommand
  .command("update")
  .description("Overwrite AGENTS.md, .claude/skills/, .claude/hooks/ and .claude/settings.json in the current app with the latest")
  .action(async () => {
    const cwd = process.cwd();
    const fuseJsonPath = join(cwd, FUSE_JSON);

    if (!(await fileExists(fuseJsonPath))) {
      console.error("Error: App not initialized. Run 'fusebase init' first or run from a project with fusebase.json.");
      process.exit(1);
    }

    try {
      await copyAgentsAndSkills(cwd);
      console.log("✓ Updated AGENTS.md, .claude/skills, .claude/hooks and .claude/settings.json");
    } catch (error) {
      console.error("Error: Failed to update AGENTS.md, .claude/skills, .claude/hooks and .claude/settings.json:", error);
      process.exit(1);
    }
  });
