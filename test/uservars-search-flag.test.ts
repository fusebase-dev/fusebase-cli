import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { KNOWN_FLAGS } from "../lib/config";
import { renderTemplate } from "../lib/template-engine";

describe("restricted uservar search documentation", () => {
  it("is a recognized opt-in flag", () => expect(KNOWN_FLAGS).toContain("uservars-search"));
  it("is absent by default and present only with its flag", () => {
    const source = readFileSync(new URL("../project-template/.claude/skills/fusebase-gate/references/users.md", import.meta.url), "utf8");
    expect(renderTemplate(source, { flags: [] })).not.toContain("searchUsersByVar");
    expect(renderTemplate(source, { flags: ["uservars-search"] })).toContain("searchUsersByVar");
    expect(renderTemplate(source, { flags: ["notes-markdown"] })).not.toContain("searchUsersByVar");
  });
});
