import { confirm } from "@inquirer/prompts";
import {
  checkGitAvailable,
  isInsideGitWorkTree,
  runGit,
  runGitCapture,
} from "../../git-local";
import {
  gitHeadSha,
  printDirtyTreeNotification,
  pushToUpstreamIfConfigured,
  updateCheckpointCommitMessage,
} from "./update-git-checkpoint";

function commitMessage(): string {
  return updateCheckpointCommitMessage("post");
}

export interface PostUpdateCommitOptions {
  cwd: string;
  /** When false, skip creating a commit (still notify if dirty) */
  commitEnabled: boolean;
  dryRun: boolean;
}

export interface PostUpdateCommitResult {
  ok: boolean;
  skipped: boolean;
  sha?: string;
  pushed?: boolean;
  dirty?: boolean;
  reason?: string;
}

/**
 * After update stages: notify about dirty tree and optionally commit (no empty commit).
 */
export async function runPostUpdateCommit(
  options: PostUpdateCommitOptions,
): Promise<PostUpdateCommitResult> {
  const { cwd, commitEnabled, dryRun } = options;

  if (dryRun) {
    console.log("[dry-run] Would check for post-update Git commit (if tree dirty).");
    return { ok: true, skipped: true, reason: "dry-run" };
  }

  const gitOk = await checkGitAvailable(cwd);
  if (!gitOk) {
    return { ok: true, skipped: true, reason: "no-git-binary" };
  }

  const inside = await isInsideGitWorkTree(cwd);
  if (!inside) {
    return { ok: true, skipped: true, reason: "no-git-repo" };
  }

  const { stdout: statusOut } = await runGitCapture(cwd, ["status", "--short"]);
  const dirty = statusOut.trim().length > 0;
  if (!dirty) {
    return { ok: true, skipped: true, dirty: false, reason: "no changes" };
  }

  printDirtyTreeNotification(statusOut);

  if (!commitEnabled) {
    console.warn(
      "⚠ Update changes were not committed (--skip-commit or commit disabled). Review and commit when ready.",
    );
    return { ok: true, skipped: true, dirty: true, reason: "commit disabled" };
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let doCommit = !interactive;
  if (interactive) {
    try {
      doCommit = await confirm({
        message: "Create a post-update Git commit for these changes?",
        default: true,
      });
    } catch {
      doCommit = false;
    }
  }

  if (!doCommit) {
    console.warn(
      "⚠ Update changes were left uncommitted. Review and commit when ready.",
    );
    return { ok: true, skipped: true, dirty: true, reason: "user-declined" };
  }

  const msg = commitMessage();
  let code = await runGit(cwd, ["add", "-A"], { stdio: "inherit" });
  if (code !== 0) {
    console.error("Error: git add failed.");
    return { ok: false, skipped: false, dirty: true };
  }
  code = await runGit(cwd, ["commit", "-m", msg], { stdio: "inherit" });
  if (code !== 0) {
    console.error("Error: git commit failed.");
    return { ok: false, skipped: false, dirty: true };
  }

  const sha = await gitHeadSha(cwd);
  const push = await pushToUpstreamIfConfigured(cwd, "Post-update");
  console.log(`✓ Post-update commit created${sha ? ` (${sha})` : ""}`);
  return { ok: true, skipped: false, dirty: false, sha, pushed: push.pushed };
}
