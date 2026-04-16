import { Command } from "commander";
import { runGitInitInDirectory } from "../git-local";
import { isManagedAppInCurrentProject, syncGitWithGitLab } from "../git-sync";

export const gitCommand = new Command("git")
  .description(
    "Initialize a local Git repository in the current directory",
  )
  .option(
    "--git-sync",
    "Sync local Git with configured GitLab remote (same as `fusebase git sync`)",
    false,
  )
  .option(
    "--git-tag-managed",
    "When syncing, add managed tag to GitLab project for managed apps",
    false,
  )
  .action(async (options: { gitSync?: boolean; gitTagManaged?: boolean }) => {
    const cwd = process.cwd();
    if (options.gitSync) {
      const shouldTagManaged =
        options.gitTagManaged === true && isManagedAppInCurrentProject();
      await syncGitWithGitLab({
        cwd,
        tagManaged: shouldTagManaged,
        push: true,
      });
      return;
    }
    await runGitInitInDirectory(cwd);
  });

gitCommand
  .command("sync")
  .description(
    "Sync current local Git repository with configured GitLab remote and push current branch",
  )
  .option(
    "--git-tag-managed",
    "Add managed tag to GitLab project when current app is managed",
    false,
  )
  .action(async (options: { gitTagManaged?: boolean }) => {
    const cwd = process.cwd();
    const shouldTagManaged =
      options.gitTagManaged === true && isManagedAppInCurrentProject();
    await syncGitWithGitLab({
      cwd,
      tagManaged: shouldTagManaged,
      push: true,
    });
  });
