import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWN_FLAGS } from "../lib/config";
import { renderTemplate, renderTemplatesInDir } from "../lib/template-engine";

describe("restricted uservar search documentation", () => {
  it("is a recognized opt-in flag", () => expect(KNOWN_FLAGS).toContain("uservars-search"));
  it("is absent by default and present only with its flag", () => {
    const source = readFileSync(new URL("../project-template/.claude/skills/fusebase-gate/references/users.md", import.meta.url), "utf8");
    expect(renderTemplate(source, { flags: [] })).not.toContain("searchUsersByVar");
    expect(renderTemplate(source, { flags: ["uservars-search"] })).toContain("searchUsersByVar");
    expect(renderTemplate(source, { flags: ["notes-markdown"] })).not.toContain("searchUsersByVar");
  });
  it("processes the gate inside an actual Markdown file", () => {
    const source = readFileSync(new URL("../project-template/.claude/skills/fusebase-gate/references/users.md", import.meta.url), "utf8");
    const dir = mkdtempSync(join(process.cwd(), ".uservars-template-test-"));
    const file = join(dir, "users.md");
    try {
      for (const enabled of [false, true]) {
        writeFileSync(file, source);
        renderTemplatesInDir(dir, { flags: enabled ? ["uservars-search"] : [] });
        const result = readFileSync(file, "utf8");
        expect(result.includes("searchUsersByVar")).toBe(enabled);
        expect(result).not.toContain("<%");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
