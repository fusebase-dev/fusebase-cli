import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { checkNonInteractiveInit } from "../lib/commands/init";

const CLI = join(import.meta.dir, "..", "index.ts");

describe("checkNonInteractiveInit", () => {
  test("a TTY run stays interactive and needs no flags", () => {
    expect(checkNonInteractiveInit({}, true)).toEqual({
      nonInteractive: false,
      missing: [],
    });
  });

  test("no TTY (CI) is non-interactive and reports the missing --name", () => {
    expect(checkNonInteractiveInit({}, false)).toEqual({
      nonInteractive: true,
      missing: ["--name"],
    });
  });

  test("--yes forces non-interactive even on a TTY", () => {
    expect(checkNonInteractiveInit({ yes: true, name: "My App" }, true)).toEqual({
      nonInteractive: true,
      missing: [],
    });
  });
});

describe("fusebase init without stdin", () => {
  // The acceptance criterion: a missing flag must exit non-zero, not hang on a
  // prompt no CI job can answer. Runs before any network call, so no API key.
  test("exits non-zero instead of prompting for the product name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fusebase-init-ci-"));
    try {
      const proc = Bun.spawn(["bun", CLI, "init"], {
        cwd: dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).text(),
      ]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("--name");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test("re-running in an initialized project still needs no flags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fusebase-init-ci-"));
    try {
      await writeFile(
        join(dir, "fusebase.json"),
        JSON.stringify({ orgId: "org", productId: "prod" }),
        "utf-8",
      );
      const proc = Bun.spawn(["bun", CLI, "init"], {
        cwd: dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Updated product agent configs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
