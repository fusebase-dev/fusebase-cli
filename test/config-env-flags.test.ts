import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  FUSEBASE_FLAGS_ENV,
  getFlags,
  hasFlag,
  setConfigFilePathForTests,
  type Config,
} from "../lib/config";

describe("FUSEBASE_FLAGS env var", () => {
  let dir: string;
  let prevCwd: string;
  let configPath: string;
  let prevFlagsEnv: string | undefined;

  beforeEach(() => {
    prevCwd = process.cwd();
    prevFlagsEnv = process.env[FUSEBASE_FLAGS_ENV];
    delete process.env[FUSEBASE_FLAGS_ENV];
    dir = mkdtempSync(join(tmpdir(), "fuse-env-flags-"));
    process.chdir(dir);
    configPath = join(dir, "config.json");
    setConfigFilePathForTests(configPath);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    setConfigFilePathForTests(null);
    if (prevFlagsEnv === undefined) delete process.env[FUSEBASE_FLAGS_ENV];
    else process.env[FUSEBASE_FLAGS_ENV] = prevFlagsEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  function seedConfig(config: Config): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
    setConfigFilePathForTests(configPath);
  }

  it("merges a known flag from the env var without a set-flag call", () => {
    seedConfig({ env: "dev" });
    expect(hasFlag("git-init")).toBe(false);
    process.env[FUSEBASE_FLAGS_ENV] = "git-init";
    expect(getFlags()).toContain("git-init");
    expect(hasFlag("git-init")).toBe(true);
  });

  it("merges multiple comma-separated flags and trims whitespace", () => {
    seedConfig({ env: "dev" });
    process.env[FUSEBASE_FLAGS_ENV] = " git-init , mcp-beta ";
    const flags = getFlags();
    expect(flags).toContain("git-init");
    expect(flags).toContain("mcp-beta");
  });

  it("merges with flags already stored on disk, no duplicates", () => {
    seedConfig({ env: "dev", flags: ["mcp-beta"] });
    process.env[FUSEBASE_FLAGS_ENV] = "git-init,mcp-beta";
    const flags = getFlags();
    expect(flags.filter((f) => f === "mcp-beta")).toHaveLength(1);
    expect(flags).toContain("git-init");
  });

  it("does not persist env-sourced flags to disk", () => {
    seedConfig({ env: "dev", flags: ["mcp-beta"] });
    process.env[FUSEBASE_FLAGS_ENV] = "git-init";
    getFlags();
    // Re-read the on-disk config: env flag must not have leaked to disk.
    delete process.env[FUSEBASE_FLAGS_ENV];
    setConfigFilePathForTests(configPath);
    expect(getFlags()).not.toContain("git-init");
    expect(getFlags()).toContain("mcp-beta");
  });

  it("ignores unrecognized flags instead of failing", () => {
    seedConfig({ env: "dev" });
    process.env[FUSEBASE_FLAGS_ENV] = "not-a-real-flag,git-init";
    const flags = getFlags();
    expect(flags).not.toContain("not-a-real-flag");
    expect(flags).toContain("git-init");
  });

  it("empty or whitespace-only env var is a no-op", () => {
    seedConfig({ env: "dev", flags: ["mcp-beta"] });
    process.env[FUSEBASE_FLAGS_ENV] = "  ,, ";
    expect(getFlags()).toEqual(["mcp-beta"]);
  });
});
