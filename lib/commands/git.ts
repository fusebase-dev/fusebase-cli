import { Command } from "commander";
import { runGitInitInDirectory } from "../git-local";

export const gitCommand = new Command("git")
  .description(
    "Initialize a local Git repository in the current directory (offline; add a remote to sync with the web)",
  )
  .action(async () => {
    const cwd = process.cwd();
    await runGitInitInDirectory(cwd);
  });
