import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyAgentsAndSkills } from "../lib/copy-template";
import { getFusebaseAppHost, getFusebaseHost } from "../lib/config";

describe("copyAgentsAndSkills host placeholders", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fusebase-hosts-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves {FUSEBASE_HOST} and {FUSEBASE_APP_HOST} in refreshed assets", async () => {
    await copyAgentsAndSkills(dir);

    for (const file of [
      "AGENTS.md",
      ".claude/skills/fusebase-dashboards/references/sdk.md",
      ".claude/skills/file-upload/references/upload-lifecycle.md",
    ]) {
      const text = readFileSync(join(dir, file), "utf-8");
      expect(text).not.toContain("{FUSEBASE_HOST}");
      expect(text).not.toContain("{FUSEBASE_APP_HOST}");
    }
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(agents).toContain(`**FUSEBASE_HOST**: ${getFusebaseHost()}`);
    expect(agents).toContain(`**FUSEBASE_APP_HOST**: ${getFusebaseAppHost()}`);
  });
});
