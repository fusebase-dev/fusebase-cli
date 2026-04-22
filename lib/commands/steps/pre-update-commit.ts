import { confirm } from "@inquirer/prompts";
import {
  checkGitAvailable,
  isInsideGitWorkTree,
  runGit,
  runGitCapture,
  runGitInitInDirectory,
} from "../../git-local";

function commitMessage(): string {
  const stamp = new Date().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  return `chore(update): pre app update (${stamp})`;
}

async function gitHeadSha(cwd: string): Promise<string | undefined> {
  const { code, stdout } = await runGitCapture(cwd, ["rev-parse", "HEAD"]);
  if (code !== 0) return undefined;
  return stdout.trim() || undefined;
}

export interface PreUpdateCommitOptions {
  cwd: string;
  /** When false, skip entire pre-update commit stage */
  commitEnabled: boolean;
  dryRun: boolean;
}

export interface PreUpdateCommitResult {
  ok: boolean;
  skipped: boolean;
  sha?: string;
  pushed?: boolean;
  reason?: string;
}

async function pushToUpstreamIfConfigured(cwd: string): Promise<{
  pushed: boolean;
  reason?: "no-upstream" | "push-failed";
}> {
  // Returns non-zero when upstream is not configured; treat as non-fatal skip.
  const upstream = await runGitCapture(cwd, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstream.code !== 0 || !upstream.stdout.trim()) {
    return { pushed: false, reason: "no-upstream" };
  }

  const pushCode = await runGit(cwd, ["push"], { stdio: "inherit" });
  if (pushCode !== 0) {
    console.warn("⚠ Pre-update commit created locally, but git push failed.");
    return { pushed: false, reason: "push-failed" };
  }

  console.log(`✓ Pushed pre-update commit to ${upstream.stdout.trim()}`);
  return { pushed: true };
}

/**
 * Optional snapshot commit before mutating the project (see docs/proposals/APP-UNIVERSAL-UPDATE.md).
 */
export async function runPreUpdateCommit(
  options: PreUpdateCommitOptions,
): Promise<PreUpdateCommitResult> {
  const { cwd, commitEnabled, dryRun } = options;

  if (!commitEnabled) {
    return { ok: true, skipped: true, reason: "commit disabled" };
  }

  if (dryRun) {
    console.log("[dry-run] Would run pre-update Git checkpoint (if applicable).");
    return { ok: true, skipped: true, reason: "dry-run" };
  }

  const gitOk = await checkGitAvailable(cwd);
  if (!gitOk) {
    console.warn("⚠ Git is not available on PATH; skipping pre-update commit.");
    return { ok: true, skipped: true, reason: "no-git-binary" };
  }

  const inside = await isInsideGitWorkTree(cwd);

  if (!inside) {
    console.log("");
    console.warn(
      "⚠ No Git repository in this directory. Without a commit, recovering from a failed or partial update may be harder.",
    );
    console.log("");

    const tty = process.stdin.isTTY && process.stdout.isTTY;
    let initAndCommit = false;
    if (tty) {
      try {
        initAndCommit = await confirm({
          message: "Initialize Git here and create a pre-update commit?",
          default: true,
        });
      } catch {
        initAndCommit = false;
      }
    }

    if (initAndCommit) {
      const initResult = await runGitInitInDirectory(cwd);
      if (!initResult.ok) {
        console.error("Error: Could not initialize Git. Aborting update before changes.");
        return { ok: false, skipped: false, reason: "git-init-failed" };
      }
      const msg = commitMessage();
      let code = await runGit(cwd, ["add", "-A"], { stdio: "inherit" });
      if (code !== 0) {
        console.error("Error: git add failed.");
        return { ok: false, skipped: false };
      }
      code = await runGit(cwd, ["commit", "-m", msg], { stdio: "inherit" });
      if (code !== 0) {
        console.error("Error: git commit failed.");
        return { ok: false, skipped: false };
      }
      const sha = await gitHeadSha(cwd);
      const push = await pushToUpstreamIfConfigured(cwd);
      console.log(`✓ Pre-update commit created${sha ? ` (${sha})` : ""}`);
      return { ok: true, skipped: false, sha, pushed: push.pushed };
    }

    let proceed = false;
    if (tty) {
      try {
        proceed = await confirm({
          message: "Continue without Git?",
          default: false,
        });
      } catch {
        proceed = false;
      }
    } else {
      proceed = true;
    }

    if (!proceed) {
      console.log("Update cancelled.");
      return { ok: false, skipped: false, reason: "user-cancelled-no-git" };
    }

    return { ok: true, skipped: true, reason: "no-git-repo" };
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let doCommit = !interactive;
  if (interactive) {
    try {
      doCommit = await confirm({
        message: "Create a pre-update Git checkpoint commit?",
        default: true,
      });
    } catch {
      doCommit = false;
    }
  }

  if (!doCommit) {
    return { ok: true, skipped: true, reason: "user-declined" };
  }

  const { stdout: statusOut } = await runGitCapture(cwd, ["status", "--porcelain"]);
  const dirty = statusOut.trim().length > 0;
  const msg = commitMessage();

  if (dirty) {
    let code = await runGit(cwd, ["add", "-A"], { stdio: "inherit" });
    if (code !== 0) {
      console.error("Error: git add failed.");
      return { ok: false, skipped: false };
    }
    code = await runGit(cwd, ["commit", "-m", msg], { stdio: "inherit" });
    if (code !== 0) {
      console.error("Error: git commit failed.");
      return { ok: false, skipped: false };
    }
  } else {
    const code = await runGit(cwd, ["commit", "--allow-empty", "-m", msg], {
      stdio: "inherit",
    });
    if (code !== 0) {
      console.error("Error: git commit --allow-empty failed.");
      return { ok: false, skipped: false };
    }
  }

  const sha = await gitHeadSha(cwd);
  const push = await pushToUpstreamIfConfigured(cwd);
  console.log(`✓ Pre-update commit created${sha ? ` (${sha})` : ""}`);
  return { ok: true, skipped: false, sha, pushed: push.pushed };
}
