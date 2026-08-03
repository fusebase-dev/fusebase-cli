import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { isDirWritable } from "../lib/commands/init";

describe("isDirWritable", () => {
  test("returns true for a writable directory and leaves no probe file behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fusebase-writable-"));
    try {
      expect(await isDirWritable(dir)).toBe(true);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("returns false for a non-existent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fusebase-writable-"));
    await rm(dir, { recursive: true, force: true });
    expect(await isDirWritable(dir)).toBe(false);
  });

  // The case the fix exists for: a directory that exists but denies writes.
  // Root ignores mode bits and Windows ACLs are not modelled by chmod, so the
  // assertion only runs where mode bits are actually enforced.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "returns false for a directory that denies writes",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fusebase-writable-"));
      try {
        await chmod(dir, 0o555);
        expect(await isDirWritable(dir)).toBe(false);
      } finally {
        await chmod(dir, 0o755);
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
