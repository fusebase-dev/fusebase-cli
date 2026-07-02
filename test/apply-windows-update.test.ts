import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { runWindowsCacheSwap } from "../lib/commands/cli";
import {
  BIN_NAME,
  SUPPORTED_SCHEMA,
  binPathForVersion,
  readCurrent,
  versionsDir,
} from "../lib/win-cli-cache";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fb-apply-win-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function seedVersion(version: string): Promise<void> {
  const dir = join(versionsDir(root), version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, BIN_NAME), "old-bin");
}

describe("runWindowsCacheSwap", () => {
  it("stages the new bin, flips current.json, and prunes to two", async () => {
    await seedVersion("0.25.4"); // gets pruned
    await seedVersion("0.25.5"); // becomes previous

    let downloaded = false;
    await runWindowsCacheSwap(root, "0.25.6", "0.25.5", () => {
      downloaded = true;
      return Promise.resolve(new TextEncoder().encode("new-bin"));
    });

    expect(downloaded).toBe(true);

    // New version installed with the downloaded bytes.
    expect(await readFile(binPathForVersion(root, "0.25.6"), "utf-8")).toBe("new-bin");

    // current.json flipped to the new version.
    expect(await readCurrent(root)).toMatchObject({
      schemaVersion: SUPPORTED_SCHEMA,
      version: "0.25.6",
    });

    // Pruned to exactly {new, previous}.
    expect((await readdir(versionsDir(root))).sort()).toEqual(["0.25.5", "0.25.6"]);
  });

  it("leaves the active version untouched if the download fails (no flip)", async () => {
    await seedVersion("0.25.5");

    await expect(
      runWindowsCacheSwap(root, "0.25.6", "0.25.5", () =>
        Promise.reject(new Error("offline")),
      ),
    ).rejects.toThrow("offline");

    // No new folder, no pointer written — the cached version is intact.
    expect((await readdir(versionsDir(root))).sort()).toEqual(["0.25.5"]);
    expect(await readCurrent(root)).toBeNull();
  });
});
