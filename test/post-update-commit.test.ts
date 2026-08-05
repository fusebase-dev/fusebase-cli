import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { runGit, runGitCapture } from "../lib/git-local";
import { runPostUpdateCommit } from "../lib/commands/steps/post-update-commit";
import {
  formatShortStatusLines,
  updateCheckpointCommitMessage,
} from "../lib/commands/steps/update-git-checkpoint";

async function initRepo(cwd: string): Promise<void> {
  expect(await runGit(cwd, ["init"])).toBe(0);
  expect(await runGit(cwd, ["config", "user.email", "test@example.com"])).toBe(0);
  expect(await runGit(cwd, ["config", "user.name", "Test"])).toBe(0);
  writeFileSync(join(cwd, "README.md"), "initial\n", "utf-8");
  expect(await runGit(cwd, ["add", "-A"])).toBe(0);
  expect(await runGit(cwd, ["commit", "-m", "initial"])).toBe(0);
}

describe("updateCheckpointCommitMessage", () => {
  it("formats pre and post messages with timestamp", () => {
    const when = new Date("2026-04-16T14:23:10");
    expect(updateCheckpointCommitMessage("pre", when)).toContain("pre app update");
    expect(updateCheckpointCommitMessage("post", when)).toContain("post app update");
  });
});

describe("formatShortStatusLines", () => {
  it("truncates long status lists", () => {
    const status = Array.from({ length: 25 }, (_, i) => ` M file-${i}.txt`).join("\n");
    const result = formatShortStatusLines(status, 5);
    expect(result.total).toBe(25);
    expect(result.lines).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });
});

describe("runPostUpdateCommit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "post-update-commit-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a commit when the tree is dirty and commitEnabled", async () => {
    await initRepo(dir);
    writeFileSync(join(dir, "changed.txt"), "after update\n", "utf-8");

    const result = await runPostUpdateCommit({
      cwd: dir,
      commitEnabled: true,
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.sha).toBeTruthy();
    expect(result.dirty).toBe(false);

    const status = await runGitCapture(dir, ["status", "--porcelain"]);
    expect(status.stdout.trim()).toBe("");

    const log = await runGitCapture(dir, ["log", "-1", "--pretty=%s"]);
    expect(log.stdout).toContain("post app update");
  });

  it("skips when the tree is clean", async () => {
    await initRepo(dir);

    const result = await runPostUpdateCommit({
      cwd: dir,
      commitEnabled: true,
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("no changes");
    expect(result.dirty).toBe(false);
  });

  it("notifies but leaves dirty when commitEnabled is false", async () => {
    await initRepo(dir);
    writeFileSync(join(dir, "changed.txt"), "after update\n", "utf-8");

    const result = await runPostUpdateCommit({
      cwd: dir,
      commitEnabled: false,
      dryRun: false,
    });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.dirty).toBe(true);
    expect(result.reason).toBe("commit disabled");

    const status = await runGitCapture(dir, ["status", "--porcelain"]);
    expect(status.stdout.trim().length).toBeGreaterThan(0);
    expect(readFileSync(join(dir, "changed.txt"), "utf-8")).toBe("after update\n");
  });
});
