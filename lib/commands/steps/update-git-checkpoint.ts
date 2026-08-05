import { runGit, runGitCapture } from "../../git-local";

export function updateCheckpointCommitMessage(
  kind: "pre" | "post",
  now: Date = new Date(),
): string {
  const stamp = now.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  return `chore(update): ${kind} app update (${stamp})`;
}

export async function gitHeadSha(cwd: string): Promise<string | undefined> {
  const { code, stdout } = await runGitCapture(cwd, ["rev-parse", "HEAD"]);
  if (code !== 0) return undefined;
  return stdout.trim() || undefined;
}

export async function pushToUpstreamIfConfigured(
  cwd: string,
  label: "Pre-update" | "Post-update",
): Promise<{
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
    console.warn(`⚠ ${label} commit created locally, but git push failed.`);
    return { pushed: false, reason: "push-failed" };
  }

  console.log(`✓ Pushed ${label.toLowerCase()} commit to ${upstream.stdout.trim()}`);
  return { pushed: true };
}

/** Parse `git status --short` into path lines for user notification. */
export function formatShortStatusLines(
  statusShort: string,
  maxLines = 20,
): { lines: string[]; total: number; truncated: boolean } {
  const lines = statusShort
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const total = lines.length;
  if (total <= maxLines) {
    return { lines, total, truncated: false };
  }
  return {
    lines: lines.slice(0, maxLines),
    total,
    truncated: true,
  };
}

export function printDirtyTreeNotification(statusShort: string): void {
  const { lines, total, truncated } = formatShortStatusLines(statusShort);
  console.log("");
  console.log(`Update left uncommitted changes (${total} path${total === 1 ? "" : "s"}):`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  if (truncated) {
    console.log(`  … and ${total - lines.length} more`);
  }
  console.log("");
}
